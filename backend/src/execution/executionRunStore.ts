import { randomUUID } from "node:crypto";
import type { Environment, ExecutionRun, ExecutionRunStatus, RequestResult } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { getExecutionRunRepository } from "../persistence/executionRunRepository";
import { RunNotFoundError } from "./errors";

/**
 * Session-scoped execution run history (research.md D9), same keying pattern as
 * `environmentStore.ts`/`workflowStore.ts`. Durably backed by SQLite (specs/025-local-
 * persistence-layer research.md D4) — a run, once created, is retained for the rest of its
 * session's lifetime regardless of how it settles (FR-019/FR-020), surviving a backend restart
 * along the way.
 */

onExpire((sessionId) => {
  getExecutionRunRepository().deleteBySession(sessionId);
});

/** Returns the calling session's currently in-progress run, if any (FR-008). */
export function getInProgressRun(): ExecutionRun | undefined {
  return getExecutionRunRepository().getInProgress(getSessionId());
}

/** Creates and registers a new in-progress `ExecutionRun` for the calling session (FR-006). */
export function createRun(input: {
  workflowId: string;
  environmentId: string;
  environmentSnapshot: Pick<Environment, "name" | "tier" | "baseUrl">;
}): ExecutionRun {
  const run: ExecutionRun = {
    id: randomUUID(),
    workflowId: input.workflowId,
    environmentId: input.environmentId,
    environmentSnapshot: input.environmentSnapshot,
    status: "in-progress",
    startedAt: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results: [],
    cancelRequested: false,
  };
  getExecutionRunRepository().create(getSessionId(), run);
  return run;
}

export function getRun(runId: string): ExecutionRun {
  const run = getExecutionRunRepository().get(getSessionId(), runId);
  if (!run) throw new RunNotFoundError(runId);
  return run;
}

/** Newest first (FR-019/FR-020). */
export function listRuns(): ExecutionRun[] {
  return getExecutionRunRepository().listBySession(getSessionId());
}

/** Appends one settled `RequestResult` to a run in progress and recomputes its summary. */
export function appendResult(runId: string, result: RequestResult): ExecutionRun {
  return getExecutionRunRepository().appendResult(getSessionId(), runId, result);
}

/**
 * Marks a run's terminal status. `cancelReason` distinguishes why a `"cancelled"` run ended
 * (specs/025-local-persistence-layer Clarifications 2026-09-16 Q1) — the user-initiated cancel
 * path passes `"user-requested"`; `markInterruptedRunsCancelled()` (called once at startup) is
 * the only caller that uses `"backend-restart"`.
 */
export function settleRun(
  runId: string,
  status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
  cancelReason?: "user-requested" | "backend-restart",
): ExecutionRun {
  return getExecutionRunRepository().settle(getSessionId(), runId, status, cancelReason);
}

/** Records that cancellation has been requested for a run in progress (FR-015). Idempotent. */
export function requestCancel(runId: string): ExecutionRun {
  return getExecutionRunRepository().requestCancel(getSessionId(), runId);
}

/** Whether cancellation has been requested for the given run. */
export function isCancelRequested(runId: string): boolean {
  return getRun(runId).cancelRequested;
}
