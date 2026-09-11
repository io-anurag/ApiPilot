import { beforeEach, describe, expect, it } from "vitest";
import type { RequestResult } from "@apipilot/shared-domain";
import {
  appendResult,
  createRun,
  getInProgressRun,
  getRun,
  listRuns,
  requestCancel,
  resetExecutionRunStore,
  settleRun,
} from "../../../src/execution/executionRunStore";
import { RunNotFoundError } from "../../../src/execution/errors";

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
  beforeEach(() => resetExecutionRunStore());

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

  it("throws RunNotFoundError for an unknown run id", () => {
    expect(() => getRun("missing")).toThrow(RunNotFoundError);
  });
});
