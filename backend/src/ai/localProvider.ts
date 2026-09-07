/**
 * Logging contract (constitution XX — Observability Without Sensitive Logging): every
 * log line emitted by this module (via the shared `../logger`) carries only `requestId`,
 * `modelId`, `durationMs`, and `errorCategory` fields alongside an event name (e.g.
 * `inference_start`, `load_success`). Raw prompt/response content is never logged.
 */
import type {
  AIProvider,
  AIProviderMode,
  InferenceRequest,
  InferenceResponse,
  ModelConfig,
  ReadinessState,
} from "@apipilot/shared-domain";
import { AIProviderError, buildErrorResponse } from "./errors";
import { CHARS_PER_TOKEN_ESTIMATE, type InferencePlanningConfig } from "./modelConfig";
import { ReadinessTracker } from "./readiness";
import { RequestQueue } from "./requestQueue";
import { createLogger } from "../logger";

const logger = createLogger("ai.localProvider");

/**
 * Observed generation throughput (specs/013-ai-enhancement-viability/data-model.md:
 * InferenceRates). Seeded from configuration and refined at runtime, so the pre-flight estimate
 * calibrates to the machine it is running on rather than encoding one reference laptop's
 * characteristics permanently.
 */
export interface InferenceRates {
  prefillMsPerToken: number;
  decodeMsPerToken: number;
  /** How many completed inferences have been folded in so far. */
  sampleCount: number;
}

/**
 * Planning defaults used when a LocalProvider is constructed without explicit configuration —
 * chiefly in tests, which inject fixed values so the pre-flight estimate stays deterministic.
 */
const DEFAULT_PLANNING: InferencePlanningConfig = {
  contextFloorTokens: 2048,
  prefillMsPerToken: 42,
  decodeMsPerToken: 180,
  viabilitySafetyFactor: 1.0,
  enhancementOperationsPerUnit: 1,
  enhancementRunBudgetMs: 300_000,
};

/** Weight given to each new observation when folding it into the running rate estimate. */
const RATE_EWMA_ALPHA = 0.3;

/**
 * How a model's usable context window was determined
 * (specs/013-ai-enhancement-viability/data-model.md: ModelCapacity). Provider-internal: it
 * describes a runtime artifact, so it must not cross the AIProvider boundary into shared-domain
 * (constitution VI).
 */
export interface ModelCapacity {
  /** The model's true usable input size, in tokens. Always a positive finite integer. */
  contextWindowTokens: number;
  source: "model-config" | "tokenizer" | "conservative-floor";
  /** True when neither source was usable and the conservative floor was applied. */
  isFallback: boolean;
}

/** Minimal shape of a loaded model this provider needs, independent of the runtime. */
export interface TextGenerationEngine {
  generate(
    input: string,
    options: { maxNewTokens?: number; expectedOutputFormat?: "text" | "json" },
  ): Promise<string>;
  /**
   * The model's resolved usable context window. Used both for batch planning and for the
   * exact-fit guard inside `generate()`, so planning and enforcement read one value and cannot
   * disagree (FR-008).
   */
  capacity?: ModelCapacity;
}

/** Loads the configured model into a TextGenerationEngine for the given device. */
export type EngineLoader = (
  config: ModelConfig,
  device: "cpu" | "gpu",
  floorTokens?: number,
) => Promise<TextGenerationEngine>;

/**
 * Shared safety margin (in tokens) reserved below the model's real context window, to
 * absorb the discrepancy between `tokenizer.encode()`'s count and what the
 * text-generation pipeline feeds the model internally. Used both by the exact guard in
 * `loadTransformersEngine()` below and by `getInputBudget()`'s conservative estimate, so
 * the two never disagree about how much headroom is reserved.
 */
export const CONTEXT_SAFETY_MARGIN_TOKENS = 64;

/**
 * Re-exported from `modelConfig`, which is where it now lives so that planning code can convert
 * characters to tokens without importing this module and, through it, the inference library.
 */
export { CHARS_PER_TOKEN_ESTIMATE };

