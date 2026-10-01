import type { UserScriptRun, UserScriptRunSummary } from "@apipilot/shared-domain";
import { getUserScriptRunRepository } from "../../persistence/userScriptRunRepository";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import { PerformanceRunNotFoundError } from "../errors";

/**
 * Session-scoped AP-034 user-script runs for route handlers (specs/034-run-user-k6-script FR-023,
 * FR-030; research R9), mirroring `performanceRunStore.ts`. Background code must not use these: it
 * calls the repository with a session id captured before the response.
 */

onExpire((sessionId) => {
  getUserScriptRunRepository().deleteBySession(sessionId);
});

export function listUserScriptRuns(scriptId?: string): UserScriptRunSummary[] {
  return getUserScriptRunRepository().listBySession(getSessionId(), scriptId);
}

export function getUserScriptRun(runId: string): UserScriptRun {
  const run = getUserScriptRunRepository().get(getSessionId(), runId);
  if (!run) throw new PerformanceRunNotFoundError(runId);
  return run;
}

export function requestUserScriptCancel(runId: string): UserScriptRun {
  return getUserScriptRunRepository().requestCancel(getSessionId(), runId);
}
