import type { TestScenario } from "@apipilot/shared-domain";
import { assembleWorkflows } from "../../../src/dependencies/assembleWorkflows";
import { computeDeterministicRelationships } from "../../../src/dependencies/deterministicMatching";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { loadPerformanceApiModel } from "./specification";

/**
 * A `PerformanceContext` for `performance.yaml` built with the real analysis, deterministic
 * generation and workflow assembly, every scenario accepted and the workflow approved (as
 * `driveToPostmanGenerationComplete` does through the routes). Scenario ids, which generation
 * makes random, are replaced by stable ones so golden files do not depend on them.
 */
export async function performanceContext(
  overrides: { mutateScenarios?: (scenarios: TestScenario[]) => TestScenario[] } = {},
): Promise<PerformanceContext> {
  const apiModel = await loadPerformanceApiModel();
  const generated = generateTestModel(apiModel).scenarios;
  const counters = new Map<string, number>();
  let scenarios = generated.map((scenario) => {
    const key = `${scenario.operationMethod.toUpperCase()}_${scenario.operationPath}_${scenario.category}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    return { ...scenario, id: `sc_${key.replace(/[^A-Za-z0-9_]+/g, "-")}_${index}` };
  });
  if (overrides.mutateScenarios) scenarios = overrides.mutateScenarios(scenarios);
  const relationships = computeDeterministicRelationships(apiModel);
  const { workflows } = assembleWorkflows(relationships);
  return { apiModel, approvedScenarios: scenarios, workflows, relationships, source: "guided" };
}
