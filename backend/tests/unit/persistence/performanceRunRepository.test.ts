import type { PerformanceResult, RunProgress } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import {
  SEEDED_CLIENT_ID,
  SEEDED_CLIENT_SECRET,
  runFixture,
} from "../../fixtures/performance/builders";

/** AP-029 (specs/031-k6-performance-testing research D20, tasks T012). */

const SESSION = "session-a";
const OTHER_SESSION = "session-b";

const progress: RunProgress = {
  elapsedMs: 5_000,
  currentVirtualUsers: 3,
  requestsSoFar: 42,
  failuresSoFar: 1,
  journeysCutShortSoFar: 0,
  tokenRefreshesSoFar: 0,
  steps: [{ stepId: "step-get-status", requests: 42, failures: 1, notSent: { missingData: 0, dependencyNotAttempted: 0 } }],
};

function resultFixture(): PerformanceResult {
  return {
    totals: {
      requests: 42,
      errors: 1,
      errorRatePercent: 2.38,
      iterations: 42,
      journeysCutShort: 0,
      throughputPerSecond: 8.4,
      latencyMs: { p50: 10, p90: 20, p95: 25, p99: 30 },
    },
    journeys: [],
    steps: [],
    timeline: { bucketMs: 5_000, points: [] },
    writeRequests: [],
    tokenRefreshes: { count: 0, failed: 0, lifetimeStated: true, bucketOffsetsMs: [] },
    thresholdOutcomes: [],
    findings: [],
    findingsRulesetVersion: 1,
    latencyPrecision: "within-1-percent",
  };
}

