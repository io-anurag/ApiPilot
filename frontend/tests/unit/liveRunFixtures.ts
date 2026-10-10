import type { LivePoint, LiveRunSnapshot, RecentRequest } from "@apipilot/shared-domain";

/** AP-045: snapshots for the live run dashboard tests. */

export function livePoint(second: number, overrides: Partial<LivePoint> = {}): LivePoint {
  return { second, requests: 10, failures: 0, virtualUsers: 5, ...overrides };
}

export function recentRequest(overrides: Partial<RecentRequest> = {}): RecentRequest {
  return { second: 3, chain: "Orders", method: "GET", path: "/orders/{{id}}", status: 200, failed: false, durationMs: 42, ...overrides };
}

export function liveSnapshot(overrides: Partial<LiveRunSnapshot> = {}): LiveRunSnapshot {
  return {
    runId: "run-1",
    kind: "chain",
    state: "live",
    elapsedMs: 4_000,
    plannedDurationMs: 60_000,
    plannedRequests: null,
    totals: { requests: 120, failures: 2 },
    currentVirtualUsers: 3,
    latency: { averageMs: 120, p95Ms: 480 },
    chains: [{ id: "c1", label: "Orders", method: "GET", path: "/orders", requests: 120, failures: 2 }],
    series: { fromSecond: 0, bucketSeconds: 1, points: [livePoint(0), livePoint(1), livePoint(2, { failures: 1 })] },
    recent: [recentRequest()],
    inFlight: null,
    nextSince: 3,
    thinned: false,
    ...overrides,
  };
}

export function collectionSnapshot(overrides: Partial<LiveRunSnapshot> = {}): LiveRunSnapshot {
  return liveSnapshot({
    kind: "collection",
    plannedDurationMs: null,
    plannedRequests: 10,
    totals: { requests: 4, failures: 1 },
    currentVirtualUsers: null,
    latency: null,
    chains: [],
    series: { fromSecond: 0, bucketSeconds: 1, points: [livePoint(0, { requests: 2, virtualUsers: null }), livePoint(1, { requests: 2, virtualUsers: null })] },
    inFlight: "Get widget",
    ...overrides,
  });
}
