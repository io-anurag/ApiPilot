import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RawRequestCapture, UploadedRequestResult } from "@apipilot/shared-domain";
import {
  appendResult,
  createRun,
  getInProgressRun,
  getRun,
  listRuns,
  requestCancel,
  settleRun,
} from "../../../src/externalCollections/uploadedCollectionExecutionStore";
import { RunNotFoundError } from "../../../src/externalCollections/errors";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getUploadedCollectionRunRepository } from "../../../src/persistence/uploadedCollectionRunRepository";

const snapshot = { name: "My collection", tier: "local" as const };

function passedResult(overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return {
    requestName: "Get widget",
    requestMethod: "GET",
    outcome: "passed",
    startedAt: new Date().toISOString(),
    durationMs: 5,
    responseStatusCode: 200,
    testOutcomes: [],
    ...overrides,
  };
}

describe("uploadedCollectionExecutionStore", () => {
  it("creates a run in-progress and exposes it as the in-progress run", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    expect(run.status).toBe("in-progress");
    expect(run.source).toBe("uploaded");
    expect(getInProgressRun()?.id).toBe(run.id);
  });

  it("appendResult grows results and recomputes the summary", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    appendResult(run.id, passedResult());
    const afterSecond = appendResult(
      run.id,
      passedResult({ requestName: "Create widget", outcome: "failed", failureCategory: "assertion-failed" }),
    );
    expect(afterSecond.results).toHaveLength(2);
    expect(afterSecond.summary).toMatchObject({ total: 2, passed: 1, failed: 1, notAttempted: 0 });
  });

  it("settleRun marks a terminal status and clears the in-progress slot", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    const settled = settleRun(run.id, "completed");
    expect(settled.status).toBe("completed");
    expect(getInProgressRun()).toBeUndefined();
  });

  it("requestCancel marks the run without settling it, and cancellation keeps already-attempted results", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    appendResult(run.id, passedResult());
    const cancelled = requestCancel(run.id);
    expect(cancelled.cancelRequested).toBe(true);
    expect(cancelled.status).toBe("in-progress");
    const settled = settleRun(run.id, "cancelled", "user-requested");
    expect(settled.results).toHaveLength(1);
    expect(settled.status).toBe("cancelled");
  });

  it("listRuns returns newest first", () => {
    const first = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    settleRun(first.id, "completed");
    const second = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    expect(listRuns().map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("throws RunNotFoundError for an unknown run id", () => {
    expect(() => getRun("missing")).toThrow(RunNotFoundError);
  });

  it("markInterruptedRunsCancelled settles an in-progress run as cancelled/'backend-restart'", () => {
    const run = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    getUploadedCollectionRunRepository().markInterruptedRunsCancelled();
    const settled = getRun(run.id);
    expect(settled.status).toBe("cancelled");
    expect(settled.cancelReason).toBe("backend-restart");
  });

  it("removes a session's run history when its session is idle-evicted", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    expect(listRuns()).toHaveLength(1);
    forceExpireForTest(sessionId);
    expect(listRuns()).toEqual([]);
  });

  it("round-trips rawCapture only for a 'local'-tier run, and never as plaintext (FR-017a parity)", () => {
    const rawCapture: RawRequestCapture = {
      requestUrl: "http://localhost:4000/widgets",
      requestHeaders: [{ key: "Authorization", value: "Bearer super-secret-token" }],
      responseHeaders: [],
      responseBody: "super-secret-response-body",
    };
    const localRun = createRun({ uploadedCollectionSetId: "uc-1", uploadedCollectionSnapshot: snapshot });
    const updated = appendResult(localRun.id, passedResult({ rawCapture }));
    expect(updated.results[0].rawCapture).toEqual(rawCapture);

    const row = getSharedConnection()
      .db.prepare("SELECT results, raw_captures_encrypted FROM uploaded_collection_runs WHERE id = ?")
      .get(localRun.id) as { results: string; raw_captures_encrypted: Buffer };
    expect(row.results).not.toContain("super-secret");
    expect(row.raw_captures_encrypted.toString("utf-8")).not.toContain("super-secret");

    const stagingRun = createRun({
      uploadedCollectionSetId: "uc-1",
      uploadedCollectionSnapshot: { name: "My collection", tier: "staging" },
    });
    const stagingUpdated = appendResult(stagingRun.id, passedResult({ rawCapture }));
    expect(stagingUpdated.results[0].rawCapture).toBeUndefined();
  });
});
