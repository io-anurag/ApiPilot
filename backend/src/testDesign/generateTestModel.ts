import type { ApiModel, ApiOperation, GenerationNote, TestModel, TestScenario } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { deduplicate } from "./deduplicate";
import { arrayBoundaryScenarios } from "./rules/arrayBoundaryScenarios";
import { enumPositiveScenarios } from "./rules/enumPositiveScenarios";
import { invalidEnumScenarios } from "./rules/invalidEnumScenarios";
import { invalidFormatScenarios } from "./rules/invalidFormatScenarios";
import { invalidTypeScenarios } from "./rules/invalidTypeScenarios";
import { minimalPositiveScenario } from "./rules/minimalPositiveScenario";
import { declaredAssertions, declaredExampleScenarios, schemaGroundedView } from "./rules/declaredExampleScenarios";
import { observedExampleScenarios } from "./rules/observedExampleScenarios";
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
 *
 * The rule list is chosen per operation by where its facts come from (specs/056, contracts/
 * observed-generation-rules.md). An operation with no provenance, or a documented one, is an OpenAPI
 * operation and runs `RULES` exactly as before. An observed operation (a HAR) runs only the
 * evidence-gated observed rules. A declared operation (an API definition) runs `RULES` over only what
 * the definition stated, plus the declared-example rule. The designer reads the normalized model only: it imports no parser.
 */
export function generateTestModelWithNotes(apiModel: ApiModel): { testModel: TestModel; notes: GenerationNote[] } {
  const startedAt = Date.now();
  const scenarios: TestScenario[] = [];
  const notes: GenerationNote[] = [];
  for (const operation of apiModel.operations) {
    if (operation.provenance?.origin === "observed") {
      const observed = observedExampleScenarios(operation);
      scenarios.push(...observed.scenarios);
      notes.push(...observed.notes);
      continue;
    }
    if (operation.provenance?.origin === "declared") {
      // The existing rules read only what the definition stated; each assertion is labelled declared.
      const view = schemaGroundedView(operation);
      for (const rule of RULES) {
        scenarios.push(...rule(view).map((scenario) => ({ ...scenario, assertions: declaredAssertions(scenario.assertions) })));
      }
      scenarios.push(...declaredExampleScenarios(operation));
      continue;
    }
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
  return { testModel: { scenarios: deduped }, notes };
}

/** The deterministic test model for `apiModel`; callers that also need the "no scenarios" notes use `generateTestModelWithNotes`. */
export function generateTestModel(apiModel: ApiModel): TestModel {
  return generateTestModelWithNotes(apiModel).testModel;
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