/** A positive finite integer, or undefined for anything else (missing, NaN, Infinity, <= 0). */
function usableTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Resolves a model's true usable context window as the minimum of the model's positional limit
 * and the tokenizer's advertised maximum (specs/013-ai-enhancement-viability research.md
 * Decision 2).
 *
 * These disagree in practice and the disagreement is not cosmetic: for the default model the
 * tokenizer advertises 131,072 tokens while the model's `max_position_embeddings` is 32,768.
 * Trusting the tokenizer inflated the planning budget roughly 4x, which meant batch splitting
 * never triggered for any realistic specification, and left the exact-fit guard below calibrated
 * against a limit the model cannot actually honour. Taking the minimum is correct whichever
 * source is wrong, and needs no per-model table.
 *
 * Falls back to `floorTokens` rather than `undefined` when neither source is usable: "unknown"
 * must mean "assume little", not "assume it fits" (FR-006, constitution XIV).
 */
export function resolveModelCapacity(
  maxPositionEmbeddings: unknown,
  tokenizerMaxLength: unknown,
  floorTokens: number,
): ModelCapacity {
  const fromModel = usableTokenCount(maxPositionEmbeddings);
  const fromTokenizer = usableTokenCount(tokenizerMaxLength);

  if (fromModel !== undefined && fromTokenizer !== undefined) {
    const contextWindowTokens = Math.min(fromModel, fromTokenizer);
    return {
      contextWindowTokens,
      source: contextWindowTokens === fromModel ? "model-config" : "tokenizer",
      isFallback: false,
    };
  }
  if (fromModel !== undefined) {
    return { contextWindowTokens: fromModel, source: "model-config", isFallback: false };
  }
  if (fromTokenizer !== undefined) {
    return { contextWindowTokens: fromTokenizer, source: "tokenizer", isFallback: false };
  }
  return {
    contextWindowTokens: floorTokens,
    source: "conservative-floor",
    isFallback: true,
  };
}

/** System messages used to frame a request for a chat-capable model, keyed by expected output. */
const SYSTEM_PROMPTS: Record<"text" | "json", string> = {
  json:
    "You are an API test design assistant. Reply with a single valid JSON document and nothing " +
    "else: no explanation, no markdown code fences, no commentary before or after the JSON.",
  text: "You are an API test design assistant. Answer concisely and directly.",
};

/**
 * Only this function (and this module) imports `@huggingface/transformers` (constitution
 * VI, XXVIII; FR-013) — everything else depends solely on the `AIProvider` abstraction.
 */
