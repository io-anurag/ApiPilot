import { describe, expect, it } from "vitest";
import {
  breakdownFor,
  breakdownLabel,
  formatFraction,
  formatPercentage,
  formatTimestamp,
  presentStates,
} from "../../../src/components/apiCoverage/coverageViewModel";
import { requirement, stateCounts } from "./coverageFixtures";

describe("coverageViewModel", () => {
  it("words an unavailable percentage instead of showing NaN", () => {
    expect(formatPercentage({ percentage: null })).toBe("not available");
    expect(formatPercentage({ percentage: 33.3 })).toBe("33.3%");
    expect(formatFraction(3, 4)).toBe("3 / 4");
  });

  it("formats timestamps in UTC and passes through anything that is not a date", () => {
    expect(formatTimestamp("2026-10-10T11:00:00.000Z")).toBe("2026-10-10 11:00 UTC");
    expect(formatTimestamp(undefined)).toBe("None");
    expect(formatTimestamp("not a date")).toBe("not a date");
  });

  it("splits requirements into six segments, one per state, that add up to the total", () => {
    const reqs = [
      requirement("a", "operation", "verified"),
      requirement("b", "operation", "executed-failed"),
      requirement("c", "operation", "generated-not-executed"),
      requirement("d", "operation", "inconclusive"),
      requirement("e", "operation", "stale"),
      requirement("f", "operation", "not-covered"),
      requirement("g", "parameter", "verified"),
    ];
    const breakdown = breakdownFor("Operations", reqs, ["operation"]);
    expect(breakdown.total).toBe(6);
    expect(Object.fromEntries(breakdown.segments.map((s) => [s.key, s.count]))).toEqual({
      verified: 1,
      failed: 1,
      inconclusive: 1,
      stale: 1,
      generated: 1,
      uncovered: 1,
    });
    expect(breakdown.segments.reduce((sum, s) => sum + s.count, 0)).toBe(breakdown.total);
    expect(breakdownLabel(breakdown)).toContain("of 6");
  });

  it("counts several kinds together for the schema breakdown", () => {
    const reqs = [requirement("a", "request-schema", "verified"), requirement("b", "response-schema", "not-covered")];
    expect(breakdownFor("Schema elements", reqs, ["request-schema", "response-schema"]).total).toBe(2);
  });

  it("lists a row's states worst first with verified last, and omits empty ones", () => {
    const states = presentStates(stateCounts({ verified: 2, "executed-failed": 1, "generated-not-executed": 3 }));
    expect(states).toEqual([
      ["executed-failed", 1],
      ["generated-not-executed", 3],
      ["verified", 2],
    ]);
  });
});
