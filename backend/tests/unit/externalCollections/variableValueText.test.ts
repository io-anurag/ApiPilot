import { describe, expect, it } from "vitest";
import { toStoredVariableValues, toVariableValueText } from "../../../src/externalCollections/variableValueText";

describe("toVariableValueText", () => {
  it("keeps strings, and turns other values a script can set into text", () => {
    expect(toVariableValueText("abc")).toBe("abc");
    expect(toVariableValueText(42)).toBe("42");
    expect(toVariableValueText(false)).toBe("false");
    expect(toVariableValueText(null)).toBe("");
    expect(toVariableValueText(undefined)).toBe("");
    expect(toVariableValueText({ id: 1 })).toBe('{"id":1}');
    expect(toVariableValueText([1, 2])).toBe("[1,2]");
  });

  it("converts every value of a record", () => {
    expect(toStoredVariableValues({ a: "x", b: 2 })).toEqual({ a: "x", b: "2" });
  });
});
