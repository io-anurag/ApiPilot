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
import { ReadinessTracker } from "./readiness";
import { RequestQueue } from "./requestQueue";
import { createLogger } from "../logger";

const logger = createLogger("ai.localProvider");

/** Minimal shape of a loaded model this provider needs, independent of the runtime. */
export interface TextGenerationEngine {
  generate(input: string, options: { maxNewTokens?: number }): Promise<string>;
  /** Tokenizer's max context length in tokens, if known; used only for batch planning. */
  contextWindowTokens?: number;
}

/** Loads the configured model into a TextGenerationEngine for the given device. */
export type EngineLoader = (
  config: ModelConfig,
  device: "cpu" | "gpu",
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
 * Conservative characters-per-token estimate used only to plan batches before sending a
 * request (specs/011-ai-prompt-batching/research.md Decision 2) — deliberately on the
 * low side (JSON-heavy prompts full of punctuation/numbers tokenize less efficiently than
 * prose) because `loadTransformersEngine()`'s exact tokenizer guard remains the real,
 * authoritative fits/doesn't-fit check (Decision 1); this estimate only needs to usually
 * avoid tripping that guard, not match it exactly.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 3;

/**
 * Only this function (and this module) imports `@huggingface/transformers` (constitution
 * VI, XXVIII; FR-013) — everything else depends solely on the `AIProvider` abstraction.
 */
export async function loadTransformersEngine(
  config: ModelConfig,
  device: "cpu" | "gpu",
): Promise<TextGenerationEngine> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = config.cacheDir;

  const generator = await pipeline("text-generation", config.modelId, {
    device: device === "gpu" ? "gpu" : "cpu",
    ...(config.dtype ? { dtype: config.dtype } : {}),
  });

  const rawContextLimit = generator.tokenizer.model_max_length;
  const contextWindowTokens =
    typeof rawContextLimit === "number" && Number.isFinite(rawContextLimit)
      ? rawContextLimit
      : undefined;

  return {
    contextWindowTokens,
    async generate(input, options) {
      const maxNewTokens = options.maxNewTokens ?? 256;

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
      const contextLimit = generator.tokenizer.model_max_length;
      if (typeof contextLimit === "number" && Number.isFinite(contextLimit)) {
        const inputTokenCount = generator.tokenizer.encode(input).length;
        if (
          inputTokenCount + maxNewTokens + CONTEXT_SAFETY_MARGIN_TOKENS >
          contextLimit
        ) {
          throw new AIProviderError(
            "INVALID_REQUEST",
            `InferenceRequest.input requires ${inputTokenCount} tokens plus ${maxNewTokens} reserved for ` +
              `generation, exceeding the model's ${contextLimit}-token context window`,
          );
        }
      }

      const output = await generator(input, {
        max_new_tokens: maxNewTokens,
        do_sample: false,
        // `input` is a plain string, not a chat array, so return_full_text defaults to
        // true — without this, generated_text is the prompt itself plus the completion
        // concatenated together, which then fails strict JSON parsing every time.
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
  private readonly readiness = new ReadinessTracker();
  private readonly queue = new RequestQueue();
  private enginePromise: Promise<TextGenerationEngine> | undefined;
  private acceleratorActive = false;

  constructor(config: ModelConfig, loadEngine: EngineLoader = loadTransformersEngine) {
    this.config = config;
    this.loadEngine = loadEngine;
  }

  getReadiness(): ReadinessState {
    return this.readiness.getState();
  }

  /**
   * Conservative character budget for InferenceRequest.input, derived from the loaded
   * tokenizer's context window (specs/011-ai-prompt-batching/research.md Decision 2).
   * Loads the engine if not already loaded (same lazy path as `infer()`). Returns
   * `undefined` if the engine fails to load here or the tokenizer reports no finite
   * `model_max_length` — callers must treat that as "unknown, assume it fits" and rely on
   * the exact guard inside `infer()` as the real safety net.
   */
  async getInputBudget(maxOutputTokens = 256): Promise<number | undefined> {
    let engine: TextGenerationEngine;
    try {
      engine = await this.ensureEngine();
    } catch {
      return undefined;
    }
    const contextWindowTokens = engine.contextWindowTokens;
    if (
      typeof contextWindowTokens !== "number" ||
      !Number.isFinite(contextWindowTokens)
    ) {
      return undefined;
    }
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
    try {
      const content = await withTimeout(
        engine.generate(request.input, { maxNewTokens: request.maxOutputTokens }),
        timeoutMs,
      );
      const durationMs = Date.now() - startedAt;
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
      const engine = await this.loadEngine(this.config, "cpu");
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
      const engine = await this.loadEngine(this.config, "gpu");
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
      const engine = await this.loadEngine(this.config, "cpu");
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
