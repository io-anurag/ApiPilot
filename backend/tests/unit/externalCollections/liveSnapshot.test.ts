import { afterEach, describe, expect, it } from "vitest";
import type { UploadedCollectionExecutionRun, UploadedRequestResult } from "@apipilot/shared-domain";
import { buildCollectionLiveSnapshot } from "../../../src/externalCollections/liveSnapshot";
import { beginCollectionLive, clearCollectionLiveState, setCollectionInFlight } from "../../../src/externalCollections/liveRunState";

const START = Date.parse("2026-01-01T10:00:00.000Z");

function result(n: number, overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return { requestName: `R${n}`, requestMethod: "get", outcome: "passed", startedAt: new Date(START + n * 1_000).toISOString(), durationMs: 100, responseStatusCode: 200, testOutcomes: [], itemId: `item-${n}`, ...overrides };
}

function run(results: UploadedRequestResult[], overrides: Partial<UploadedCollectionExecutionRun> = {}): UploadedCollectionExecutionRun {
  return {
    id: "run-1",
    source: "uploaded",
    uploadedCollectionSetId: "set-1",
    uploadedCollectionSnapshot: { name: "C", tier: "local" },
    status: "in-progress",
    startedAt: new Date(START).toISOString(),
    summary: { total: results.length, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results,
    cancelRequested: false,
    ...overrides,
  };
}

afterEach(() => clearCollectionLiveState());

describe("buildCollectionLiveSnapshot", () => {
  it("is live with n of N, the request in flight, and zero shown as zero", () => {
    beginCollectionLive("run-1", 5, new Map());
    setCollectionInFlight("run-1", "R0");
    const snapshot = buildCollectionLiveSnapshot(run([]), START + 2_000, { since: 0 });
    expect(snapshot).toMatchObject({ kind: "collection", state: "live", elapsedMs: 2_000, plannedRequests: 5, totals: { requests: 0, failures: 0 }, inFlight: "R0", currentVirtualUsers: null, latency: null, plannedDurationMs: null });
    expect(snapshot.recent).toEqual([]);
  });

  it("counts only requests that were sent, with failures, newest first, with the authored paths and no other figure", () => {
    beginCollectionLive("run-1", 4, new Map([["item-1", "/widgets/{{id}}"]]));
    const results = [result(0), result(1, { outcome: "failed", failureCategory: "assertion-failed", responseStatusCode: 500 }), result(2, { outcome: "not-attempted", notAttemptedReason: "cancelled", durationMs: 0, responseStatusCode: undefined })];
    const snapshot = buildCollectionLiveSnapshot(run(results, { status: "cancelled", completedAt: new Date(START + 3_000).toISOString() }), START + 99_000, { since: 0 });
    expect(snapshot).toMatchObject({ state: "cancelled", elapsedMs: 3_000, totals: { requests: 2, failures: 1 }, inFlight: null });
    expect(snapshot.recent.map((entry) => [entry.chain, entry.method, entry.path, entry.status, entry.failed])).toEqual([
      ["R1", "GET", "/widgets/{{id}}", 500, true],
      ["R0", "GET", "", 200, false],
    ]);
    expect(snapshot.series.points.reduce((sum, p) => sum + p.requests, 0)).toBe(2);
  });

  it("never reads the raw capture, and shows a finished run from before a restart with empty paths and n of N from its results", () => {
    const withCapture = result(0, { rawCapture: { request: { headers: [{ key: "Authorization", value: "Bearer SECRET" }] } } } as unknown as Partial<UploadedRequestResult>);
    const snapshot = buildCollectionLiveSnapshot(run([withCapture], { status: "completed", completedAt: new Date(START + 1_000).toISOString() }), START + 60_000, { since: 0 });
    expect(JSON.stringify(snapshot)).not.toContain("SECRET");
    expect(snapshot).toMatchObject({ state: "completed", plannedRequests: 1, recent: [{ path: "" }] });
  });

  it("limits the latest requests to 15", () => {
    const results = Array.from({ length: 30 }, (_, n) => result(n));
    const snapshot = buildCollectionLiveSnapshot(run(results), START + 40_000, { since: 0 });
    expect(snapshot.recent).toHaveLength(15);
    expect(snapshot.recent[0]!.chain).toBe("R29");
  });
});
