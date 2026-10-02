import { describe, expect, it } from "vitest";
import { isValidCaptureName, normalizeHeaderName, normalizeJourneyName } from "../../../src/performance/plan/userJourneyNames";

/** AP-035 FR-026, research R8, R11 (tasks T006). */
describe("capture names", () => {
  it.each(["customer_id", "_x", "A1", "a".repeat(64)])("accepts %s", (name) => expect(isValidCaptureName(name)).toBe(true));
  it.each(["1st", "a-b", "é", "", "a b", "a".repeat(65), 7])("refuses %s", (name) => expect(isValidCaptureName(name)).toBe(false));
});

describe("journey names", () => {
  it("trims and accepts 1 to 100 characters", () => {
    expect(normalizeJourneyName("  Customer lifecycle  ")).toBe("Customer lifecycle");
    expect(normalizeJourneyName("x".repeat(100))).toBe("x".repeat(100));
  });
  it.each(["", "   ", "x".repeat(101), "a\nb", "a\u0007b", null])("refuses %j", (name) => expect(normalizeJourneyName(name)).toBeNull());
});

describe("header names", () => {
  it("accepts an HTTP token and stores it lowercased", () => {
    expect(normalizeHeaderName("Location")).toBe("location");
    expect(normalizeHeaderName("X-Request-Id")).toBe("x-request-id");
  });
  it.each(["", "a b", "a:b", "x".repeat(129), "é"])("refuses %j", (name) => expect(normalizeHeaderName(name)).toBeNull());
});
