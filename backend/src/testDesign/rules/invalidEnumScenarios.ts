import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { enumViolatingValue } from "../valueGenerators";
import { generateSingleFieldMutationScenarios } from "../singleFieldMutation";

/** For every field/parameter with a declared `enum`, generates an out-of-set value scenario (FR-004). */
export function invalidEnumScenarios(operation: ApiOperation): TestScenario[] {
  return generateSingleFieldMutationScenarios(operation, {
    category: "invalid-enum",
    rule: "invalid-enum",
    describe: (target) => `${target} set to a value outside its declared enum.`,
    valueFor: (schema) => enumViolatingValue(schema),
  });
}
