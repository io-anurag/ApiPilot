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
 *
 * The prefill seed was 2.0 ms/token, inherited from an estimate rather than a measurement. Direct
 * measurement against the reference profile puts it at **~42 ms/token** — 21x higher — and
 * remarkably linear: holding the output allowance fixed at 32 tokens and varying only prompt size
 * gave 43.4, 41.3 and 42.1 ms/prompt-token at 441, 828 and 1,132 prompt tokens respectively.
 *
 * That single number reframes the whole cost model. Prefill, not generation, is what a request
 * spends its time on: a ~1,130-token prompt costs roughly 47 seconds before the first output token
 * exists, which is why a single-operation request over a large request body exceeded the 60-second
 * default even with the output allowance cut to 96 tokens. Prompt size is the dominant lever, and
 * an estimator seeded at 2.0 would have declared every such run viable
 * (specs/014-ai-batching-policy).
 */
const DEFAULT_PREFILL_MS_PER_TOKEN = 42;
const DEFAULT_DECODE_MS_PER_TOKEN = 180;

/**
 * How far a projected duration may exceed the configured timeout before the run is refused.
 *
 * 1.0: refuse anything projected to exceed the budget. This was 1.5, on the reasoning that
 * "wrongly refusing a viable run would be a worse failure than wrongly attempting one, since the
 * timeout still backstops the latter" — sound when projections were tiny (the prefill seed was 21x
 * too low, so the factor never actually decided anything) and attempts were assumed cheap.
 *
 * Both halves of that reasoning have since failed. `budgetMs` *is* the per-request hard timeout, so
 * permitting `projected <= budget x 1.5` approved work projected at 68 seconds against a 60-second
 * wall — guaranteed to fail, every time. And an attempt is not cheap: with one unit per operation, a
 * 39-operation specification spent roughly 40 minutes discovering unit-by-unit what the projection
 * already implied. Above 1.0 the check cannot do the one job it exists for.
 *
 * Lower it below 1.0 for genuine headroom; raise it only if you would rather attempt marginal runs
 * than be told about them (specs/014-ai-batching-policy).
 */
const DEFAULT_VIABILITY_SAFETY_FACTOR = 1.0;

/**
 * Operations per AI request for scenario enhancement (specs/014-ai-batching-policy research.md
 * Decision 1).
 *
 * One, because that is what measurement supports rather than what seems generous: across the six
 * operations of a real springdoc-style specification, one operation per request produced a validly
 * shaped reply for all six, while two and three operations both truncated mid-document even at a
 * larger output allowance, and a whole-specification request made the model echo the request back
 * instead of answering it.
 *
 * Configurable rather than fixed because that result describes this CPU and this 0.5B model, not
 * the domain: a faster machine or a stronger model may well manage more, and should be able to try
 * without a code change.
 */
const DEFAULT_ENHANCEMENT_OPERATIONS_PER_UNIT = 1;

/**
 * Wall-clock ceiling for a whole enhancement run (research.md Decision 5).
 *
 * Five minutes. At a measured ~21 seconds per single-operation unit, total run time is now linear in
 * specification size — roughly 2 minutes for 6 operations, 17 for 50, 70 for 200 — so a ceiling is
 * what stops work-bounded batching from replacing "fails in one minute" with "runs for an hour".
 * Five minutes covers roughly 14 operations, which is about as long as a user will watch scenarios
 * stream in, and the run settles as `partial` with everything generated retained.
 */
const DEFAULT_ENHANCEMENT_RUN_BUDGET_MS = 300_000;

/**
 * Conservative characters-per-token estimate used only to plan work before sending a request
 * (specs/011-ai-prompt-batching research.md Decision 2) — deliberately on the low side, because
 * JSON-heavy prompts full of punctuation and numbers tokenize less efficiently than prose, and the
 * loaded engine's exact tokenizer guard remains the authoritative fits/doesn't-fit check. This
 * estimate only needs to usually avoid tripping that guard, not match it exactly.
 *
 * Lives here rather than in `localProvider` so planning code can convert characters to tokens
 * without importing the provider — and with it the whole inference library. `enhanceTestModel`
 * needs exactly that for its pre-flight estimate, and pulling the runtime into the test-design
 * layer would both slow every import and breach the provider boundary (constitution VI, IX).
 */
export const CHARS_PER_TOKEN_ESTIMATE = 3;
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
  /**
   * Operations per AI request for scenario enhancement (specs/014-ai-batching-policy FR-001).
   * Sizing a request by work rather than by remaining context is what keeps its reply short enough
   * to be usable.
   */
  enhancementOperationsPerUnit: number;
  /**
   * Wall-clock ceiling for a whole enhancement run (FR-009), distinct from `inferenceTimeoutMs`,
   * which bounds a single request. Work-bounded units make total run time grow with specification
   * size, so a run needs a bound of its own.
   */
  enhancementRunBudgetMs: number;
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
    enhancementOperationsPerUnit: Math.floor(
      readPositiveNumber(
        env.AI_ENHANCEMENT_OPERATIONS_PER_UNIT,
        DEFAULT_ENHANCEMENT_OPERATIONS_PER_UNIT,
      ),
    ),
    enhancementRunBudgetMs: Math.floor(
      readPositiveNumber(
        env.AI_ENHANCEMENT_RUN_BUDGET_MS,
        DEFAULT_ENHANCEMENT_RUN_BUDGET_MS,
      ),
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
