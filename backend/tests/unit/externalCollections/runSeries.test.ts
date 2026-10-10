import { describe, expect, it } from "vitest";
import type { UploadedRequestResult } from "@apipilot/shared-domain";
import { resultSecond, runSeries } from "../../../src/externalCollections/runSeries";

const START = Date.parse("2026-01-01T10:00:00.000Z");

function result(offsetMs: number, durationMs: number, overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return { requestName: "r", requestMethod: "GET", outcome: "passed", startedAt: new Date(START + offsetMs).toISOString(), durationMs, responseStatusCode: 200, testOutcomes: [], ...overrides };
}

describe("runSeries", () => {
  it("counts a request in the second it finished and a failure alongside it, with no virtual users", () => {
    const view = runSeries([result(0, 400), result(900, 300, { outcome: "failed", failureCategory: "assertion-failed" }), result(2_100, 50)], START, 3_000);
    expect(view.bucketSeconds).toBe(1);
    expect(view.points.map((p) => [p.second, p.requests, p.failures, p.virtualUsers])).toEqual([
      [0, 1, 0, null],
      [1, 1, 1, null],
      [2, 1, 0, null],
      [3, 0, 0, null],
    ]);
  });

  it("does not count a request that was not attempted, and counts a connectivity failure as a failed request", () => {
    const view = runSeries(
      [result(0, 100), result(500, 0, { outcome: "failed", failureCategory: "connectivity-failure", responseStatusCode: undefined }), result(0, 0, { outcome: "not-attempted", notAttemptedReason: "cancelled" })],
      START,
      1_000,
    );
    expect(view.points.reduce((sum, p) => sum + p.requests, 0)).toBe(2);
    expect(view.points.reduce((sum, p) => sum + p.failures, 0)).toBe(1);
  });

  it("gives the same series whatever the order of the results", () => {
    const results = [result(0, 100), result(1_200, 100, { outcome: "failed" }), result(5_000, 10), result(5_100, 10)];
    expect(runSeries([...results].reverse(), START, 6_000)).toEqual(runSeries(results, START, 6_000));
  });

  it("clamps a result that starts before the run to second zero", () => {
    expect(resultSecond(result(-5_000, 100), START)).toBe(0);
    expect(resultSecond(result(0, 0, { startedAt: "not a date" }), START)).toBe(0);
  });

  it("merges seconds into wider buckets for a very long run without changing the totals", () => {
    const results = Array.from({ length: 4_000 }, (_, n) => result(n * 1_000, 10, n % 4 === 0 ? { outcome: "failed" } : {}));
    const view = runSeries(results, START, 4_000_000);
    expect(view.bucketSeconds).toBeGreaterThan(1);
    expect(view.points.length).toBeLessThanOrEqual(1_800);
    expect(view.points.reduce((sum, p) => sum + p.requests, 0)).toBe(4_000);
    expect(view.points.reduce((sum, p) => sum + p.failures, 0)).toBe(1_000);
  });
});
