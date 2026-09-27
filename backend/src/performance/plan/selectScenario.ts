import type { ScenarioChoiceReason, TestScenario } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";

/**
 * FR-002, FR-003 (specs/031-k6-performance-testing research D4): exactly one positive scenario per
 * operation, chosen by a fixed rule: rule-generated before AI-enhanced, then the lowest scenario id
 * by code-unit comparison. Negative scenarios are never considered. Deliberately free of any
 * k6-specific dependency, so the Postman alignment follow-up (ROADMAP Next Actions #30) can reuse it.
 */
export type PerformanceScenarioSelection =
  | { scenario: TestScenario; reason: ScenarioChoiceReason; tieBrokenByLowestId: boolean }
  | { omitted: "no-positive-scenario" };

function sameOperation(scenario: TestScenario, operation: { path: string; method: string }): boolean {
  return (
    scenario.operationPath === operation.path &&
    scenario.operationMethod.toUpperCase() === operation.method.toUpperCase()
  );
}

export function selectPerformanceScenario(
  approvedScenarios: readonly TestScenario[],
  operation: { path: string; method: string },
): PerformanceScenarioSelection {
  const positives = approvedScenarios.filter(
    (scenario) => scenario.category === "positive" && sameOperation(scenario, operation),
  );
  if (positives.length === 0) return { omitted: "no-positive-scenario" };

  const ruleGenerated = positives.filter((scenario) => scenario.provenance.source === "RULE");
  const pool = ruleGenerated.length > 0 ? ruleGenerated : positives;
  const [scenario] = [...pool].sort((a, b) => compareCodeUnits(a.id, b.id));

  let reason: ScenarioChoiceReason;
  if (positives.length === 1) reason = "only-positive";
  else if (ruleGenerated.length > 0) reason = "rule-generated";
  else reason = "ai-enhanced-no-rule-alternative";

  return { scenario, reason, tieBrokenByLowestId: pool.length > 1 };
}
