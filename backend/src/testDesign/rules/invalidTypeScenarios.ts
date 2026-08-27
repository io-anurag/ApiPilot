import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { incompatibleTypeValue } from "../valueGenerators";
import { generateSingleFieldMutationScenarios } from "../singleFieldMutation";

/** For every field/parameter with a declared type, generates an incompatible-type scenario (FR-003). */
export function invalidTypeScenarios(operation: ApiOperation): TestScenario[] {
  return generateSingleFieldMutationScenarios(operation, {
    category: "invalid-type",
    rule: "invalid-type",
    describe: (target) => `${target} set to a value of an incompatible type.`,
    valueFor: (schema) => (schema.type ? incompatibleTypeValue(schema) : undefined),
  });
}
