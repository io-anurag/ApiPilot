import type { ApiInfo, ApiModel, PerformancePlan, TestScenario } from "@apipilot/shared-domain";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import type { PerformanceContext } from "../plan/stepRequest";
import type { GeneratedScript } from "../scriptStore";

/**
 * The session's quick performance test (AP-032, specs/032-quick-performance-test research Q1, Q13;
 * data-model "QuickPerformanceTest"): one per browser session, in memory only, cleared on session
 * expiry, and lost on a backend restart as AP-029's plan is. Runs are persisted separately and
 * survive both. Nothing here reads or writes the guided workflow (FR-021).
 *
 * The spec's "Quick Performance Plan" is `QuickPerformanceTest.plan`.
 */
export interface QuickPerformanceTest {
  /** Identifies the entry only; it appears in no plan, script or template. */
  id: string;
  specification: { filename: string; info?: ApiInfo; operationCount: number };
  apiModel: ApiModel;
  /** Positive rule-generated scenarios only, with quick ids (FR-004, research Q4). */
  scenarios: TestScenario[];
  plan: PerformancePlan;
  script?: GeneratedScript;
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

/** Stores the session's quick test, replacing any earlier one and its script. */
export function setQuickTest(test: QuickPerformanceTest): void {
  quickTests.set(getSessionId(), test);
}

export function updateQuickTest(patch: Partial<Pick<QuickPerformanceTest, "plan" | "script">>): QuickPerformanceTest {
  const existing = getQuickTest();
  if (!existing) throw new Error("No quick performance test exists in this session.");
  const updated = { ...existing, ...patch };
  quickTests.set(getSessionId(), updated);
  return updated;
}

/** The plan's inputs: every operation in scope, no workflows, so no chaining (FR-003, FR-006). */
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