describe("performanceRunRepository", () => {
  it("round-trips every field of a created run, including the JSON columns", () => {
    const repo = getPerformanceRunRepository();
    const run = runFixture();
    repo.create(SESSION, run);
    expect(repo.get(SESSION, run.id)).toEqual(run);
    expect(repo.get(OTHER_SESSION, run.id)).toBeUndefined();
  });

  it("lists newest first, without the plan snapshot, progress or result", () => {
    const repo = getPerformanceRunRepository();
    repo.create(SESSION, runFixture({ id: "run-1", status: "completed", startedAt: "2026-09-27T12:00:00.000Z" }));
    repo.create(SESSION, runFixture({ id: "run-2", status: "completed", startedAt: "2026-09-27T12:00:00.000Z" }));
    repo.create(SESSION, runFixture({ id: "run-0", status: "completed", startedAt: "2026-09-27T11:00:00.000Z" }));
    const summaries = repo.listBySession(SESSION);
    expect(summaries.map((s) => s.id)).toEqual(["run-2", "run-1", "run-0"]);
    for (const summary of summaries) {
      expect(summary).not.toHaveProperty("planSnapshot");
      expect(summary).not.toHaveProperty("result");
      expect(summary).not.toHaveProperty("progress");
    }
  });

  it("finds the session's in-progress run only", () => {
    const repo = getPerformanceRunRepository();
    repo.create(SESSION, runFixture({ id: "done", status: "completed" }));
    expect(repo.getInProgress(SESSION)).toBeUndefined();
    repo.create(SESSION, runFixture({ id: "live" }));
    expect(repo.getInProgress(SESSION)?.id).toBe("live");
    expect(repo.getInProgress(OTHER_SESSION)).toBeUndefined();
  });

  it("checkpoints progress and a partial result", () => {
    const repo = getPerformanceRunRepository();
    const run = runFixture();
    repo.create(SESSION, run);
    repo.checkpoint(SESSION, run.id, { progress, result: resultFixture() });
    const stored = repo.get(SESSION, run.id);
    expect(stored?.progress).toEqual(progress);
    expect(stored?.result).toEqual(resultFixture());
  });

  it("settles each terminal status with its reason or failure category", () => {
    const repo = getPerformanceRunRepository();
    for (const id of ["c", "u", "f"]) repo.create(SESSION, runFixture({ id }));
    const completed = repo.settle(SESSION, "c", { status: "completed" }, "2026-09-27T12:01:00.000Z", resultFixture());
    expect(completed).toMatchObject({ status: "completed", endedAt: "2026-09-27T12:01:00.000Z" });
    expect(completed.result).toEqual(resultFixture());
    expect(completed.cancelReason).toBeUndefined();

    const cancelled = repo.settle(SESSION, "u", { status: "cancelled", cancelReason: "user-requested" }, "2026-09-27T12:02:00.000Z");
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "user-requested" });

    const failed = repo.settle(SESSION, "f", { status: "failed", failure: { category: "metrics-unreadable" } }, "2026-09-27T12:03:00.000Z");
    expect(failed).toMatchObject({ status: "failed", failure: { category: "metrics-unreadable" } });
    expect(failed.cancelReason).toBeUndefined();
  });

  it("records a cancel request idempotently", () => {
    const repo = getPerformanceRunRepository();
    const run = runFixture();
    repo.create(SESSION, run);
    expect(repo.isCancelRequested(SESSION, run.id)).toBe(false);
    repo.requestCancel(SESSION, run.id);
    expect(repo.requestCancel(SESSION, run.id).cancelRequested).toBe(true);
    expect(repo.isCancelRequested(SESSION, run.id)).toBe(true);
  });

  it("deletes only the given session's runs", () => {
    const repo = getPerformanceRunRepository();
    repo.create(SESSION, runFixture({ id: "mine" }));
    repo.create(OTHER_SESSION, runFixture({ id: "theirs" }));
    repo.deleteBySession(SESSION);
    expect(repo.get(SESSION, "mine")).toBeUndefined();
    expect(repo.get(OTHER_SESSION, "theirs")).toBeDefined();
  });

  it("marks every in-progress run cancelled for backend-restart and leaves settled runs alone (FR-032)", () => {
    const repo = getPerformanceRunRepository();
    repo.create(SESSION, runFixture({ id: "live-a" }));
    repo.create(OTHER_SESSION, runFixture({ id: "live-b" }));
    repo.create(SESSION, runFixture({ id: "done", status: "completed", endedAt: "2026-09-27T12:05:00.000Z" }));
    expect(repo.markInterruptedRunsCancelled()).toBe(2);
    expect(repo.get(SESSION, "live-a")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
    expect(repo.get(OTHER_SESSION, "live-b")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
    expect(repo.get(SESSION, "done")).toMatchObject({ status: "completed", endedAt: "2026-09-27T12:05:00.000Z" });
  });

  it("reads a snapshot stored before AP-033 with empty body-edit fields (AP-033 FR-014)", () => {
    const repo = getPerformanceRunRepository();
    const run = runFixture({ id: "run-before-ap033" });
    repo.create(SESSION, run);
    // Rewrite the row as a run recorded before AP-033 would have stored it.
    const olderSnapshot: Record<string, unknown> = { ...run.planSnapshot };
    delete olderSnapshot.bodyEdits;
    delete olderSnapshot.bodyEditNotices;
    delete olderSnapshot.discardedBodyEdits;
    const db = getSharedConnection().db;
    db.prepare("UPDATE performance_runs SET plan_snapshot = ? WHERE id = ?").run(JSON.stringify(olderSnapshot), run.id);
    const read = repo.get(SESSION, run.id)!;
    expect(read.planSnapshot.bodyEdits).toEqual([]);
    expect(read.planSnapshot.bodyEditNotices).toEqual([]);
    expect(read.planSnapshot.discardedBodyEdits).toEqual([]);
  });

  it("never stores an environment's variable values in any column (FR-021)", () => {
    const repo = getPerformanceRunRepository();
    const run = runFixture();
    repo.create(SESSION, run);
    repo.checkpoint(SESSION, run.id, { progress, result: resultFixture() });
    const rows = getSharedConnection().db.prepare("SELECT * FROM performance_runs").all();
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(SEEDED_CLIENT_SECRET);
    expect(stored).not.toContain(SEEDED_CLIENT_ID);
  });

  it("records a collection run's source, lists by source, and reads an unknown source as guided (AP-036 R1)", () => {
    const repo = getPerformanceRunRepository();
    const session = "session-collection-source";
    repo.create(session, runFixture({ id: "run-collection", status: "completed", planSource: "collection" }));
    repo.create(session, runFixture({ id: "run-quick", status: "completed", planSource: "quick" }));
    repo.create(session, runFixture({ id: "run-guided", status: "completed", planSource: "guided" }));
    expect(repo.get(session, "run-collection")?.planSource).toBe("collection");
    expect(repo.listBySessionAndSource(session, "collection").map((summary) => summary.id)).toEqual(["run-collection"]);
    expect(repo.listBySessionAndSource(session, "quick").map((summary) => summary.id)).toEqual(["run-quick"]);
    getSharedConnection().db.prepare("UPDATE performance_runs SET plan_source = 'from-the-future' WHERE id = 'run-quick'").run();
    expect(repo.listBySession(session).find((summary) => summary.id === "run-quick")?.planSource).toBe("guided");
  });
});
