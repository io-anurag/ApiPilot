import { getInProgressRun as getUploadedInProgressRun } from "../externalCollections/uploadedCollectionExecutionStore";
import { getPerformanceInProgressRun } from "../performance/performanceRunStore";
import { getPerformanceRunRepository } from "../persistence/performanceRunRepository";
import { getUserScriptRunRepository } from "../persistence/userScriptRunRepository";
import { getSessionId } from "../session/sessionContext";
import { getInProgressRun as getGeneratedInProgressRun } from "./executionRunStore";

/**
 * The session-wide "one execution in progress" slot (specs/018 FR-008, specs/026 FR-015,
 * specs/031 FR-029, specs/034 FR-023, specs/037 research R19; research R9 of specs/034). Every
 * start route asks this one helper, so adding a run kind cannot leave a route unaware of it. It is
 * synchronous: callers check and insert with no `await` in between, so two starts in one session
 * cannot both pass.
 */
export function findExecutionInProgress(): { runId: string } | null {
  const run =
    getGeneratedInProgressRun() ??
    getUploadedInProgressRun() ??
    getPerformanceInProgressRun() ??
    getPerformanceRunRepository().getChainInProgress(getSessionId()) ??
    getUserScriptRunRepository().getInProgress(getSessionId());
  return run ? { runId: run.id } : null;
}
