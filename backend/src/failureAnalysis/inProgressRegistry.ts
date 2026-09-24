import type { FailureAnalysisInProgress } from "@apipilot/shared-domain";
import { onExpire } from "../session/sessionRegistry";

/**
 * The session's single failure analysis in progress (FR-016, specs/030-ai-failure-analysis
 * research D10). In memory only: a backend restart drops it, and nothing half-finished is stored.
 */
export interface InProgressRegistry {
  /** Synchronous check-and-set; `false` when the session already has an analysis in progress. */
  tryBegin(sessionId: string, target: Pick<FailureAnalysisInProgress, "runId" | "resultIndex" | "requestName">): boolean;
  markGenerating(sessionId: string): void;
  end(sessionId: string): void;
  get(sessionId: string): FailureAnalysisInProgress | undefined;
}

export function createInProgressRegistry(now: () => Date = () => new Date()): InProgressRegistry {
  const entries = new Map<string, FailureAnalysisInProgress>();
  return {
    tryBegin(sessionId, target) {
      if (entries.has(sessionId)) return false;
      entries.set(sessionId, { ...target, phase: "waiting-for-ai", phaseStartedAt: now().toISOString() });
      return true;
    },
    markGenerating(sessionId) {
      const entry = entries.get(sessionId);
      if (entry) entries.set(sessionId, { ...entry, phase: "generating", phaseStartedAt: now().toISOString() });
    },
    end(sessionId) {
      entries.delete(sessionId);
    },
    get(sessionId) {
      const entry = entries.get(sessionId);
      return entry ? { ...entry } : undefined;
    },
  };
}

export const inProgressRegistry = createInProgressRegistry();

onExpire((sessionId) => inProgressRegistry.end(sessionId));
