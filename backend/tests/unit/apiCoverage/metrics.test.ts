import { coveragePercentage } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { makeMetric } from "../../../src/apiCoverage/metrics";

describe("coverage metrics", () => {
  it("retains numerator, denominator and basis, and computes the percentage", () => {
    const metric = makeMetric("m", "specification", "operation", "Operations", 3, 4, "basis text");
    expect(metric).toMatchObject({ numerator: 3, denominator: 4, percentage: 75, available: true, basis: "basis text" });
  });

  it("reports an unavailable metric, never NaN or Infinity, for a zero denominator", () => {
    const metric = makeMetric("m", "runtime", "operation", "Operations", 0, 0, "b");
    expect(metric.percentage).toBeNull();
    expect(metric.available).toBe(false);
    expect(coveragePercentage(0, 0)).toBeNull();
    expect(coveragePercentage(5, 0)).toBeNull();
    expect(Number.isFinite(coveragePercentage(1, 3))).toBe(true);
  });

  it("refuses a numerator above its denominator or negative counts", () => {
    expect(() => makeMetric("m", "runtime", "operation", "x", 5, 4, "b")).toThrow(RangeError);
    expect(() => makeMetric("m", "runtime", "operation", "x", -1, 4, "b")).toThrow(RangeError);
  });

  it("rounds to one decimal place", () => {
    expect(coveragePercentage(1, 3)).toBe(33.3);
    expect(coveragePercentage(2, 3)).toBe(66.7);
  });
});
