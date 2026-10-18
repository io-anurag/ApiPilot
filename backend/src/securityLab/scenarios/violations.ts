import type { ConstraintKind, SchemaConstraint } from "@apipilot/shared-domain";
import {
  arrayBoundaryValues,
  enumViolatingValue,
  formatViolatingValue,
  incompatibleTypeValue,
  numericBoundaryValues,
  stringBoundaryValues,
} from "../../testDesign/valueGenerators";

/**
 * The value that deliberately violates one declared constraint (specs/057 FR-021, FR-027). It reuses the test
 * designer's generators, so a "below minimum" value is the same value everywhere in the product. Returns
 * `undefined` when the schema does not declare that constraint, which is how the rule knows a scenario does not
 * apply. `omit` means the violation is the *absence* of a required field.
 */
export type Violation = { kind: "value"; value: unknown } | { kind: "omit" };

export function violationFor(schema: SchemaConstraint, constraint: ConstraintKind): Violation | undefined {
  switch (constraint) {
    case "type": {
      if (schema.type === undefined) return undefined;
      const value = incompatibleTypeValue(schema);
      return value === null ? undefined : { kind: "value", value };
    }
    case "format": {
      const value = formatViolatingValue(schema);
      return value === undefined ? undefined : { kind: "value", value };
    }
    case "enum": {
      const value = enumViolatingValue(schema);
      return value === undefined ? undefined : { kind: "value", value };
    }
    case "minimum": {
      const { belowMinimum } = numericBoundaryValues(schema);
      return belowMinimum === undefined ? undefined : { kind: "value", value: belowMinimum };
    }
    case "maximum": {
      const { aboveMaximum } = numericBoundaryValues(schema);
      return aboveMaximum === undefined ? undefined : { kind: "value", value: aboveMaximum };
    }
    case "minLength": {
      const { belowMinLength } = stringBoundaryValues(schema);
      return belowMinLength === undefined ? undefined : { kind: "value", value: belowMinLength };
    }
    case "maxLength": {
      const { aboveMaxLength } = stringBoundaryValues(schema);
      return aboveMaxLength === undefined ? undefined : { kind: "value", value: aboveMaxLength };
    }
    case "minItems": {
      const { belowMinItems } = arrayBoundaryValues(schema);
      return belowMinItems === undefined ? undefined : { kind: "value", value: belowMinItems };
    }
    case "maxItems": {
      const { aboveMaxItems } = arrayBoundaryValues(schema);
      return aboveMaxItems === undefined ? undefined : { kind: "value", value: aboveMaxItems };
    }
    case "required":
      return { kind: "omit" };
  }
}

/** The order constraints are tried in, so generation order is fixed. */
export const CONSTRAINT_ORDER: readonly ConstraintKind[] = [
  "type",
  "format",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "required",
];
