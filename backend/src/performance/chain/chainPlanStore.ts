import { randomUUID } from "node:crypto";
import {
  analyzeChainPlan,
  CHAIN_PLAN_LIMITS,
  type ChainPlan,
  type ChainPlanSummary,
  type ChainPlanView,
  type DataSetInfo,
  type Environment,
  type MovedCredential,
  type ScriptStatus,
} from "@apipilot/shared-domain";
import { getEnvironment, updateEnvironment } from "../../execution/environmentStore";
import { EnvironmentNotFoundError } from "../../execution/errors";
import { getChainPlanDataSetRepository } from "../../persistence/chainPlanDataSetRepository";
import { getChainPlanRepository } from "../../persistence/chainPlanRepository";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import { ChainPlanNotFoundError, PlanLimitExceededError, PlanRevisionConflictError } from "../errors";
import { startingProfile } from "../plan/loadProfiles";
import { deleteChainScript, getChainScript, type GeneratedScript } from "../scriptStore";
import { moveLiteralCredentials } from "./literalCredentials";
import { normalizePlanInput, planFingerprint, withChangedMarks, withFingerprint } from "./savePlan";

/**
 * Session-scoped request-chain plans for route handlers (specs/037-request-chain-performance
 * research R2), as `performanceRunStore.ts` is for runs. Every function reads the calling request's
 * session. Saving is synchronous from the revision check to the write, so two saves of one plan
 * cannot both pass. Literal credentials are moved into the target environment before the plan is
 * stored (FR-027), and no value is ever returned or logged.
 */

onExpire((sessionId) => {
  getChainPlanRepository().deleteBySession(sessionId);
});

const DEFAULT_THINK_TIME_MS = 1000;

/** The target environment, or `null` when the plan has none or it no longer exists. */
export function targetEnvironmentOf(plan: Pick<ChainPlan, "targetEnvironmentId">): Environment | null {
  if (!plan.targetEnvironmentId) return null;
  try {
    return getEnvironment(plan.targetEnvironmentId);
  } catch (error) {
    if (error instanceof EnvironmentNotFoundError) return null;
    throw error;
  }
}

/** Value names only: `baseUrl` when the environment has one, and every non-empty value. */
export function environmentValueNames(environment: Environment | null): string[] | null {
  if (!environment) return null;
  const names = Object.entries(environment.variableValues)
    .filter(([, value]) => value !== "")
    .map(([name]) => name);
  return environment.baseUrl ? ["baseUrl", ...names] : names;
}

export function scriptStatusOf(plan: ChainPlan, script: GeneratedScript | undefined): ScriptStatus | null {
  if (!script) return null;
  return { planFingerprint: script.planFingerprint, scriptSha256: script.scriptSha256, stepCount: script.stepCount, outOfDate: script.planFingerprint !== plan.fingerprint };
}

export function viewOf(plan: ChainPlan): ChainPlanView {
  const analysis = analyzeChainPlan(plan, { environmentValueNames: environmentValueNames(targetEnvironmentOf(plan)) });
  return { plan, analysis, script: scriptStatusOf(plan, getChainScript(plan.id)) };
}

/** Whether the calling session holds a plan: it opens environment management (contracts "Runs"). */
export function hasChainPlan(): boolean {
  return getChainPlanRepository().count(getSessionId()) > 0;
}

export function listPlans(): ChainPlanSummary[] {
  return getChainPlanRepository().list(getSessionId());
}

/**
 * The plan with its data sets (metadata only), or `ChainPlanNotFoundError`. The fingerprint is taken
 * here, because a data set change alters the script's structure without a save of the plan (R22).
 */
export function getPlan(planId: string): ChainPlan {
  const sessionId = getSessionId();
  const plan = getChainPlanRepository().get(sessionId, planId);
  if (!plan) throw new ChainPlanNotFoundError(planId);
  const dataSets: DataSetInfo[] = getChainPlanDataSetRepository().list(sessionId, planId);
  const withDataSets = { ...plan, dataSets };
  return { ...withDataSets, fingerprint: planFingerprint(withDataSets) };
}

function requireRoom(): void {
  if (getChainPlanRepository().count(getSessionId()) >= CHAIN_PLAN_LIMITS.plansPerSession) {
    throw new PlanLimitExceededError("plansPerSession", `A session holds at most ${CHAIN_PLAN_LIMITS.plansPerSession} plans. Delete one first.`, 409);
  }
}

