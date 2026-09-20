import { randomUUID } from "node:crypto";
import type { EnvironmentTier, ExecutionRunStatus, UploadedCollectionExecutionRun, UploadedRequestResult } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { getUploadedCollectionRunRepository } from "../persistence/uploadedCollectionRunRepository";
import { RunNotFoundError } from "./errors";

/**
 * Session-scoped uploaded-collection run history, mirroring `execution/executionRunStore.ts`
 * exactly (research.md D7) — a separate store/table from the generated-run one, cross-checked
 * against it for the shared FR-015 "one execution in progress" slot rather than merged into it.
 */

onExpire((sessionId) => {
  getUploadedCollectionRunRepository().deleteBySession(sessionId);
});

/** Returns the calling session's currently in-progress uploaded-collection run, if any (FR-015). */
export function getInProgressRun(): UploadedCollectionExecutionRun | undefined {
  return getUploadedCollectionRunRepository().getInProgress(getSessionId());
}

/** Creates and registers a new in-progress `UploadedCollectionExecutionRun` for the calling session (FR-005). */
export function createRun(input: {
  uploadedCollectionSetId: string;
  uploadedCollectionSnapshot: { name: string; tier: EnvironmentTier };
}): UploadedCollectionExecutionRun {
  const run: UploadedCollectionExecutionRun = {
    id: randomUUID(),
    source: "uploaded",
    uploadedCollectionSetId: input.uploadedCollectionSetId,
    uploadedCollectionSnapshot: input.uploadedCollectionSnapshot,
    status: "in-progress",
    startedAt: new Date().toISOString(),
    summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    results: [],
    cancelRequested: false,
  };
  getUploadedCollectionRunRepository().create(getSessionId(), run);
  return run;
}

export function getRun(runId: string): UploadedCollectionExecutionRun {
  const run = getUploadedCollectionRunRepository().get(getSessionId(), runId);
  if (!run) throw new RunNotFoundError(runId);
  return run;
}

/** Newest first. */
export function listRuns(): UploadedCollectionExecutionRun[] {
  return getUploadedCollectionRunRepository().listBySession(getSessionId());
}

/** Appends one settled `UploadedRequestResult` to a run in progress and recomputes its summary. */
export function appendResult(runId: string, result: UploadedRequestResult): UploadedCollectionExecutionRun {
  return getUploadedCollectionRunRepository().appendResult(getSessionId(), runId, result);
}

export function settleRun(
  runId: string,
  status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
  cancelReason?: "user-requested" | "backend-restart",
): UploadedCollectionExecutionRun {
  return getUploadedCollectionRunRepository().settle(getSessionId(), runId, status, cancelReason);
}

/** Records that cancellation has been requested for a run in progress (FR-014). Idempotent. */
export function requestCancel(runId: string): UploadedCollectionExecutionRun {
  return getUploadedCollectionRunRepository().requestCancel(getSessionId(), runId);
}

export function isCancelRequested(runId: string): boolean {
  return getRun(runId).cancelRequested;
}
