/**
 * Logging contract (constitution XX — Observability Without Sensitive Logging): every
 * log line emitted by this module carries only `requestId`, `modelId`, `stage`,
 * `durationMs`, and `errorCategory`. Raw prompt/response content is never logged.
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

/** Minimal shape of a loaded model this provider needs, independent of the runtime. */
export interface TextGenerationEngine {
  generate(input: string, options: { maxNewTokens?: number }): Promise<string>;
}

/** Loads the configured model into a TextGenerationEngine for the given device. */
export type EngineLoader = (
  config: ModelConfig,
  device: "cpu" | "gpu",
) => Promise<TextGenerationEngine>;

/**
 * Only this function (and this module) imports `@huggingface/transformers` (constitution
 * VI, XXVIII; FR-013) — everything else depends solely on the `AIProvider` abstraction.
 */
async function loadTransformersEngine(
  config: ModelConfig,
  device: "cpu" | "gpu",
): Promise<TextGenerationEngine> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = config.cacheDir;

  const generator = await pipeline("text-generation", config.modelId, {
    device: device === "gpu" ? "gpu" : "cpu",
  });

  return {
    async generate(input, options) {
      const output = await generator(input, {
        max_new_tokens: options.maxNewTokens ?? 256,
        do_sample: false,
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

/**
 * Emits a single structured, non-sensitive log line (constitution XX): only
 * requestId/modelId/stage/durationMs/errorCategory are logged, never raw prompt or
 * response content.
 */
function logAIEvent(event: {
  requestId?: string;
  modelId: string;
  stage: "load_start" | "load_success" | "load_failed" | "inference_start" | "inference_success" | "inference_error";
  durationMs?: number;
  errorCategory?: string;
}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ component: "ai.localProvider", ...event }));
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Inference exceeded the configured timeout of ${timeoutMs}ms`));
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
        errorMessage: "Local model is unavailable; an explicit retry is required before inference can proceed",
        modelId: this.config.modelId,
        provider: this.mode,
        durationMs: Date.now() - startedAt,
      });
    }

    // Queue and process serially rather than rejecting or running in parallel (FR-018).
    return this.queue.enqueue(() => this.runInference(request, startedAt));
  }

  private async runInference(request: InferenceRequest, startedAt: number): Promise<InferenceResponse> {
    logAIEvent({ requestId: request.requestId, modelId: this.config.modelId, stage: "inference_start" });

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
      logAIEvent({
        requestId: request.requestId,
        modelId: this.config.modelId,
        stage: "inference_error",
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
      logAIEvent({ requestId: request.requestId, modelId: this.config.modelId, stage: "inference_success", durationMs });
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
      logAIEvent({ requestId: request.requestId, modelId: this.config.modelId, stage: "inference_error", errorCategory, durationMs });
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
    logAIEvent({ modelId: this.config.modelId, stage: "load_start" });

    if (!this.config.useAccelerator) {
      const engine = await this.loadEngine(this.config, "cpu");
      this.acceleratorActive = false;
      this.readiness.markReady({
        modelId: this.config.modelId,
        acceleratorRequested: false,
        acceleratorActive: false,
      });
      logAIEvent({ modelId: this.config.modelId, stage: "load_success" });
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
      logAIEvent({ modelId: this.config.modelId, stage: "load_success" });
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
        reason: "Accelerator was requested but unavailable at runtime; using CPU inference instead",
      });
      logAIEvent({ modelId: this.config.modelId, stage: "load_success" });
      return engine;
    }
  }
}