/** A plan with one empty chain, the smoke profile and a 1 s default think time (contracts "POST /"). */
export function emptyPlan(name: string, now: string): ChainPlan {
  return withFingerprint({
    id: randomUUID(),
    name,
    revision: 1,
    chains: [{ id: "c1", name: "Chain 1", steps: [] }],
    loadProfile: startingProfile("smoke"),
    thinkTimeMs: DEFAULT_THINK_TIME_MS,
    thresholds: [],
    targetEnvironmentId: null,
    secretNames: [],
    dataSets: [],
    seedingReport: null,
    nextChainNumber: 2,
    nextStepNumber: 1,
    nextItemNumber: 1,
    fingerprint: "",
    createdAt: now,
    updatedAt: now,
  });
}

/** Stores a new plan (empty, seeded or restored), after the session limit check. */
export function createPlan(plan: ChainPlan): ChainPlanView {
  requireRoom();
  getChainPlanRepository().create(getSessionId(), plan);
  return viewOf(getPlan(plan.id));
}

/** Writes each moved literal into the environment as a value; returns what the editor is told. */
function storeMovedValues(environment: Environment, moves: { stepId: string; location: MovedCredential["location"]; valueName: string; value: string }[]): MovedCredential[] {
  if (moves.length === 0) return [];
  const variableValues = { ...environment.variableValues };
  for (const move of moves) variableValues[move.valueName] = move.value;
  updateEnvironment(environment.id, { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl, variableValues, requestDelayMs: environment.requestDelayMs });
  return moves.map((move) => ({ stepId: move.stepId, location: move.location, valueName: move.valueName, environmentName: environment.name }));
}

/** Moves literal credentials to the plan's target environment (which must exist when there is one to move). */
export function withCredentialsMoved(plan: ChainPlan): { plan: ChainPlan; movedCredentials: MovedCredential[] } {
  const environment = plan.targetEnvironmentId ? getEnvironment(plan.targetEnvironmentId) : null;
  const moved = moveLiteralCredentials(plan, environment ? { name: environment.name, valueNames: Object.keys(environment.variableValues) } : null);
  if (moved.moves.length === 0) return { plan, movedCredentials: [] };
  const movedCredentials = storeMovedValues(environment!, moved.moves);
  return { plan: withFingerprint(withChangedMarks(moved.plan)), movedCredentials };
}

/**
 * Saves the client's plan at `revision` (contracts "PUT /:planId"). A stale revision is refused with
 * the current plan; nothing is written. Refusals leave the plan and the environment unchanged.
 */
export function savePlan(planId: string, revision: unknown, input: unknown, now: string): { view: ChainPlanView; movedCredentials: MovedCredential[] } {
  const sessionId = getSessionId();
  const stored = getPlan(planId);
  if (revision !== stored.revision) throw new PlanRevisionConflictError(planId);
  const normalized = normalizePlanInput(input, stored, now);
  if (normalized.targetEnvironmentId && targetEnvironmentOf(normalized) === null) throw new EnvironmentNotFoundError(normalized.targetEnvironmentId);
  const { plan, movedCredentials } = withCredentialsMoved(normalized);
  const saved = getChainPlanRepository().save(sessionId, plan, stored.revision);
  if (!saved.ok) throw new PlanRevisionConflictError(planId);
  return { view: viewOf(getPlan(planId)), movedCredentials };
}

/** A copy with a new id and name, with copies of its data sets; runs and the script are not copied (contracts "duplicate"). */
export function duplicatePlan(planId: string, name: string, now: string): ChainPlanView {
  const source = getPlan(planId);
  requireRoom();
  const copy = withFingerprint({ ...source, id: randomUUID(), name, revision: 1, createdAt: now, updatedAt: now, dataSets: [] });
  const sessionId = getSessionId();
  getChainPlanRepository().create(sessionId, copy);
  for (const dataSet of source.dataSets) getChainPlanDataSetRepository().copy(sessionId, planId, dataSet.id, copy.id, randomUUID(), now);
  return viewOf(getPlan(copy.id));
}

export function deletePlan(planId: string): void {
  getPlan(planId);
  getChainPlanRepository().delete(getSessionId(), planId);
  deleteChainScript(planId);
}
