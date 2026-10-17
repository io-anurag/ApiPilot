/**
 * Post-load verification of a hardware accelerator (specs/055-accelerator-canary-check).
 *
 * An accelerator can load without error and still produce unusable inference (measured: random
 * text, an empty reply, or off-schema JSON). So after an accelerated engine loads, the provider runs
 * one fixed canary inference and keeps the accelerator only if the reply is usable. This module holds
 * the fixed input and the pure reply check; the provider owns time, errors and the CPU fallback.
 *
 * The canary wording is load-bearing, not cosmetic. Two natural phrasings ("Return an empty
 * candidates list.", and a longer instruction to answer with an empty candidates array) make a
 * healthy Qwen2.5-0.5B answer `{}` on CPU, which would reject a working accelerator. The copy-style
 * text below passes on both shipped models on CPU and fails every measured bad accelerator
 * configuration (research.md Decisions 2 and 3). Any change to the input, the cap or the pass rule
 * changes behavior: bump `ACCELERATOR_CANARY_VERSION`, update research.md, and re-run the opt-in
 * real-model test (`npm run test:ai-real -w backend`) against every shipped model.
 */
import type { AcceleratorVerification } from "@apipilot/shared-domain";

/** Failure category the pure reply check can decide; timeouts and engine errors are the provider's. */
export type CanaryFailureCategory = NonNullable<AcceleratorVerification["failureCategory"]>;

export type CanaryEvaluation = { passed: true } | { passed: false; failureCategory: "unusable-reply" };

/** Version of the canary definition below, recorded in every verification result and log line. */
export const ACCELERATOR_CANARY_VERSION = 1;

/** Fixed user text. The expected reply is exactly `{"candidates":[]}` (4 tokens on both shipped models). */
export const ACCELERATOR_CANARY_INPUT = 'Reply with exactly: {"candidates":[]}';

/**
 * Output cap. A valid reply is 4 tokens (about 10 when pretty-printed), so 12 leaves slack, while a
 * broken accelerator emits garbage until the cap, so the cap bounds the cost of the failing path
 * (measured about 0.7 to 1 s per garbage token).
 */
export const ACCELERATOR_CANARY_MAX_NEW_TOKENS = 12;

/**
 * A usable reply parses as JSON, is an object (not an array, null or a scalar), and has an array
 * `candidates` property. An empty array passes: this detects an unusable accelerator, not a weak
 * model, and `{"candidates":[]}` is already a valid reply in the scenario contract. Never throws.
 */
export function evaluateCanaryReply(content: string): CanaryEvaluation {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { passed: false, failureCategory: "unusable-reply" };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { candidates?: unknown }).candidates)
  ) {
    return { passed: true };
  }
  return { passed: false, failureCategory: "unusable-reply" };
}
