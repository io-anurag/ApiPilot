import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { numericBoundaryValues } from "../valueGenerators";
import { generateBoundaryScenarios, type BoundaryVariant } from "../boundaryMutation";

/** For every numeric field/parameter with declared minimum/maximum, generates boundary scenarios (FR-005). */
export function numericBoundaryScenarios(operation: ApiOperation): TestScenario[] {
  return generateBoundaryScenarios(operation, {
    category: "numeric-boundary",
    rulePrefix: "numeric-boundary",
    describe: (target, key) => `${target} set to a value ${key.replaceAll("-", " ")}.`,
    variantsFor: (schema) => {
      const values = numericBoundaryValues(schema);
      const variants: BoundaryVariant[] = [];
      if (values.belowMinimum !== undefined) variants.push({ key: "below-minimum", value: values.belowMinimum, outcome: "invalid" });
      if (values.atMinimum !== undefined) variants.push({ key: "at-minimum", value: values.atMinimum, outcome: "valid" });
      if (values.atMaximum !== undefined) variants.push({ key: "at-maximum", value: values.atMaximum, outcome: "valid" });
      if (values.aboveMaximum !== undefined) variants.push({ key: "above-maximum", value: values.aboveMaximum, outcome: "invalid" });
      return variants;
    },
  });
}