export async function loadTransformersEngine(
  config: ModelConfig,
  device: "cpu" | "gpu",
  floorTokens = 2048,
): Promise<TextGenerationEngine> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = config.cacheDir;

  const generator = await pipeline("text-generation", config.modelId, {
    device: device === "gpu" ? "gpu" : "cpu",
    ...(config.dtype ? { dtype: config.dtype } : {}),
  });

  const modelConfigLimit = (
    generator.model as { config?: { max_position_embeddings?: unknown } } | undefined
  )?.config?.max_position_embeddings;
  const capacity = resolveModelCapacity(
    modelConfigLimit,
    generator.tokenizer.model_max_length,
    floorTokens,
  );
  logger.info("capacity_resolved", {
    modelId: config.modelId,
    contextWindowTokens: capacity.contextWindowTokens,
    capacitySource: capacity.source,
  });

  return {
    capacity,
    async generate(input, options) {
      const maxNewTokens = options.maxNewTokens ?? 256;

      // Instruction-tuned models must be addressed through their own chat template, or they do
      // not recognise the input as a task at all: `pipeline("text-generation")` applies a chat
      // template only for a messages array, never for a plain string, so a raw prompt puts the
      // model in pure continuation mode. Measured consequences were that it autocompleted the
      // prompt's JSON instead of answering, and — because the stop token is a ChatML marker only
      // reachable inside a chat-formatted conversation — never terminated early, always running
      // to `max_new_tokens` (specs/013-ai-enhancement-viability research.md Decision 1).
      //
      // Models with no chat template keep receiving the raw string unchanged (FR-004).
      const tokenizer = generator.tokenizer as {
        chat_template?: unknown;
        apply_chat_template?: (
          messages: { role: string; content: string }[],
          options: { tokenize: false; add_generation_prompt: boolean },
        ) => string;
      };
      let prompt = input;
      if (tokenizer.chat_template && typeof tokenizer.apply_chat_template === "function") {
        prompt = tokenizer.apply_chat_template(
          [
            { role: "system", content: SYSTEM_PROMPTS[options.expectedOutputFormat ?? "text"] },
            { role: "user", content: input },
          ],
          { tokenize: false, add_generation_prompt: true },
        );
      }

      // Transformers.js does not truncate or validate context length itself: an
      // oversized prompt reaches onnxruntime and crashes deep inside the RoPE/position
      // embedding Gather node once the position index exceeds the model's context
      // window, surfacing as an opaque native error rather than a typed one. Fail
      // explicitly here instead (constitution 8.4 — Explicit Failure).
      //
      // `tokenizer.encode()` (add_special_tokens: true by default) does not necessarily
      // count the exact same tokens the text-generation pipeline feeds the model
      // internally, so a prompt sitting right at the boundary can still overflow by a
      // few tokens even though this check passed — CONTEXT_SAFETY_MARGIN_TOKENS absorbs
      // that discrepancy instead of relying on an exact token-for-token match.
      //
      // Calibrated against the resolved capacity, the same value `getInputBudget()` plans with,
      // so planning and enforcement cannot disagree (FR-008). Measured against the *framed*
      // prompt, since that is what actually reaches the model.
      const contextLimit = capacity.contextWindowTokens;
      const inputTokenCount = generator.tokenizer.encode(prompt).length;
      if (inputTokenCount + maxNewTokens + CONTEXT_SAFETY_MARGIN_TOKENS > contextLimit) {
        throw new AIProviderError(
          "INVALID_REQUEST",
          `InferenceRequest.input requires ${inputTokenCount} tokens plus ${maxNewTokens} reserved for ` +
            `generation, exceeding the model's ${contextLimit}-token context window`,
        );
      }

      const output = await generator(prompt, {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        // `prompt` is a plain string (already chat-framed above where the model supports it), so
        // return_full_text defaults to true — without this, generated_text is the prompt itself
        // plus the completion concatenated together, which then fails strict JSON parsing every
        // time.
        return_full_text: false,
      });
      const first = Array.isArray(output) ? output[0] : output;
      const text = (first as { generated_text?: unknown } | undefined)?.generated_text;
      if (typeof text !== "string") {
        throw new AIProviderError(
          "INVALID_RESPONSE",
          "Local model output did not contain a generated_text string",
        );
      }
      return text;
    },
  };
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new TimeoutError(`Inference exceeded the configured timeout of ${timeoutMs}ms`),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Local, fully-offline AIProvider implementation backed by Transformers.js (FR-002,
 * FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-017, FR-018, FR-019).
 */
export class LocalProvider implements AIProvider {
  readonly mode: AIProviderMode = "local";

  private readonly config: ModelConfig;
  private readonly loadEngine: EngineLoader;
  private readonly planning: InferencePlanningConfig;
  private readonly readiness = new ReadinessTracker();
  private readonly queue = new RequestQueue();
  private enginePromise: Promise<TextGenerationEngine> | undefined;
  private acceleratorActive = false;
  /**
   * Observed throughput, refined by EWMA from each completed inference and read only by the
   * pre-flight viability check. Never influences prompt content, validation, deduplication order,
   * or which scenarios are retained, so it cannot affect reproducibility (constitution XXIV).
   */
  private rates: InferenceRates;

  constructor(
    config: ModelConfig,
    loadEngine: EngineLoader = loadTransformersEngine,
    planning: InferencePlanningConfig = DEFAULT_PLANNING,
  ) {
    this.config = config;
    this.loadEngine = loadEngine;
    this.planning = planning;
    this.rates = {
      prefillMsPerToken: planning.prefillMsPerToken,
      decodeMsPerToken: planning.decodeMsPerToken,
      sampleCount: 0,
    };
  }

  /** Current throughput estimates, for the pre-flight viability check (FR-014). */
  getInferenceRates(): InferenceRates {
    return { ...this.rates };
  }

