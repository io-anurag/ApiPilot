import type { ConditionResult, EvaluationCondition, ScenarioOutcomeKind } from "@apipilot/shared-domain";
import { LEAK_PATTERN_LABELS } from "./leakPatterns";

/**
 * How condition results become a scenario outcome (specs/057 contracts/evaluation-and-findings-rules.md "Scenario
 * outcome"). The precedence is fixed:
 *
 *   blocked, not_run, errored   decided by the run service, because nothing could be judged
 *   failed                      any condition violated
 *   inconclusive                else any condition indeterminate, or there was no condition to judge
 *   passed                      else
 *
 * `passed` therefore means every condition was satisfied, and never means "nothing went wrong that we could see".
 */
export type JudgedOutcome = Extract<ScenarioOutcomeKind, "passed" | "failed" | "inconclusive">;

export function outcomeOf(results: readonly ConditionResult[]): JudgedOutcome {
  if (results.length === 0) return "inconclusive";
  if (results.some((result) => result.state === "violated")) return "failed";
  if (results.some((result) => result.state === "indeterminate")) return "inconclusive";
  return "passed";
}

/** The fixed wording for a condition, as a statement of what was expected to be true. */
export function describeCondition(condition: EvaluationCondition): string {
  switch (condition.kind) {
    case "status.not-success":
      return "the response is not a success (2xx)";
    case "status.in-set":
      return `the status is ${condition.codes.length === 1 ? "" : "one of "}${condition.codes.join(", ")}`;
    case "status.equals":
      return `the status is ${condition.code}`;
    case "status.not-equals":
      return `the status is not ${condition.code}`;
    case "header.present":
      return `the ${condition.name} header is present`;
    case "header.absent":
      return `the ${condition.name} header is absent`;
    case "header.value-not-contains":
      return `the ${condition.name} header does not contain "${condition.token}"`;
    case "body.field-absent":
      return `the body has no ${condition.path} field`;
    case "body.field-present":
      return `the body has a ${condition.path} field`;
    case "body.not-match-leak-pattern":
      return `the body shows no ${LEAK_PATTERN_LABELS[condition.patternId]}`;
    case "repeat.limit-engaged":
      return `a rate limit engages within ${condition.withinRequests} requests`;
    case "persisted.field-unchanged":
      return `the request does not set ${condition.path}`;
  }
}

/** The reason recorded on a result: which conditions decided it, in plain words. */
export function reasonFor(outcome: JudgedOutcome, results: readonly ConditionResult[]): string {
  const list = (state: ConditionResult["state"]) => results.filter((result) => result.state === state).map((result) => describeCondition(result.condition));
  if (outcome === "failed") return `Expected ${list("violated").join("; and ")}, but that did not hold.`;
  if (outcome === "inconclusive") {
    if (results.length === 0) return "The scenario states no condition to judge, so the response was recorded but not judged.";
    return `Could not judge whether ${list("indeterminate").join("; and ")}.`;
  }
  return "Every condition was satisfied.";
}
