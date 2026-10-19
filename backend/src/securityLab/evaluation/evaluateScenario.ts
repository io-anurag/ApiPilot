import { confidenceFor } from "./confidence";
import { evaluateConditions } from "./evaluateConditions";
import { buildObservedSummary } from "./observedSummary";
import { outcomeOf, reasonFor } from "./scenarioOutcome";
import type { Evaluator, ScenarioEvaluation } from "./types";

/**
 * The deterministic evaluator injected into the run service (specs/057 research R15, FR-053). It judges the
 * responses of one scenario against the explicit conditions the approved scenario states, and nothing else: no
 * model, no clock, no randomness, so evaluating the same evidence twice gives an equal result. A failed result also
 * carries its confidence and the basis for it. Severity is not touched here: the engine never raises it.
 */
export const evaluateScenario: Evaluator = (execution): ScenarioEvaluation => {
  const { content, responses, secrets } = execution;
  const conditionResults = evaluateConditions({ content, responses });
  const outcome = outcomeOf(conditionResults);
  return {
    outcome,
    reason: reasonFor(outcome, conditionResults),
    conditionResults,
    observed: buildObservedSummary(content, responses, conditionResults, secrets),
    ...(outcome === "failed" ? { confidence: confidenceFor(content, responses, conditionResults) } : {}),
  };
};
