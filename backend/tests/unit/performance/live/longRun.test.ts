import { describe, expect, it } from "vitest";
import { LIVE_SERIES_MAX_POINTS } from "@apipilot/shared-domain";
import { buildSnapshot } from "../../../../src/performance/live/buildSnapshot";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import type { RunLayout } from "../../../../src/performance/report/runLayout";

/** AP-045 SC-005, T048: a long run keeps a bounded series, unchanged totals and small replies. */

const layout: RunLayout = {
  kind: "run-layout",
  journeys: [{ id: "c1", steps: [{ stepId: "s1", journeyId: "c1", operationKey: "s1", method: "GET", expected: [{ code: "200", source: "user" }], captureNames: [], checks: [] }] }],
  thresholds: [],
};

const point = (metric: string, timeMs: number, status = "200") => ({ metric, timeMs, value: metric === "http_req_duration" ? 5 : 1, tags: { step: "s1", journey: "c1", status, method: "GET" } });

describe("a simulated two-hour run", () => {
  it("holds at most the maximum number of points, merges instead of dropping, and keeps every total", () => {
    const aggregate = createAggregate(layout, 7_200_000, 0, { steps: new Map() });
    let sent = 0;
    let failed = 0;
    for (let second = 0; second < 7_200; second += 1) {
      for (let n = 0; n < 3; n += 1) {
        const status = (second + n) % 10 === 0 ? "500" : "200";
        aggregate.ingest(point("http_reqs", second * 1000 + n, status));
        aggregate.ingest(point("http_req_duration", second * 1000 + n, status));
        sent += 1;
        if (status === "500") failed += 1;
      }
    }
    const parts = aggregate.liveParts(7_200_000);
    expect(parts.series.points.length).toBeLessThanOrEqual(LIVE_SERIES_MAX_POINTS);
    expect(parts.series.bucketSeconds).toBeGreaterThan(1);
    expect(parts.totals).toEqual({ requests: sent, failures: failed });
    expect(parts.series.points.reduce((sum, p) => sum + p.requests, 0)).toBe(sent);
    expect(parts.series.points.reduce((sum, p) => sum + p.failures, 0)).toBe(failed);
    expect(parts.recent.length).toBeLessThanOrEqual(15);
  });

  it("answers a poll with only the last 10 seconds, far smaller than the first reply", () => {
    const aggregate = createAggregate(layout, 1_200_000, 0, { steps: new Map() });
    for (let second = 0; second < 1_200; second += 1) aggregate.ingest(point("http_reqs", second * 1000));
    const parts = aggregate.liveParts(1_199_000);
    const base = { runId: "r", kind: "chain" as const, state: "live" as const, plannedDurationMs: 1_200_000, plannedRequests: null, inFlight: null, ...parts };
    const first = buildSnapshot(base, { since: 0 });
    const next = buildSnapshot(base, { since: first.nextSince, knownBucketSeconds: first.series.bucketSeconds });
    expect(first.series.points).toHaveLength(1_200);
    expect(next.series.points).toHaveLength(11);
    expect(JSON.stringify(next).length).toBeLessThan(JSON.stringify(first).length / 20);
  });
});
