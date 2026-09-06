/**
 * Maps an internal failure cause to what the user is actually told
 * (specs/013-ai-enhancement-viability/contracts/failure-explanation.md, FR-023..FR-026).
 *
 * The message this replaces was
 *   "AI enhancement was skipped (TIMEOUT): Inference exceeded the configured timeout of 300000ms."
 * which leaks an internal category literal, an implementation constant and a raw millisecond
 * value, tells the user nothing they can act on, and — via a retry control offered identically for
 * every failure kind — invites them to spend another five minutes reaching the same outcome.
 *
 * Lives in the domain layer rather than the frontend so that error semantics are defined once
 * (constitution IX, X), and is a pure total function so every branch is directly unit-testable
 * without a provider (constitution XXI).
 */
import type {
  AIErrorCategory,
  FailureExplanation,
} from "@apipilot/shared-domain";
import { formatDuration } from "../ai/viability";

/** Everything that can end an AI enhancement run unsuccessfully. */
export type FailureCause =
  | AIErrorCategory
  | "cancelled"
  | "not-viable"
  | "run-budget-exhausted";

export interface FailureContext {
  /** For "not-viable": how long the work was projected to take. */
  projectedMs?: number;
  /** For "not-viable": the configured budget it was compared against. */
  budgetMs?: number;
  /** For INVALID_REQUEST: which operation could not be processed, e.g. "GET /pets". */
  operationLabel?: string;
  /** For "run-budget-exhausted": how many planned units the ceiling never started. */
  notStartedCount?: number;
  /** For "run-budget-exhausted": how many units the run planned in total. */
  plannedCount?: number;
  /**
   * The provider's own readiness reason. Passed through only when it is already plain language;
   * callers must not forward raw diagnostic strings, which FR-024 forbids surfacing.
   */
  readinessReason?: string;
}

/** Appends a reason as its own sentence when one is available. */
function withReason(base: string, reason: string | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) return base;
  const punctuated = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${punctuated} ${base}`;
}

export function explainFailure(
  cause: FailureCause,
  context: FailureContext = {},
): FailureExplanation {
  switch (cause) {
    case "TIMEOUT":
      return {
        category: "too-slow",
        summary: "The local AI model was too slow to finish this on this machine.",
        nextStep:
          "Try enhancing a smaller specification, or see the setup notes on making local " +
          "inference faster. Your deterministic scenarios are unaffected and ready to review.",
        // Under unchanged conditions the same work takes the same time, so a retry would spend
        // the whole budget again to reach this identical outcome (FR-025).
        retryable: false,
      };

    case "not-viable": {
      const projected = context.projectedMs;
      const budget = context.budgetMs;
      const summary =
        projected !== undefined && budget !== undefined
          ? `This specification needs ${formatDuration(projected)} of AI processing, but the ` +
            `current limit is ${formatDuration(budget)}.`
          : "This specification needs more AI processing time than the current limit allows.";
      return {
        category: "not-viable",
        summary,
        nextStep:
          "Enhance a smaller specification, or raise the inference time limit in your " +
          "configuration. Nothing was run, so no time was spent waiting.",
        retryable: false,
      };
    }

    case "run-budget-exhausted": {
      // Shares the `too-slow` category with TIMEOUT (contracts/run-budget.md outcome mapping) but
      // not its wording: nothing timed out and nothing was lost. The run worked through as much of
      // the specification as its ceiling allowed and handed the rest back unattempted, which is a
      // different thing to tell a user than "the model was too slow".
      const covered =
        context.notStartedCount !== undefined && context.plannedCount !== undefined
          ? `${context.plannedCount - context.notStartedCount} of ${context.plannedCount} ` +
            `operations were covered`
          : "part of the specification was covered";
      const allowed =
        context.budgetMs !== undefined
          ? ` within the ${formatDuration(context.budgetMs)} allowed for one run`
          : " within the time allowed for one run";
      return {
        category: "too-slow",
        summary: `AI enhancement covered as much as it could: ${covered}${allowed}.`,
        nextStep:
          "Every scenario it produced has been kept and is ready to review. To cover more, raise " +
          "the run time limit in your configuration or enhance a smaller specification.",
        // A retry under unchanged configuration re-runs the same units in the same order and stops
        // at the same place, so offering one would only spend the ceiling again (FR-025).
        retryable: false,
      };
    }

    case "NOT_READY":
      return {
        category: "unavailable",
        summary: "The local AI model isn't ready yet.",
        nextStep: withReason(
          "Once it has finished preparing, you can run enhancement again.",
          context.readinessReason,
        ),
        retryable: true,
      };

    case "LOAD_FAILED":
      return {
        category: "unavailable",
        summary: "The local AI model couldn't be loaded.",
        nextStep: withReason(
          "Check that the model files downloaded correctly, then try again.",
          context.readinessReason,
        ),
        retryable: true,
      };

    case "PROVIDER_UNAVAILABLE":
      return {
        category: "unavailable",
        summary: "Local AI is unavailable right now.",
        nextStep: withReason(
          "Your deterministic scenarios are unaffected and ready to review.",
          context.readinessReason,
        ),
        retryable: true,
      };

    case "INVALID_RESPONSE":
      return {
        category: "unusable-output",
        summary: "The AI model replied with output that couldn't be used.",
        nextStep:
          "This can happen intermittently — running enhancement again will often succeed.",
        retryable: true,
      };

    case "INVALID_REQUEST":
      return {
        category: "too-large",
        summary: context.operationLabel
          ? `Part of this specification is too large for the AI model to process in one piece, ` +
            `starting with ${context.operationLabel}.`
          : "Part of this specification is too large for the AI model to process in one piece.",
        nextStep:
          "Enhancement covered everything else. Consider simplifying that operation's schema if " +
          "you want AI suggestions for it.",
        retryable: false,
      };

    case "cancelled":
      return {
        category: "cancelled",
        summary: "AI enhancement was cancelled before it finished.",
        nextStep:
          "Any scenarios generated before you cancelled have been kept. You can continue, or " +
          "run enhancement again.",
        retryable: true,
      };
  }
}
