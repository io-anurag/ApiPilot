import { describe, expect, it } from "vitest";
import type { SchemaConstraint } from "@apipilot/shared-domain";
import {
  arrayBoundaryValues,
  conformantValue,
  enumViolatingValue,
  formatViolatingValue,
  incompatibleTypeValue,
  numericBoundaryValues,
  stringBoundaryValues,
} from "../../../src/testDesign/valueGenerators";

const emptyConstraint = (overrides: Partial<SchemaConstraint> = {}): SchemaConstraint => ({
  required: [],
  properties: {},
  ...overrides,
});

describe("conformantValue", () => {
  it("prefers the first enum value when an enum is declared", () => {
    expect(conformantValue(emptyConstraint({ type: "string", enum: ["b", "a"] }))).toBe("b");
  });

  it("respects declared minimum/maximum for numeric types", () => {
    expect(conformantValue(emptyConstraint({ type: "integer", minimum: 5, maximum: 10 }))).toBe(5);
    expect(conformantValue(emptyConstraint({ type: "integer", maximum: 10 }))).toBe(10);
  });

  it("respects declared minLength/maxLength for strings", () => {
    const value = conformantValue(emptyConstraint({ type: "string", minLength: 3, maxLength: 8 })) as string;
    expect(value.length).toBeGreaterThanOrEqual(3);
    expect(value.length).toBeLessThanOrEqual(8);
  });

  it("recurses into nested object properties", () => {
    const schema = emptyConstraint({
      type: "object",
      properties: { name: emptyConstraint({ type: "string" }) },
    });
    expect(conformantValue(schema)).toEqual({ name: expect.any(String) });
  });
});

describe("incompatibleTypeValue", () => {
  it("returns a value of a different JS type than declared", () => {
    expect(typeof incompatibleTypeValue(emptyConstraint({ type: "string" }))).toBe("number");
    expect(typeof incompatibleTypeValue(emptyConstraint({ type: "integer" }))).toBe("string");
    expect(typeof incompatibleTypeValue(emptyConstraint({ type: "boolean" }))).toBe("string");
    expect(Array.isArray(incompatibleTypeValue(emptyConstraint({ type: "array" })))).toBe(false);
    expect(typeof incompatibleTypeValue(emptyConstraint({ type: "object" }))).not.toBe("object");
  });
});

describe("formatViolatingValue", () => {
  it("returns undefined when no format/pattern is declared", () => {
    expect(formatViolatingValue(emptyConstraint({ type: "string" }))).toBeUndefined();
  });

  it("returns a violating value when a format is declared", () => {
    expect(formatViolatingValue(emptyConstraint({ format: "email" }))).toBe("not-a-valid-email");
  });

  it("returns a violating value when only a pattern is declared", () => {
    expect(formatViolatingValue(emptyConstraint({ pattern: "^[A-Z]+$" }))).toBeDefined();
  });
});

describe("enumViolatingValue", () => {
  it("returns undefined when no enum is declared", () => {
    expect(enumViolatingValue(emptyConstraint())).toBeUndefined();
  });

  it("returns a value outside the declared enum", () => {
    const value = enumViolatingValue(emptyConstraint({ enum: ["a", "b"] }));
    expect(["a", "b"]).not.toContain(value);
  });
});

describe("numericBoundaryValues", () => {
  it("produces below/at/above values only for declared bounds", () => {
    expect(numericBoundaryValues(emptyConstraint({ type: "integer", minimum: 1, maximum: 100 }))).toEqual({
      belowMinimum: 0,
      atMinimum: 1,
      atMaximum: 100,
      aboveMaximum: 101,
    });
    expect(numericBoundaryValues(emptyConstraint({ type: "integer" }))).toEqual({});
  });
});

describe("stringBoundaryValues", () => {
  it("omits belowMinLength when minLength is 0", () => {
    const values = stringBoundaryValues(emptyConstraint({ minLength: 0, maxLength: 5 }));
    expect(values.belowMinLength).toBeUndefined();
    expect(values.atMinLength).toBe("");
    expect(values.atMaxLength).toHaveLength(5);
    expect(values.aboveMaxLength).toHaveLength(6);
  });
});

describe("arrayBoundaryValues", () => {
  it("produces item arrays of the correct length", () => {
    const values = arrayBoundaryValues(emptyConstraint({ minItems: 1, maxItems: 3 }));
    expect(values.belowMinItems).toEqual([]);
    expect(values.atMinItems).toHaveLength(1);
    expect(values.atMaxItems).toHaveLength(3);
    expect(values.aboveMaxItems).toHaveLength(4);
  });
});
