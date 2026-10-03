import type { ApiInfo, ApiModel, TestScenario } from "@apipilot/shared-domain";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import type { PerformanceContext } from "../plan/stepRequest";

/**
 * The session's quick performance test (AP-032, specs/032-quick-performance-test research Q1, Q13;
 * data-model "QuickPerformanceTest"): one per browser session, in memory only, cleared on session
 * expiry, and lost on a backend restart. Since AP-037 phase two it is a seeding source only: the
 * uploaded specification and its positive scenarios (specs/037-request-chain-performance FR-021).
 * Nothing here reads or writes the guided workflow (FR-021).
 */
export interface QuickPerformanceTest {
  /** Identifies the entry only; it appears in no plan, script or template. */
  id: string;
  specification: { filename: string; info?: ApiInfo; operationCount: number };
  apiModel: ApiModel;
  /** Positive rule-generated scenarios only, with quick ids (FR-004, research Q4). */
  scenarios: TestScenario[];
}

const quickTests = new Map<string, QuickPerformanceTest>();

onExpire((sessionId) => {
  quickTests.delete(sessionId);
});

export function getQuickTest(): QuickPerformanceTest | undefined {
  return quickTests.get(getSessionId());
}

export function hasQuickTest(): boolean {
  return quickTests.has(getSessionId());
}

/** Stores the session's quick test, replacing any earlier one. */
export function setQuickTest(test: QuickPerformanceTest): void {
  quickTests.set(getSessionId(), test);
}

/** The seeding inputs: every operation in scope, no workflows, so no chaining (FR-003, FR-006). */
export function contextFromQuickTest(test: Pick<QuickPerformanceTest, "apiModel" | "scenarios">): PerformanceContext {
  return {
    apiModel: test.apiModel,
    approvedScenarios: test.scenarios,
    workflows: [],
    relationships: [],
    selectedOperationKeys: undefined,
    source: "quick",
  };
}

/** Test-only: clears every session's quick test. */
export function resetQuickTestsForTest(): void {
  quickTests.clear();
}
