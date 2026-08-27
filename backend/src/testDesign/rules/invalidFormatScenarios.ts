import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { formatViolatingValue } from "../valueGenerators";
import { generateSingleFieldMutationScenarios } from "../singleFieldMutation";

/** For every field/parameter with a declared `format` or `pattern`, generates a violating-value scenario (FR-008). */
export function invalidFormatScenarios(operation: ApiOperation): TestScenario[] {
  return generateSingleFieldMutationScenarios(operation, {
    category: "invalid-format",
    rule: "invalid-format",
    describe: (target) => `${target} set to a value violating its declared format/pattern.`,
    valueFor: (schema) => formatViolatingValue(schema),
  });
}
