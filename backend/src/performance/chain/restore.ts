import { randomUUID } from "node:crypto";
import type { ChainPlan, ChainPlanView, DataSetInfo } from "@apipilot/shared-domain";
import { getChainPlanDataSetRepository } from "../../persistence/chainPlanDataSetRepository";
import { getChainPlanRepository } from "../../persistence/chainPlanRepository";
import { getPerformanceRunRepository } from "../../persistence/performanceRunRepository";
import { getSessionId } from "../../session/sessionContext";
import { InvalidChainPlanError, PerformanceRunNotFoundError, PlanRevisionConflictError } from "../errors";
import { createPlan, getPlan, viewOf } from "./chainPlanStore";
import { generateChainScript } from "./generateScript";
import { withFingerprint } from "./savePlan";

/**
 * Restoring a chain run's plan (specs/037-request-chain-performance FR-035, research R21;
 * Clarification 2026-10-03). The run's encrypted plan copy, never its snapshot, holds the chains and
 * steps. Restore replaces the open plan's chains, steps and settings at the given revision, or creates
 * `<name> (restored)`; data sets are kept only where the same id and content still exist, and the
 * others are listed. It then generates the script. It never starts a run and copies no environment
 * value: none is in the copy (FR-027), and the target environment is the current plan's.
 */
export interface DataSetNotRestored {
  name: string;
  reason: "deleted" | "content-changed";
}

export interface RestoreResult {
  view: ChainPlanView;
  dataSetsNotRestored: DataSetNotRestored[];
}

function notRestored(copy: ChainPlan, available: readonly DataSetInfo[]): DataSetNotRestored[] {
  return copy.dataSets.flatMap((dataSet): DataSetNotRestored[] => {
    const current = available.find((candidate) => candidate.id === dataSet.id);
    if (!current) return [{ name: dataSet.name, reason: "deleted" }];
    return current.sha256 === dataSet.sha256 ? [] : [{ name: dataSet.name, reason: "content-changed" }];
  });
}

function planCopyOf(runId: string): ChainPlan {
  const document = getPerformanceRunRepository().getChainRunPlanDocument(getSessionId(), runId);
  if (document === undefined) throw new PerformanceRunNotFoundError(runId);
  return JSON.parse(document) as ChainPlan;
}

function withScript(plan: ChainPlan): ChainPlanView {
  const view = viewOf(plan);
  if (view.analysis.blockers.length > 0) return view;
  generateChainScript(plan, view.analysis);
  return viewOf(plan);
}

export function restoreRun(runId: string, body: unknown, now: string): RestoreResult {
  const request = (body ?? {}) as { into?: unknown; planId?: unknown; revision?: unknown };
  const copy = planCopyOf(runId);
  const run = getPerformanceRunRepository().getChainRun(getSessionId(), runId)!;
  const sessionId = getSessionId();

  if (request.into === "plan") {
    if (request.planId !== run.planId) throw new InvalidChainPlanError("planId", "A run is restored into the plan it was run from.");
    const current = getPlan(run.planId);
    if (request.revision !== current.revision) throw new PlanRevisionConflictError(current.id);
    const restored = withFingerprint({
      ...current,
      revision: current.revision + 1,
      chains: copy.chains,
      loadProfile: copy.loadProfile,
      thinkTimeMs: copy.thinkTimeMs,
      thresholds: copy.thresholds,
      secretNames: copy.secretNames,
      nextChainNumber: Math.max(current.nextChainNumber, copy.nextChainNumber),
      nextStepNumber: Math.max(current.nextStepNumber, copy.nextStepNumber),
      nextItemNumber: Math.max(current.nextItemNumber, copy.nextItemNumber),
      updatedAt: now,
    });
    if (!getChainPlanRepository().save(sessionId, restored, current.revision).ok) throw new PlanRevisionConflictError(current.id);
    return { view: withScript(getPlan(current.id)), dataSetsNotRestored: notRestored(copy, current.dataSets) };
  }
  if (request.into !== "new-plan") throw new InvalidChainPlanError("into", "Restore into this plan or into a new plan.");

  const created = createPlan(
    withFingerprint({
      ...copy,
      id: randomUUID(),
      name: `${copy.name} (restored)`.slice(0, 120),
      revision: 1,
      dataSets: [],
      targetEnvironmentId: run.environment.id,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const available = (() => {
    try {
      return getPlan(run.planId).dataSets;
    } catch {
      return [];
    }
  })();
  const missing = notRestored(copy, available);
  for (const dataSet of copy.dataSets) {
    if (missing.some((entry) => entry.name === dataSet.name)) continue;
    if (!getChainPlanDataSetRepository().copy(sessionId, run.planId, dataSet.id, created.plan.id, randomUUID(), now)) missing.push({ name: dataSet.name, reason: "deleted" });
  }
  return { view: withScript(getPlan(created.plan.id)), dataSetsNotRestored: missing };
}
