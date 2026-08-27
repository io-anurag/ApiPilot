import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { arrayBoundaryValues } from "../valueGenerators";
import { generateBoundaryScenarios, type BoundaryVariant } from "../boundaryMutation";

/** For every array field with declared minItems/maxItems, generates boundary scenarios (FR-007). */
export function arrayBoundaryScenarios(operation: ApiOperation): TestScenario[] {
  return generateBoundaryScenarios(operation, {
    category: "array-boundary",
    rulePrefix: "array-boundary",
    describe: (target, key) => `${target} set to an array with ${key.replaceAll("-", " ")} item count.`,
    variantsFor: (schema) => {
      const values = arrayBoundaryValues(schema);
      const variants: BoundaryVariant[] = [];
      if (values.belowMinItems !== undefined) variants.push({ key: "below-minimum", value: values.belowMinItems, outcome: "invalid" });
      if (values.atMinItems !== undefined) variants.push({ key: "at-minimum", value: values.atMinItems, outcome: "valid" });
      if (values.atMaxItems !== undefined) variants.push({ key: "at-maximum", value: values.atMaxItems, outcome: "valid" });
      if (values.aboveMaxItems !== undefined) variants.push({ key: "above-maximum", value: values.aboveMaxItems, outcome: "invalid" });
      return variants;
    },
  });
}
