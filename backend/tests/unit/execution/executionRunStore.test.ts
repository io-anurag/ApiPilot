import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RawRequestCapture, RequestResult } from "@apipilot/shared-domain";
import {
  appendResult,
  createRun,
  getInProgressRun,
  getRun,
  listRuns,
  requestCancel,
  settleRun,
} from "../../../src/execution/executionRunStore";
import { RunNotFoundError } from "../../../src/execution/errors";
import { enterTestSession } from "../../../src/session/sessionContext";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { SqliteConnection, setSharedConnectionForTest, getSharedConnection } from "../../../src/persistence/connection";
import { getExecutionRunRepository } from "../../../src/persistence/executionRunRepository";

const environmentSnapshot = { name: "Local", tier: "local" as const, baseUrl: "http://localhost:4000" };

function passedResult(overrides: Partial<RequestResult> = {}): RequestResult {
  return {
    scenarioId: "scenario-1",
    operationPath: "/pets",
    operationMethod: "GET",
    outcome: "passed",
    startedAt: new Date().toISOString(),
    durationMs: 5,
    responseStatusCode: 200,
    assertionOutcomes: [],
    ...overrides,
  };
}

describe("executionRunStore", () => {
  it("creates a run in-progress and exposes it as the in-progress run", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    expect(run.status).toBe("in-progress");
    expect(getInProgressRun()?.id).toBe(run.id);
  });

  it("only one run can be in-progress at a time per session", () => {
    const first = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    settleRun(first.id, "completed");
    expect(getInProgressRun()).toBeUndefined();

    const second = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    expect(getInProgressRun()?.id).toBe(second.id);
  });

  it("appendResult grows results and recomputes the summary", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    appendResult(run.id, passedResult());
    const afterSecond = appendResult(
      run.id,
      passedResult({ scenarioId: "scenario-2", outcome: "failed", failureCategory: "unexpected-status" }),
    );
    expect(afterSecond.results).toHaveLength(2);
    expect(afterSecond.summary).toMatchObject({ total: 2, passed: 1, failed: 1, notAttempted: 0 });
  });

  it("settleRun marks a terminal status and clears the in-progress slot", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    const settled = settleRun(run.id, "completed");
    expect(settled.status).toBe("completed");
    expect(settled.completedAt).toBeDefined();
    expect(getInProgressRun()).toBeUndefined();
    expect(getRun(run.id).status).toBe("completed");
  });

  it("requestCancel marks the run without settling it", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    const cancelled = requestCancel(run.id);
    expect(cancelled.cancelRequested).toBe(true);
    expect(cancelled.status).toBe("in-progress");
  });

  it("listRuns returns newest first and retains settled runs", () => {
    const first = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    settleRun(first.id, "completed");
    const second = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    expect(listRuns().map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("listRuns stays newest-first even when two runs share the same millisecond timestamp", () => {
    // `startedAt` alone is not a safe sort key at millisecond resolution — a fast machine can
    // create two runs within the same millisecond, which is exactly the tie this forces
    // deterministically rather than relying on real-clock timing to (sometimes) reproduce it.
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    const tiedTimestamp = new Date().toISOString();
    const base = {
      workflowId: "wf-1",
      environmentId: "env-1",
      environmentSnapshot,
      status: "completed" as const,
      startedAt: tiedTimestamp,
      completedAt: tiedTimestamp,
      summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
      results: [],
      cancelRequested: false,
    };
    const repo = getExecutionRunRepository();
    repo.create(sessionId, { ...base, id: "run-a" });
    repo.create(sessionId, { ...base, id: "run-b" });
    expect(listRuns().map((r) => r.id)).toEqual(["run-b", "run-a"]);
  });

  it("throws RunNotFoundError for an unknown run id", () => {
    expect(() => getRun("missing")).toThrow(RunNotFoundError);
  });

  it("records cancelReason 'user-requested' when the caller passes it (specs/025 Clarifications Q1)", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    const cancelled = settleRun(run.id, "cancelled", "user-requested");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("user-requested");
  });

  it("markInterruptedRunsCancelled settles an in-progress run as cancelled/'backend-restart' (FR-008)", () => {
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    getExecutionRunRepository().markInterruptedRunsCancelled();
    const settled = getRun(run.id);
    expect(settled.status).toBe("cancelled");
    expect(settled.cancelReason).toBe("backend-restart");
  });

  it("removes a session's execution run history when its session is idle-evicted", () => {
    const sessionId = randomUUID();
    enterTestSession(sessionId);
    createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    expect(listRuns()).toHaveLength(1);

    forceExpireForTest(sessionId);
    expect(listRuns()).toEqual([]);
  });

  it("round-trips rawCapture for a 'local'-tier run (FR-017a)", () => {
    const rawCapture: RawRequestCapture = {
      requestUrl: "http://localhost:4000/pets",
      requestHeaders: [{ key: "Authorization", value: "Bearer secret" }],
      requestBody: '{"name":"Rex"}',
      responseHeaders: [{ key: "Content-Type", value: "application/json" }],
      responseBody: '{"id":"1"}',
    };
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    const updated = appendResult(run.id, passedResult({ rawCapture }));
    expect(updated.results[0].rawCapture).toEqual(rawCapture);
    expect(getRun(run.id).results[0].rawCapture).toEqual(rawCapture);
  });

  it("never persists rawCapture for a non-'local'-tier run, even if the caller passes one (FR-017a)", () => {
    const stagingSnapshot = { name: "Staging", tier: "staging" as const, baseUrl: "https://staging.example.com" };
    const rawCapture: RawRequestCapture = {
      requestUrl: "https://staging.example.com/pets",
      requestHeaders: [{ key: "Authorization", value: "Bearer secret" }],
      responseHeaders: [],
      responseBody: "should never be stored",
    };
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot: stagingSnapshot });
    const updated = appendResult(run.id, passedResult({ rawCapture }));
    expect(updated.results[0].rawCapture).toBeUndefined();
    expect(getRun(run.id).results[0].rawCapture).toBeUndefined();
  });

  it("stores rawCapture encrypted at rest, never as plaintext in the 'results' column (FR-017a, constitution XVII)", () => {
    const rawCapture: RawRequestCapture = {
      requestUrl: "http://localhost:4000/pets",
      requestHeaders: [{ key: "Authorization", value: "Bearer super-secret-token" }],
      responseHeaders: [],
      responseBody: "super-secret-response-body",
    };
    const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
    appendResult(run.id, passedResult({ rawCapture }));

    const row = getSharedConnection().db
      .prepare("SELECT results, raw_captures_encrypted FROM execution_runs WHERE id = ?")
      .get(run.id) as { results: string; raw_captures_encrypted: Buffer };
    expect(row.results).not.toContain("super-secret");
    expect(row.raw_captures_encrypted.toString("utf-8")).not.toContain("super-secret");
  });

  it("survives closing and reopening the database file, simulating a backend restart (specs/025 FR-002)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "apipilot.db");
    try {
      let connection = new SqliteConnection(dbPath);
      setSharedConnectionForTest(connection);
      const run = createRun({ workflowId: "wf-1", environmentId: "env-1", environmentSnapshot });
      settleRun(run.id, "completed");
      connection.close();

      connection = new SqliteConnection(dbPath);
      setSharedConnectionForTest(connection);
      const runs = listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(run.id);
      expect(runs[0].status).toBe("completed");
      connection.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
