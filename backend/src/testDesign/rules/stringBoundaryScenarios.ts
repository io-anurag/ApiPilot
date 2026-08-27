import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { stringBoundaryValues } from "../valueGenerators";
import { generateBoundaryScenarios, type BoundaryVariant } from "../boundaryMutation";

/** For every string field/parameter with declared minLength/maxLength, generates boundary scenarios (FR-006). */
export function stringBoundaryScenarios(operation: ApiOperation): TestScenario[] {
  return generateBoundaryScenarios(operation, {
    category: "string-boundary",
    rulePrefix: "string-boundary",
    describe: (target, key) => `${target} set to a string ${key.replaceAll("-", " ")} length.`,
    variantsFor: (schema) => {
      const values = stringBoundaryValues(schema);
      const variants: BoundaryVariant[] = [];
      if (values.belowMinLength !== undefined) variants.push({ key: "below-minimum", value: values.belowMinLength, outcome: "invalid" });
      if (values.atMinLength !== undefined) variants.push({ key: "at-minimum", value: values.atMinLength, outcome: "valid" });
      if (values.atMaxLength !== undefined) variants.push({ key: "at-maximum", value: values.atMaxLength, outcome: "valid" });
      if (values.aboveMaxLength !== undefined) variants.push({ key: "above-maximum", value: values.aboveMaxLength, outcome: "invalid" });
      return variants;
    },
  });
}
