import type { PerformanceRun, PerformanceRunSummary } from "@apipilot/shared-domain";
import { getPerformanceRunRepository } from "../persistence/performanceRunRepository";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { PerformanceRunNotFoundError } from "./errors";

/**
 * Session-scoped AP-029 performance runs for route handlers (specs/031-k6-performance-testing
 * research D18), mirroring `execution/executionRunStore.ts`. Every function reads the calling
 * request's session. Background code (`runPerformanceTest.ts`) must not use these: it calls the
 * repository directly with a session id captured before the response.
 */

onExpire((sessionId) => {
  getPerformanceRunRepository().deleteBySession(sessionId);
});

/** The calling session's performance run in progress, if any (FR-029's shared slot). */
export function getPerformanceInProgressRun(): PerformanceRun | undefined {
  return getPerformanceRunRepository().getInProgress(getSessionId());
}

export function createPerformanceRun(run: PerformanceRun): PerformanceRun {
  getPerformanceRunRepository().create(getSessionId(), run);
  return run;
}

export function getPerformanceRun(runId: string): PerformanceRun {
  const run = getPerformanceRunRepository().get(getSessionId(), runId);
  if (!run) throw new PerformanceRunNotFoundError(runId);
  return run;
}

/** Newest first. */
export function listPerformanceRuns(): PerformanceRunSummary[] {
  return getPerformanceRunRepository().listBySession(getSessionId());
}

export function requestPerformanceCancel(runId: string): PerformanceRun {
  return getPerformanceRunRepository().requestCancel(getSessionId(), runId);
}
