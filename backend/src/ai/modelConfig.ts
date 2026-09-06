import os from "node:os";
import path from "node:path";
import type { AIProviderMode, ModelConfig, ModelDType } from "@apipilot/shared-domain";

const DEFAULT_MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".apipilot", "models");
const DEFAULT_INFERENCE_TIMEOUT_MS = 60_000;

/**
 * Conservative context window assumed when neither the model config's `max_position_embeddings`
 * nor the tokenizer's `model_max_length` yields a usable value
 * (specs/013-ai-enhancement-viability research.md Decision 3).
 *
 * Previously an unknown capacity meant "assume it fits", an optimistic default whose failure mode
 * is an opaque crash deep inside the model's positional embedding. 2048 is at or below the
 * context window of essentially every current instruction-tuned model, so assuming it is safe;
 * being too conservative merely costs extra batches, which the batching design already handles
 * (constitution XIV, XIX).
 */
const DEFAULT_CONTEXT_FLOOR_TOKENS = 2048;

/**
 * Seed throughput estimates for the pre-flight viability check, in milliseconds per token
 * (research.md Decision 6). Measured on the reference CPU-only profile with unquantized weights
 * (~8 tok/s decode) and deliberately given headroom, so a machine slower than the reference is
 * more likely to be refused early than to burn the whole timeout.
 *
 * These are seeds only: the provider refines them by exponentially-weighted moving average from
 * observed inferences. They gate *whether* a run is attempted and never influence prompt content,
 * validation, deduplication order, or which scenarios are retained (constitution XXIV).
 */
const DEFAULT_PREFILL_MS_PER_TOKEN = 2.0;
const DEFAULT_DECODE_MS_PER_TOKEN = 130;

/**
 * How far a projected duration may exceed the configured timeout before the run is refused
 * outright. Above 1.0 so a marginal misestimate never blocks a run that would have succeeded —
 * the estimate exists to catch the hopeless case (the reported defect over-ran its budget by
 * ~6.9x), not to police borderline ones.
 */
const DEFAULT_VIABILITY_SAFETY_FACTOR = 1.5;
const VALID_DTYPES: readonly ModelDType[] = [
  "fp32",
  "fp16",
  "q8",
  "int8",
  "uint8",
  "q4",
  "q4f16",
  "bnb4",
];

/**
 * Runtime throughput and capacity settings used only for batch planning and the pre-flight
 * viability check (specs/013-ai-enhancement-viability). Kept separate from `ModelConfig` because
 * none of it describes *which* model to load — it describes how fast this machine runs one.
 */
export interface InferencePlanningConfig {
  contextFloorTokens: number;
  prefillMsPerToken: number;
  decodeMsPerToken: number;
  viabilitySafetyFactor: number;
}

/** Resolved AI configuration for the current process: which provider to construct, and its model settings. */
export interface AIConfig {
  providerMode: AIProviderMode;
  model: ModelConfig;
  planning: InferencePlanningConfig;
}

/** Reads a positive finite number from `env`, falling back to `fallback` when unset or invalid. */
function readPositiveNumber(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Env-driven AI configuration loader, mirroring backend/src/config.ts's convention
 * (reads process.env directly, no external dependency).
 */
export function loadAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const providerMode = resolveProviderMode(env);
  const modelId = env.AI_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  const cacheDir = env.AI_MODEL_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
  const useAccelerator = env.AI_USE_ACCELERATOR === "true";
  const rawDtype = env.AI_MODEL_DTYPE?.trim();
  const dtype = rawDtype && (VALID_DTYPES as readonly string[]).includes(rawDtype)
    ? (rawDtype as ModelDType)
    : undefined;

  const parsedTimeout = env.AI_INFERENCE_TIMEOUT_MS
    ? Number.parseInt(env.AI_INFERENCE_TIMEOUT_MS, 10)
    : DEFAULT_INFERENCE_TIMEOUT_MS;
  const inferenceTimeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_INFERENCE_TIMEOUT_MS;

  const planning: InferencePlanningConfig = {
    contextFloorTokens: Math.floor(
      readPositiveNumber(env.AI_MODEL_CONTEXT_FLOOR_TOKENS, DEFAULT_CONTEXT_FLOOR_TOKENS),
    ),
    prefillMsPerToken: readPositiveNumber(
      env.AI_PREFILL_MS_PER_TOKEN,
      DEFAULT_PREFILL_MS_PER_TOKEN,
    ),
    decodeMsPerToken: readPositiveNumber(
      env.AI_DECODE_MS_PER_TOKEN,
      DEFAULT_DECODE_MS_PER_TOKEN,
    ),
    viabilitySafetyFactor: readPositiveNumber(
      env.AI_VIABILITY_SAFETY_FACTOR,
      DEFAULT_VIABILITY_SAFETY_FACTOR,
    ),
  };

  return {
    providerMode,
    model: { modelId, cacheDir, useAccelerator, inferenceTimeoutMs, dtype },
    planning,
  };
}

function resolveProviderMode(env: NodeJS.ProcessEnv): AIProviderMode {
  if (env.AI_PROVIDER_MODE === "local" || env.AI_PROVIDER_MODE === "mock") {
    return env.AI_PROVIDER_MODE;
  }
  // Explicit, non-silent default (constitution XXIX): an automated test run never
  // loads a real model unless AI_PROVIDER_MODE=local is set explicitly.
  return env.VITEST || env.NODE_ENV === "test" ? "mock" : "local";
}
