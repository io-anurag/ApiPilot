import { describe, expect, it } from "vitest";
import { COVERAGE_GAP_KINDS, COVERAGE_PRIORITIES, COVERAGE_SORT_KEYS, COVERAGE_STATES, coveragePercentage } from "../../src/coverage";

describe("coverage contracts (AP-046)", () => {
  it("defines exactly the six coverage states, each once", () => {
    expect([...COVERAGE_STATES].sort()).toEqual(
      ["executed-failed", "generated-not-executed", "inconclusive", "not-covered", "stale", "verified"],
    );
    expect(new Set(COVERAGE_STATES).size).toBe(6);
  });

  it("never yields NaN or Infinity for a percentage", () => {
    expect(coveragePercentage(0, 0)).toBeNull();
    expect(coveragePercentage(3, 0)).toBeNull();
    expect(coveragePercentage(0, 4)).toBe(0);
    expect(coveragePercentage(4, 4)).toBe(100);
    expect(coveragePercentage(1, 3)).toBe(33.3);
  });

  it("fixes the closed vocabularies the routes validate against", () => {
    expect(COVERAGE_PRIORITIES).toEqual(["high", "medium", "low"]);
    expect(COVERAGE_SORT_KEYS).toEqual(["priority", "method", "path", "specification", "runtime"]);
    expect(COVERAGE_GAP_KINDS).toEqual(["missing", "failed", "insufficient", "stale"]);
  });
});
