import type { ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { deduplicate } from "./deduplicate";
import { arrayBoundaryScenarios } from "./rules/arrayBoundaryScenarios";
import { invalidEnumScenarios } from "./rules/invalidEnumScenarios";
import { invalidFormatScenarios } from "./rules/invalidFormatScenarios";
import { invalidTypeScenarios } from "./rules/invalidTypeScenarios";
import { numericBoundaryScenarios } from "./rules/numericBoundaryScenarios";
import { positiveScenario } from "./rules/positiveScenario";
import { requiredFieldScenarios } from "./rules/requiredFieldScenarios";
import { stringBoundaryScenarios } from "./rules/stringBoundaryScenarios";

const logger = createLogger("testDesign.generateTestModel");

const RULES: ((operation: ApiOperation) => TestScenario[])[] = [
  positiveScenario,
  requiredFieldScenarios,
  invalidTypeScenarios,
  invalidFormatScenarios,
  invalidEnumScenarios,
  numericBoundaryScenarios,
  stringBoundaryScenarios,
  arrayBoundaryScenarios,
];

/**
 * No per-operation issue check here (FR-018 skips generation per-construct, not per-operation):
 * buildApiModel.ts already degrades an unresolved/unsupported schema node to an empty constraint
 * rather than fabricating one, so the rules below naturally skip only the affected construct.
 */
export function generateTestModel(apiModel: ApiModel): TestModel {
  const startedAt = Date.now();
  const scenarios: TestScenario[] = [];
  for (const operation of apiModel.operations) {
    for (const rule of RULES) {
      scenarios.push(...rule(operation));
    }
  }
  const deduped = deduplicate(scenarios);
  logger.info("deterministic_generation_complete", {
    operationCount: apiModel.operations.length,
    scenarioCount: deduped.length,
    durationMs: Date.now() - startedAt,
  });
  return { scenarios: deduped };
}
