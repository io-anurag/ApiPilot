import type { ConditionResult, ObservedSummary, SecurityScenarioContent } from "@apipilot/shared-domain";

/**
 * The seam between running a scenario and judging it (specs/057 research R15, tasks T100 and T119). The run service
 * collects what every request of a scenario returned and hands it to an injected `Evaluator`; it never decides
 * `passed` or `failed` itself. Blocked destinations, transport failures, cancellation and an exhausted budget are
 * decided by the run service because nothing was judged; everything else is the evaluator's.
 */

/** One response a scenario received. The body is decoded text, at most the response read cap. */
export interface ExecutedResponse {
  readonly index: number;
  readonly method: string;
  readonly status: number;
  /** Lowercase names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface ScenarioExecution {
  readonly content: SecurityScenarioContent;
  /** Every response, in the order sent. Never empty: a scenario with no response is not evaluated. */
  readonly responses: readonly ExecutedResponse[];
  /** How many requests the scenario planned, so an evaluator can tell a short series from a complete one. */
  readonly plannedRequests: number;
  /** Credential values the run resolved, for the evaluator to avoid ever quoting one. */
  readonly secrets: readonly string[];
}

export interface ScenarioEvaluation {
  readonly outcome: "passed" | "failed" | "inconclusive";
  readonly reason: string;
  readonly conditionResults: readonly ConditionResult[];
  readonly observed: ObservedSummary;
  /** Present for a `failed` outcome only: how sure the evidence makes us, and why. Never assigned by a model. */
  readonly confidence?: { readonly level: "high" | "medium" | "low"; readonly basis: string };
}

export type Evaluator = (execution: ScenarioExecution) => ScenarioEvaluation;
