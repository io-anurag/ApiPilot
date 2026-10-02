import type { EnvironmentTier, PerformancePlan } from "@apipilot/shared-domain";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import type { GeneratedScript } from "../scriptStore";
import type { CollectionPlanChoices } from "./assembleCollectionPlan";

/**
 * AP-036 (specs/036-collection-performance-test research R1, FR-025): the session's collection plan,
 * one per browser session, in memory only, cleared on session expiry and lost on a backend restart,
 * like AP-032's quick test. Runs are persisted separately and survive both. Nothing here reads or
 * writes the guided or quick plans, or the stored collection.
 */
export interface CollectionPerformanceTest {
  /** Identifies the entry only; it appears in no plan, script or template. */
  id: string;
  collection: { id: string; name: string; tier: EnvironmentTier };
  /**
   * The stored collection JSON the plan was built from (research R13). Settings change against it,
   * never against a newer version, until the engineer rebuilds.
   */
  snapshot: string;
  choices: CollectionPlanChoices;
  plan: PerformancePlan;
  script?: GeneratedScript;
}

const collectionTests = new Map<string, CollectionPerformanceTest>();

onExpire((sessionId) => {
  collectionTests.delete(sessionId);
});

export function getCollectionTest(): CollectionPerformanceTest | undefined {
  return collectionTests.get(getSessionId());
}

export function hasCollectionPlan(): boolean {
  return collectionTests.has(getSessionId());
}

/** Stores the session's collection plan, replacing any earlier one and its script. */
export function setCollectionTest(test: CollectionPerformanceTest): void {
  collectionTests.set(getSessionId(), test);
}

export function updateCollectionTest(patch: Partial<Pick<CollectionPerformanceTest, "plan" | "choices" | "script" | "snapshot">>): CollectionPerformanceTest {
  const existing = getCollectionTest();
  if (!existing) throw new Error("No collection performance plan exists in this session.");
  const updated = { ...existing, ...patch };
  collectionTests.set(getSessionId(), updated);
  return updated;
}