  /** The configured margin by which a projection may exceed the timeout before refusing. */
  getViabilitySafetyFactor(): number {
    return this.planning.viabilitySafetyFactor;
  }

  /** The configured per-request time budget, which pre-flight compares projections against. */
  getTimeoutMs(): number {
    return this.config.inferenceTimeoutMs;
  }

  getReadiness(): ReadinessState {
    return this.readiness.getState();
  }

  /**
   * Conservative character budget for InferenceRequest.input, derived from the model's *true*
   * usable context window (specs/013-ai-enhancement-viability research.md Decision 2, correcting
   * specs/011-ai-prompt-batching/research.md Decision 2, which read the tokenizer's advertised
   * maximum and so over-estimated capacity roughly 4x for the default model).
   *
   * Loads the engine if not already loaded (same lazy path as `infer()`). Returns `undefined`
   * only when the engine cannot be loaded at all — never merely because capacity is unknown,
   * since `resolveModelCapacity()` supplies a conservative floor in that case (FR-006).
   */
  async getInputBudget(maxOutputTokens = 256): Promise<number | undefined> {
    let engine: TextGenerationEngine;
    try {
      engine = await this.ensureEngine();
    } catch {
      return undefined;
    }
    const contextWindowTokens =
      engine.capacity?.contextWindowTokens ?? this.planning.contextFloorTokens;
    const availableTokens =
      contextWindowTokens - maxOutputTokens - CONTEXT_SAFETY_MARGIN_TOKENS;
    return Math.max(0, Math.floor(availableTokens * CHARS_PER_TOKEN_ESTIMATE));
  }

  /** Explicit user action required to attempt loading again after a failure (FR-019). */
  retryLoad(): void {
    this.enginePromise = undefined;
    this.readiness.reset();
  }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const startedAt = Date.now();

