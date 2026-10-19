import type { ObservedSummary } from "@apipilot/shared-domain";
import { selectResponseHeaders } from "../evidence/excerpt";
import type { Evaluator, ExecutedResponse, ScenarioEvaluation } from "./types";

/**
 * A bounded, deterministic description of the last response, never an excerpt of its body (specs/057 data-model
 * section 6). Used for outcomes that were not judged and as the base of an evaluated outcome's summary.
 */
export function basicObservedSummary(last: ExecutedResponse | undefined, secrets: readonly string[], statement?: string): ObservedSummary {
  return {
    ...(last ? { responseStatus: last.status } : {}),
    responseHeadersSelected: last ? selectResponseHeaders(last.headers, secrets) : {},
    statement: statement ?? (last ? `Status ${last.status}.` : "No response was received."),
    truncated: last?.truncated ?? false,
  };
}

/**
 * The evaluator used until the deterministic evaluation lands (user story 4): it records what was observed and judges
 * nothing, so a run is honest about not having a verdict. A scenario is never reported as passed or failed here.
 */
export const pendingEvaluator: Evaluator = (execution): ScenarioEvaluation => ({
  outcome: "inconclusive",
  reason: "Evaluation is not available yet, so this response was recorded but not judged.",
  conditionResults: execution.content.conditions.map((condition) => ({ condition, state: "indeterminate" as const })),
  observed: basicObservedSummary(execution.responses.at(-1), execution.secrets),
});
