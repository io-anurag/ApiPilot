import type { PerformancePlan } from "@apipilot/shared-domain";

/**
 * AP-033 FR-014 (specs/033-edit-step-request-body research R11): the plan as a run stores it. Body
 * edits are left out, so `performance_runs.plan_snapshot` still holds no body, as its table comment
 * and AP-029 research D20 require. Each edited step keeps its `bodyEdited` flag, so the run and its
 * report can still say which steps sent an engineer-written body.
 */
export function planSnapshotForRun(plan: PerformancePlan): PerformancePlan {
  return { ...plan, bodyEdits: [], discardedBodyEdits: [] };
}
