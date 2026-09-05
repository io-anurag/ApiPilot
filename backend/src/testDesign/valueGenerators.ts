import type { SchemaConstraint } from "@apipilot/shared-domain";

/**
 * Deterministic synthetic value generation per declared type/format/constraint
 * (research.md decision 3). No randomness, no AI — every value is a fixed,
 * documented convention derived only from the declared `SchemaConstraint`.
 */

const FORMAT_VIOLATIONS: Record<string, string> = {
  email: "not-a-valid-email",
  uuid: "not-a-valid-uuid",
  "date-time": "not-a-valid-date-time",
  date: "not-a-valid-date",
  uri: "not-a-valid-uri",
  hostname: "not-a-valid-hostname",
  ipv4: "not-a-valid-ipv4",
  ipv6: "not-a-valid-ipv6",
  byte: "not-a-valid-byte",
};

const FORMAT_CONFORMANT: Record<string, string> = {
  email: "user@example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
  "date-time": "2024-01-01T00:00:00Z",
  date: "2024-01-01",
  uri: "https://example.com",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  byte: "ZXhhbXBsZQ==",
};

/** A single fixed sentinel outside virtually any declared enum's value space. */
const ENUM_VIOLATION_SENTINELS = ["__INVALID_ENUM_VALUE__", -9999999, "__INVALID_ENUM_VALUE__@@2"];

function repeatChar(char: string, length: number): string {
  return length > 0 ? char.repeat(length) : "";
}

function numericStep(schema: SchemaConstraint): number {
  return schema.type === "integer" ? 1 : 0.01;
}

/** A specification-conformant string value respecting length/format/enum constraints. */
function conformantString(schema: SchemaConstraint): string {
  if (schema.format && FORMAT_CONFORMANT[schema.format]) return FORMAT_CONFORMANT[schema.format];
  const minLength = schema.minLength ?? 0;
  const maxLength = schema.maxLength;
  const length = maxLength !== undefined ? Math.min(Math.max(minLength, 1), maxLength) : Math.max(minLength, 1);
  return repeatChar("a", length);
}

function conformantNumber(schema: SchemaConstraint): number {
  if (schema.minimum !== undefined) return schema.minimum;
  if (schema.maximum !== undefined) return schema.maximum;
  return schema.type === "integer" ? 1 : 1.0;
}

function conformantObject(schema: SchemaConstraint): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [name, propertySchema] of Object.entries(schema.properties)) {
    obj[name] = conformantValue(propertySchema);
  }
  return obj;
}

function conformantArray(schema: SchemaConstraint): unknown[] {
  const length = Math.max(schema.minItems ?? 1, 1);
  const item = schema.items ? conformantValue(schema.items) : "item";
  return Array.from({ length }, () => item);
}

/** A value that satisfies every constraint declared on `schema` (used for the positive scenario). */
export function conformantValue(schema: SchemaConstraint): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "integer":
    case "number":
      return conformantNumber(schema);
    case "boolean":
      return true;
    case "array":
      return conformantArray(schema);
    case "object":
      return conformantObject(schema);
    case "string":
      return conformantString(schema);
    default:
      return conformantString(schema);
  }
}

/** A value of an incompatible JS type relative to `schema.type` (FR-003). */
export function incompatibleTypeValue(schema: SchemaConstraint): unknown {
  switch (schema.type) {
    case "string":
      return 12345;
    case "integer":
    case "number":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    case "array":
      return "not-an-array";
    case "object":
      return "not-an-object";
    default:
      return null;
  }
}

/** A value violating a declared `format`/`pattern`, or `undefined` if neither is declared (FR-008). */
export function formatViolatingValue(schema: SchemaConstraint): string | undefined {
  if (schema.format && FORMAT_VIOLATIONS[schema.format]) return FORMAT_VIOLATIONS[schema.format];
  if (schema.format) return "@@format-violation@@";
  if (schema.pattern) return "@@pattern-violation@@";
  return undefined;
}

/** A value outside `schema.enum`, or `undefined` if no enum is declared (FR-004). */
export function enumViolatingValue(schema: SchemaConstraint): unknown {
  if (!schema.enum || schema.enum.length === 0) return undefined;
  const sentinel = ENUM_VIOLATION_SENTINELS.find((candidate) => !schema.enum!.includes(candidate));
  return sentinel ?? { __invalidEnumMarker: true };
}

/** The boundary-adjacent numeric values `numericBoundaryValues` can produce; each field is present only when the corresponding constraint (minimum/maximum) is declared on the schema. */
export interface NumericBoundaryValues {
  belowMinimum?: number;
  atMinimum?: number;
  atMaximum?: number;
  aboveMaximum?: number;
}

/** Boundary-adjacent numeric values for whichever of minimum/maximum is declared (FR-005). */
export function numericBoundaryValues(schema: SchemaConstraint): NumericBoundaryValues {
  const step = numericStep(schema);
  const values: NumericBoundaryValues = {};
  if (schema.minimum !== undefined) {
    values.atMinimum = schema.minimum;
    values.belowMinimum = schema.minimum - step;
  }
  if (schema.maximum !== undefined) {
    values.atMaximum = schema.maximum;
    values.aboveMaximum = schema.maximum + step;
  }
  return values;
}

/** The boundary-adjacent string-length values `stringBoundaryValues` can produce; each field is present only when the corresponding constraint (minLength/maxLength) is declared on the schema. */
export interface StringBoundaryValues {
  belowMinLength?: string;
  atMinLength?: string;
  atMaxLength?: string;
  aboveMaxLength?: string;
}

/** Boundary-adjacent string-length values for whichever of minLength/maxLength is declared (FR-006). */
export function stringBoundaryValues(schema: SchemaConstraint): StringBoundaryValues {
  const values: StringBoundaryValues = {};
  if (schema.minLength !== undefined) {
    values.atMinLength = repeatChar("a", schema.minLength);
    if (schema.minLength > 0) values.belowMinLength = repeatChar("a", schema.minLength - 1);
  }
  if (schema.maxLength !== undefined) {
    values.atMaxLength = repeatChar("a", schema.maxLength);
    values.aboveMaxLength = repeatChar("a", schema.maxLength + 1);
  }
  return values;
}

/** The boundary-adjacent array-length values `arrayBoundaryValues` can produce; each field is present only when the corresponding constraint (minItems/maxItems) is declared on the schema. */
export interface ArrayBoundaryValues {
  belowMinItems?: unknown[];
  atMinItems?: unknown[];
  atMaxItems?: unknown[];
  aboveMaxItems?: unknown[];
}

/** Boundary-adjacent array-length values for whichever of minItems/maxItems is declared (FR-007). */
export function arrayBoundaryValues(schema: SchemaConstraint): ArrayBoundaryValues {
  const item = schema.items ? conformantValue(schema.items) : "item";
  const values: ArrayBoundaryValues = {};
  if (schema.minItems !== undefined) {
    values.atMinItems = Array.from({ length: schema.minItems }, () => item);
    if (schema.minItems > 0) values.belowMinItems = Array.from({ length: schema.minItems - 1 }, () => item);
  }
  if (schema.maxItems !== undefined) {
    values.atMaxItems = Array.from({ length: schema.maxItems }, () => item);
    values.aboveMaxItems = Array.from({ length: schema.maxItems + 1 }, () => item);
  }
  return values;
}
