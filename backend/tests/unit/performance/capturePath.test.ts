import { describe, expect, it } from "vitest";
import { formatCapturePath, parseCapturePath, valueAtPath, withValueAtPath } from "../../../src/performance/plan/capturePath";

/** AP-035 FR-008 (specs/035-user-defined-journeys research R6; tasks T005). */
describe("parseCapturePath", () => {
  it.each([
    ["id", [{ field: "id" }]],
    ["data.items[0].id", [{ field: "data" }, { field: "items" }, { index: 0 }, { field: "id" }]],
    ["a-b.$c_d", [{ field: "a-b" }, { field: "$c_d" }]],
    ["x[12]", [{ field: "x" }, { index: 12 }]],
  ])("accepts %s as its canonical segments", (text, segments) => {
    expect(parseCapturePath(text)).toEqual({ ok: true, segments, path: text });
  });

  it.each([
    ["*", 0],
    ["a?", 1],
    ["a..b", 2],
    ["a[]", 2],
    ['a["b"]', 2],
    ["items[*]", 6],
    ["a[?(@.x)]", 2],
    ["f()", 1],
    [".a", 0],
    ["a.", 2],
    ["", 0],
    ["a[1234567]", 2],
    ["a b", 1],
    ["[0]", 0],
  ])("refuses %s at position %i with a reason", (text, position) => {
    const result = parseCapturePath(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.position).toBe(position);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("refuses a path over 256 characters and one of more than 16 parts", () => {
    expect(parseCapturePath("a".repeat(257)).ok).toBe(false);
    expect(parseCapturePath(Array.from({ length: 17 }, () => "a").join(".")).ok).toBe(false);
    expect(parseCapturePath(Array.from({ length: 16 }, () => "a").join(".")).ok).toBe(true);
  });

  it("formats segments back to the text it accepts", () => {
    expect(formatCapturePath([{ field: "data" }, { index: 3 }, { field: "id" }])).toBe("data[3].id");
  });
});

describe("valueAtPath and withValueAtPath", () => {
  const body = { data: { items: [{ id: "a" }, { id: "b" }] } };

  it("reads own fields and array positions only", () => {
    expect(valueAtPath(body, [{ field: "data" }, { field: "items" }, { index: 1 }, { field: "id" }])).toBe("b");
    expect(valueAtPath(body, [{ field: "toString" }])).toBeUndefined();
    expect(valueAtPath(body, [{ field: "data" }, { index: 0 }])).toBeUndefined();
  });

  it("replaces an existing field and never creates one", () => {
    expect(withValueAtPath(body, [{ field: "data" }, { field: "items" }, { index: 0 }, { field: "id" }], "{{x}}")).toEqual({
      data: { items: [{ id: "{{x}}" }, { id: "b" }] },
    });
    expect(withValueAtPath(body, [{ field: "missing" }], "{{x}}")).toBe(body);
  });
});
