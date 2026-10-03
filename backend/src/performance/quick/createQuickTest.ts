import { randomUUID } from "node:crypto";
import { createLogger } from "../../logger";
import { buildApiModel } from "../../openapi/buildApiModel";
import { parseYaml } from "../../openapi/parseYaml";
import { validateSpec } from "../../openapi/validateSpec";
import { generatePositiveScenarios } from "../../testDesign/generateTestModel";
import { QuickTestExistsError } from "../errors";
import { withQuickScenarioIds } from "./quickScenarioIds";
import { hasQuickTest, setQuickTest, type QuickPerformanceTest } from "./quickTestStore";

const logger = createLogger("performance.quick");

/**
 * Creates the session's quick performance test from an uploaded specification (AP-032,
 * specs/032-quick-performance-test FR-002 to FR-006, research Q14, Q15):
 * - the unchanged parse, validate and model-building pipeline, whose `InvalidYamlError` and
 *   `UnsupportedVersionError` propagate to app.ts's centralized handler, exactly as for the guided
 *   upload;
 * - positive rule-generated scenarios only, with content-derived ids, and no AI (FR-004, FR-007).
 *
 * Since AP-037 phase two the quick test only seeds request-chain plans; no plan is built here.
 * Nothing is stored unless every step succeeds. It never touches the guided workflow (FR-021).
 */
export async function createQuickTest(fileBuffer: Buffer, filename: string, replaceExisting: boolean): Promise<QuickPerformanceTest> {
  const replaced = hasQuickTest();
  if (replaced && !replaceExisting) throw new QuickTestExistsError();

  const rawDocument = parseYaml(fileBuffer.toString("utf-8"));
  const { document, issues } = await validateSpec(rawDocument);
  const apiModel = buildApiModel(document, issues);
  const scenarios = withQuickScenarioIds(generatePositiveScenarios(apiModel));

  const test: QuickPerformanceTest = {
    id: randomUUID(),
    specification: { filename, ...(apiModel.info ? { info: apiModel.info } : {}), operationCount: apiModel.operations.length },
    apiModel,
    scenarios,
  };
  setQuickTest(test);
  logger.info("quick_performance_test_created", {
    operationCount: apiModel.operations.length,
    scenarioCount: scenarios.length,
    replaced,
  });
  return test;
}