    if (!request.input || request.input.trim().length === 0) {
      return buildErrorResponse({
        requestId: request.requestId,
        errorCategory: "INVALID_REQUEST",
        errorMessage: "InferenceRequest.input must be a non-empty string",
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    // A prior load failure is never retried automatically — surface NOT_READY until
    // retryLoad() is called explicitly (FR-019).
    if (this.readiness.getState().state === "unavailable") {
      return buildErrorResponse({
        requestId: request.requestId,
        errorCategory: "NOT_READY",
        errorMessage:
          "Local model is unavailable; an explicit retry is required before inference can proceed",
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    // Queue and process serially rather than rejecting or running in parallel (FR-018).
    return this.queue.enqueue(() => this.runInference(request, startedAt));
  }

  private async runInference(
    request: InferenceRequest,
    startedAt: number,
  ): Promise<InferenceResponse> {
    logger.info("inference_start", {
      requestId: request.requestId,
      modelId: this.config.modelId,
    });

    let engine: TextGenerationEngine;
    try {
      engine = await this.ensureEngine();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.readiness.markUnavailable({
        reason: message,
        acceleratorRequested: this.config.useAccelerator,
        acceleratorActive: this.acceleratorActive,
      });
      logger.error("inference_error", {
        requestId: request.requestId,
        modelId: this.config.modelId,
        errorCategory: "LOAD_FAILED",
        durationMs: Date.now() - startedAt,
      });
      return buildErrorResponse({
        requestId: request.requestId,
        errorCategory: "LOAD_FAILED",
        errorMessage: message,
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    const timeoutMs = request.timeoutMs ?? this.config.inferenceTimeoutMs;
    const generationStartedAt = Date.now();
    try {
      const content = await withTimeout(
        engine.generate(request.input, {
          maxNewTokens: request.maxOutputTokens,
          expectedOutputFormat: request.expectedOutputFormat,
        }),
        timeoutMs,
      );
      const durationMs = Date.now() - startedAt;
      this.recordObservedRates(
        request.input.length,
        content.length,
        Date.now() - generationStartedAt,
      );
      logger.info("inference_success", {
        requestId: request.requestId,
        modelId: this.config.modelId,
        durationMs,
      });
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content,
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs,
      };
    } catch (error) {
      const errorCategory =
        error instanceof TimeoutError
          ? "TIMEOUT"
          : error instanceof AIProviderError
            ? error.category
            : "PROVIDER_UNAVAILABLE";
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      logger.error("inference_error", {
        requestId: request.requestId,
        modelId: this.config.modelId,
        errorCategory,
        durationMs,
      });
      return buildErrorResponse({
        requestId: request.requestId,
        errorCategory,
        errorMessage: message,
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs,
      });
    }
  }

  /**
   * Folds one completed inference's observed throughput into the running estimate (FR-014).
   *
   * Token counts are approximated from character counts via CHARS_PER_TOKEN_ESTIMATE rather than
   * re-tokenizing: this feeds a projection whose only job is to catch order-of-magnitude
   * infeasibility, so an exact count would buy nothing and cost a tokenizer pass per request.
   * A non-positive or non-finite observation is discarded rather than propagated.
   */
  private recordObservedRates(
    inputChars: number,
    outputChars: number,
    elapsedMs: number,
  ): void {
    const promptTokens = Math.max(1, Math.round(inputChars / CHARS_PER_TOKEN_ESTIMATE));
    const outputTokens = Math.max(1, Math.round(outputChars / CHARS_PER_TOKEN_ESTIMATE));
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;

    // Attribute time between prefill and decode using the current estimates' own ratio: a single
    // wall-clock measurement cannot separate the two phases, but keeping their relative weighting
    // stable while scaling both to reality is enough for an order-of-magnitude projection.
    const predictedPrefill = promptTokens * this.rates.prefillMsPerToken;
    const predictedDecode = outputTokens * this.rates.decodeMsPerToken;
    const predictedTotal = predictedPrefill + predictedDecode;
    if (predictedTotal <= 0) return;

    const scale = elapsedMs / predictedTotal;
    if (!Number.isFinite(scale) || scale <= 0) return;

    const blend = (current: number, observed: number): number =>
      current * (1 - RATE_EWMA_ALPHA) + observed * RATE_EWMA_ALPHA;

    this.rates = {
      prefillMsPerToken: blend(
        this.rates.prefillMsPerToken,
        this.rates.prefillMsPerToken * scale,
      ),
      decodeMsPerToken: blend(
        this.rates.decodeMsPerToken,
        this.rates.decodeMsPerToken * scale,
      ),
      sampleCount: this.rates.sampleCount + 1,
    };
  }

  private ensureEngine(): Promise<TextGenerationEngine> {
    if (!this.enginePromise) {
      this.readiness.markLoading(this.config.useAccelerator);
      this.enginePromise = this.loadWithAcceleratorFallback();
    }
    return this.enginePromise;
  }

  private async loadWithAcceleratorFallback(): Promise<TextGenerationEngine> {
    logger.info("load_start", { modelId: this.config.modelId });

    if (!this.config.useAccelerator) {
      const engine = await this.loadEngine(this.config, "cpu", this.planning.contextFloorTokens);
      this.acceleratorActive = false;
      this.readiness.markReady({
        modelId: this.config.modelId,
        acceleratorRequested: false,
        acceleratorActive: false,
      });
      logger.info("load_success", { modelId: this.config.modelId });
      return engine;
    }

    try {
      const engine = await this.loadEngine(this.config, "gpu", this.planning.contextFloorTokens);
      this.acceleratorActive = true;
      this.readiness.markReady({
        modelId: this.config.modelId,
        acceleratorRequested: true,
        acceleratorActive: true,
      });
      logger.info("load_success", { modelId: this.config.modelId });
      return engine;
    } catch {
      // Accelerator explicitly enabled but unavailable at runtime: fall back to CPU
      // automatically, but surface a visible (never silent) notice (FR-008).
      const engine = await this.loadEngine(this.config, "cpu", this.planning.contextFloorTokens);
      this.acceleratorActive = false;
      this.readiness.markReady({
        modelId: this.config.modelId,
        acceleratorRequested: true,
        acceleratorActive: false,
        reason:
          "Accelerator was requested but unavailable at runtime; using CPU inference instead",
      });
      logger.info("load_success", { modelId: this.config.modelId });
      return engine;
    }
  }
}
