import { randomUUID } from "node:crypto";
import type { Environment, ExecutionRun, ExecutionRunStatus, RequestResult } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { RunNotFoundError } from "./errors";

/**
 * Session-scoped execution run history (research.md D3/D9), same keying pattern as
 * `environmentStore.ts`/`workflowStore.ts`. A run, once created, is retained for the rest of the
 * session regardless of how it settles (FR-019/FR-020) — nothing here ever deletes a run.
 */

interface SessionRunState {
  runs: ExecutionRun[];
  /** At most one run is ever `"in-progress"` at a time per session (FR-008). */
  inProgressRunId: string | undefined;
}

const sessionStates = new Map<string, SessionRunState>();

onExpire((sessionId) => {
  sessionStates.delete(sessionId);
});

function getState(): SessionRunState {
  const sessionId = getSessionId();
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = { runs: [], inProgressRunId: undefined };
    sessionStates.set(sessionId, state);
  }
  return state;
}

/** Test-only hook to clear every session's run history between test runs. */
export function resetExecutionRunStore(): void {
  sessionStates.clear();
}

function emptySummary(): ExecutionRun["summary"] {
  return { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 };
}

function recomputeSummary(run: ExecutionRun): ExecutionRun["summary"] {
  const startedAtMs = new Date(run.startedAt).getTime();
  let latestMs = startedAtMs;
  const summary = emptySummary();
  summary.total = run.results.length;
  for (const result of run.results) {
    if (result.outcome === "passed") summary.passed += 1;
    else if (result.outcome === "failed") summary.failed += 1;
    else summary.notAttempted += 1;
    const settledAtMs = new Date(result.startedAt).getTime() + result.durationMs;
    if (settledAtMs > latestMs) latestMs = settledAtMs;
  }
  summary.durationMs = Math.max(0, latestMs - startedAtMs);
  return summary;
}

/** Returns the calling session's currently in-progress run, if any (FR-008). */
export function getInProgressRun(): ExecutionRun | undefined {
  const state = getState();
  if (!state.inProgressRunId) return undefined;
  return state.runs.find((run) => run.id === state.inProgressRunId);
}

/** Creates and registers a new in-progress `ExecutionRun` for the calling session (FR-006). */
export function createRun(input: {
  workflowId: string;
  environmentId: string;
  environmentSnapshot: Pick<Environment, "name" | "tier" | "baseUrl">;
}): ExecutionRun {
  const state = getState();
  const run: ExecutionRun = {
    id: randomUUID(),
    workflowId: input.workflowId,
    environmentId: input.environmentId,
    environmentSnapshot: input.environmentSnapshot,
    status: "in-progress",
    startedAt: new Date().toISOString(),
    summary: emptySummary(),
    results: [],
    cancelRequested: false,
  };
  state.runs = [run, ...state.runs];
  state.inProgressRunId = run.id;
  return run;
}

export function getRun(runId: string): ExecutionRun {
  const run = getState().runs.find((r) => r.id === runId);
  if (!run) throw new RunNotFoundError(runId);
  return run;
}

/** Newest first (FR-019/FR-020). */
export function listRuns(): ExecutionRun[] {
  return getState().runs;
}

function replaceRun(runId: string, patch: Partial<ExecutionRun>): ExecutionRun {
  const state = getState();
  const index = state.runs.findIndex((r) => r.id === runId);
  if (index === -1) throw new RunNotFoundError(runId);
  const updated: ExecutionRun = { ...state.runs[index], ...patch };
  state.runs[index] = updated;
  return updated;
}

/** Appends one settled `RequestResult` to a run in progress and recomputes its summary. */
export function appendResult(runId: string, result: RequestResult): ExecutionRun {
  const current = getRun(runId);
  const results = [...current.results, result];
  const updated = replaceRun(runId, { results });
  return replaceRun(runId, { summary: recomputeSummary(updated) });
}

/** Marks a run's terminal status (`"completed"` or `"cancelled"`) and clears it as the session's in-progress run. */
export function settleRun(
  runId: string,
  status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
): ExecutionRun {
  const state = getState();
  const updated = replaceRun(runId, { status, completedAt: new Date().toISOString() });
  if (state.inProgressRunId === runId) state.inProgressRunId = undefined;
  return updated;
}

/** Records that cancellation has been requested for a run in progress (FR-015). Idempotent. */
export function requestCancel(runId: string): ExecutionRun {
  return replaceRun(runId, { cancelRequested: true });
}

/** Whether cancellation has been requested for the given run. */
export function isCancelRequested(runId: string): boolean {
  return getRun(runId).cancelRequested;
}
