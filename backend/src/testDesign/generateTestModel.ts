import type { ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { deduplicate } from "./deduplicate";
import { arrayBoundaryScenarios } from "./rules/arrayBoundaryScenarios";
import { enumPositiveScenarios } from "./rules/enumPositiveScenarios";
import { invalidEnumScenarios } from "./rules/invalidEnumScenarios";
import { invalidFormatScenarios } from "./rules/invalidFormatScenarios";
import { invalidTypeScenarios } from "./rules/invalidTypeScenarios";
import { minimalPositiveScenario } from "./rules/minimalPositiveScenario";
import { numericBoundaryScenarios } from "./rules/numericBoundaryScenarios";
import { positiveScenario } from "./rules/positiveScenario";
import { requiredFieldScenarios } from "./rules/requiredFieldScenarios";
import { stringBoundaryScenarios } from "./rules/stringBoundaryScenarios";

const logger = createLogger("testDesign.generateTestModel");

type Rule = (operation: ApiOperation) => TestScenario[];

/**
 * The positive-category rules, in generation order. AP-032's quick performance test runs only
 * these (specs/032-quick-performance-test FR-004, research Q3); the order is also the rank of the
 * quick path's scenario ids (research Q4), so it has this one definition.
 */
export const POSITIVE_RULES: readonly Rule[] = [positiveScenario, enumPositiveScenarios, minimalPositiveScenario];

const RULES: readonly Rule[] = [
  ...POSITIVE_RULES,
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

/**
 * Positive scenarios only, for every operation (AP-032 FR-004): the same rules and deduplication
 * as `generateTestModel`, without generating any negative scenario.
 */
export function generatePositiveScenarios(apiModel: ApiModel): TestScenario[] {
  const startedAt = Date.now();
  const scenarios: TestScenario[] = [];
  for (const operation of apiModel.operations) {
    for (const rule of POSITIVE_RULES) {
      scenarios.push(...rule(operation));
    }
  }
  const deduped = deduplicate(scenarios);
  logger.info("positive_generation_complete", {
    operationCount: apiModel.operations.length,
    scenarioCount: deduped.length,
    durationMs: Date.now() - startedAt,
  });
  return deduped;
}
