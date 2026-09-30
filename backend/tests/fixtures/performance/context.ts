import type { TestScenario } from "@apipilot/shared-domain";
import { assembleWorkflows } from "../../../src/dependencies/assembleWorkflows";
import { computeDeterministicRelationships } from "../../../src/dependencies/deterministicMatching";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { withQuickScenarioIds } from "../../../src/performance/quick/quickScenarioIds";
import { generatePositiveScenarios, generateTestModel } from "../../../src/testDesign/generateTestModel";
import { loadBodyEditsApiModel, loadParameterEditsApiModel, loadPerformanceApiModel, loadQuickApiModel } from "./specification";

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

/**
 * AP-032: a `PerformanceContext` for `quick-performance.yaml` as the quick path builds it (specs/032
 * research Q1, Q3, Q4): positive scenarios only, quick ids, no workflows or relationships, and every
 * operation in scope. `source: "guided"` gives the same inputs with the guided path's defaults.
 */
export async function quickContext(source: "quick" | "guided" = "quick"): Promise<PerformanceContext> {
  const apiModel = await loadQuickApiModel();
  return {
    apiModel,
    approvedScenarios: withQuickScenarioIds(generatePositiveScenarios(apiModel)),
    workflows: [],
    relationships: [],
    source,
  };
}

/**
 * AP-033: a quick `PerformanceContext` for `body-edits.yaml` (specs/033 tasks T001). `mutateScenarios`
 * lets a test remove a body, for example to cover `documented-not-sent`.
 */
export async function bodyEditsContext(
  overrides: { mutateScenarios?: (scenarios: TestScenario[]) => TestScenario[] } = {},
): Promise<PerformanceContext> {
  const apiModel = await loadBodyEditsApiModel();
  let scenarios = withQuickScenarioIds(generatePositiveScenarios(apiModel));
  if (overrides.mutateScenarios) scenarios = overrides.mutateScenarios(scenarios);
  return { apiModel, approvedScenarios: scenarios, workflows: [], relationships: [], source: "quick" };
}

/** AP-033 FR-020 (amended 2026-09-30): a quick `PerformanceContext` for `parameter-edits.yaml`. */
export async function parameterEditsContext(): Promise<PerformanceContext> {
  const apiModel = await loadParameterEditsApiModel();
  return { apiModel, approvedScenarios: withQuickScenarioIds(generatePositiveScenarios(apiModel)), workflows: [], relationships: [], source: "quick" };
}
