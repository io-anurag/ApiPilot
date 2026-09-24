import type { FailureAnalysis } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import { getFailureAnalysisRepository } from "../persistence/failureAnalysisRepository";

/**
 * Session-scoped access to stored failure analyses, mirroring
 * `externalCollections/uploadedCollectionExecutionStore.ts`. Registering the eviction listener
 * here means importing the feature always deletes an evicted session's analyses (FR-013).
 */

onExpire((sessionId) => {
  getFailureAnalysisRepository().deleteBySession(sessionId);
});

export interface FailureAnalysisStore {
  saveAnalysis(analysis: FailureAnalysis): void;
  getAnalysis(runId: string, resultIndex: number): FailureAnalysis | undefined;
  listAnalyses(runId: string): FailureAnalysis[];
}

export function saveAnalysis(analysis: FailureAnalysis): void {
  getFailureAnalysisRepository().upsert(getSessionId(), analysis);
}

export function getAnalysis(runId: string, resultIndex: number): FailureAnalysis | undefined {
  return getFailureAnalysisRepository().get(getSessionId(), runId, resultIndex);
}

export function listAnalyses(runId: string): FailureAnalysis[] {
  return getFailureAnalysisRepository().listByRun(getSessionId(), runId);
}

export const failureAnalysisStore: FailureAnalysisStore = { saveAnalysis, getAnalysis, listAnalyses };
