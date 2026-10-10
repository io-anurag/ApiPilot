import { describe, expect, it } from "vitest";
import { buildSnapshot, latencyOf, type LiveRunSource } from "../../../../src/performance/live/buildSnapshot";
import { LatencyHistogram } from "../../../../src/performance/report/histogram";

const points = (n: number) => Array.from({ length: n }, (_, second) => ({ second, requests: 1, failures: 0, virtualUsers: 1 }));
const source = (overrides: Partial<LiveRunSource> = {}): LiveRunSource => ({
  runId: "r1",
  kind: "chain",
  state: "live",
  elapsedMs: 5_000,
  plannedDurationMs: 60_000,
  plannedRequests: null,
  totals: { requests: 5, failures: 1 },
  currentVirtualUsers: 1,
  latency: null,
  chains: [],
  series: { bucketSeconds: 1, points: points(5) },
  recent: [],
  inFlight: null,
  ...overrides,
});

describe("buildSnapshot", () => {
  it("returns the whole run for since 0", () => {
    const snapshot = buildSnapshot(source(), { since: 0 });
    expect(snapshot.series.points).toHaveLength(5);
    expect(snapshot.series.bucketSeconds).toBe(1);
    expect(snapshot.thinned).toBe(false);
  });

  it("asks again for the last 10 seconds, because late points can still arrive for them", () => {
    const run = source({ series: { bucketSeconds: 1, points: points(30) } });
    const first = buildSnapshot(run, { since: 0 });
    expect(first.nextSince).toBe(19);
    const next = buildSnapshot(run, { since: first.nextSince });
    expect(next.series.points.map((p) => p.second)[0]).toBe(19);
    expect(next.series.points).toHaveLength(11);
    expect(buildSnapshot(source(), { since: 0 }).nextSince).toBe(0);
  });

  it("sends the whole series once a run has ended, whatever the cursor", () => {
    const ended = source({ state: "completed", series: { bucketSeconds: 1, points: points(30) } });
    expect(buildSnapshot(ended, { since: 25 }).series.points).toHaveLength(30);
  });

  it("returns the whole series when the client holds another bucket width", () => {
    const wide = source({ series: { bucketSeconds: 2, points: [0, 2, 4].map((second) => ({ second, requests: 2, failures: 0, virtualUsers: 1 })) } });
    const snapshot = buildSnapshot(wide, { since: 4, knownBucketSeconds: 1 });
    expect(snapshot.series.points).toHaveLength(3);
    expect(snapshot.thinned).toBe(true);
    expect(buildSnapshot(wide, { since: 4, knownBucketSeconds: 2 }).series.points.map((p) => p.second)).toEqual([4]);
  });

  it("keeps unavailable apart from zero", () => {
    const snapshot = buildSnapshot(source({ totals: { requests: 0, failures: 0 }, latency: null, currentVirtualUsers: null, series: { bucketSeconds: 1, points: [] } }), { since: 0 });
    expect(snapshot.totals).toEqual({ requests: 0, failures: 0 });
    expect(snapshot.latency).toBeNull();
    expect(snapshot.currentVirtualUsers).toBeNull();
    expect(snapshot.nextSince).toBe(0);
  });

  it("keeps requests at or above failures and points ordered and unique", () => {
    const snapshot = buildSnapshot(source(), { since: 0 });
    expect(snapshot.totals.requests).toBeGreaterThanOrEqual(snapshot.totals.failures);
    const seconds = snapshot.series.points.map((p) => p.second);
    expect(seconds).toEqual([...new Set(seconds)].sort((a, b) => a - b));
  });

  it("limits the recent list to 15 entries", () => {
    const recent = Array.from({ length: 20 }, (_, n) => ({ second: n, chain: "c", method: "GET", path: "/", status: 200, failed: false, durationMs: 1 }));
    expect(buildSnapshot(source({ recent }), { since: 0 }).recent).toHaveLength(15);
  });
});

describe("latencyOf", () => {
  it("is null with no samples and carries the mean and p95 otherwise", () => {
    const histogram = new LatencyHistogram();
    expect(latencyOf(histogram)).toBeNull();
    for (const value of [10, 20, 30, 40]) histogram.add(value);
    expect(latencyOf(histogram)?.averageMs).toBe(25);
    expect(latencyOf(histogram)?.p95Ms).toBeGreaterThan(30);
  });
});
