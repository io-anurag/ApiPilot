import type {
  ApiModel,
  EnvironmentTier,
  RunDetail,
  RunPlanProblem,
  RunPreview,
  RunRequestInput,
  SecurityProfile,
  SecurityRun,
  SecurityRunView,
  StartRunInput,
  EvidenceRecord,
  TargetEnvironment,
} from "@apipilot/shared-domain";
import { findExecutionInProgress } from "../../execution/executionSlot";
import type { SecurityCredentialRepository } from "../../persistence/securityCredentialRepository";
import type { SecurityLabLimits } from "../config";
import { SecurityLabError, invalidRequest, retentionLimitReached, runNotFound } from "../errors";
import { ProfileInvalidError } from "../profiles/profileValidation";
import { loadProfileForUse, type ProfileContext } from "../profiles/profileService";
import { requiresTargetRetype } from "../profiles/tierPolicy";
import { planRun, type PlannerContext, type RunPlan } from "./runPlanner";
import { runSecurityRun, type RunServiceDeps } from "./runSecurityRun";

/**
 * The run lifecycle (specs/057 FR-041 to FR-047, contracts/security-lab-api.md "Runs"). Start is two steps so the
 * executed plan is the confirmed plan: `previewRun` judges everything and sends nothing, and `startRun` recomputes the
 * same plan, refuses a different digest, checks every confirmation the tier requires, takes the one execution slot of
 * the session and only then begins. A run is never started by any other route, on a schedule or as a retry.
 */

export interface RunLifecycleContext {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly limits: SecurityLabLimits;
  readonly deps: RunServiceDeps;
  readonly profileContext: ProfileContext;
  readonly credentials: SecurityCredentialRepository;
  readonly apiModel?: ApiModel;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

/** Runs executing in this process, by run id, so a cancel can abort them. Cleared when a run settles. */
const activeRuns = new Map<string, ActiveRun>();

/** Test hook: resolves when every run of this process has settled. */
export async function settleActiveRuns(): Promise<void> {
  await Promise.all([...activeRuns.values()].map((active) => active.done));
}

export function toRunView(run: SecurityRun): SecurityRunView {
  // The owner id and the session id are cookie values, so a view never carries either.
  const view: Partial<SecurityRun> = { ...run };
  delete view.ownerId;
  delete view.sessionId;
  return view as SecurityRunView;
}

function runPlanInvalid(problems: RunPlanProblem[]): SecurityLabError {
  return new SecurityLabError("run_plan_invalid", "The run cannot start. Fix each listed problem and preview again.", { problems });
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

export function parseRunRequest(body: unknown): RunRequestInput & { rawLimits: unknown } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalidRequest("The request body must be an object.");
  const record = body as Record<string, unknown>;
  if (typeof record.profileId !== "string" || record.profileId === "") throw invalidRequest("'profileId' must be the id of a profile.");
  const items = record.items;
  if (!Array.isArray(items) || items.length > 5000) throw invalidRequest("'items' must be a list of up to 5000 {id, version} pairs. A filter is never accepted.");
  for (const item of items) {
    const entry = item as Record<string, unknown> | null;
    if (typeof entry !== "object" || entry === null || typeof entry.id !== "string" || !Number.isInteger(entry.version)) {
      throw invalidRequest("Every item must be an object with a string 'id' and an integer 'version'.");
    }
  }
  return { profileId: record.profileId, items: items as RunRequestInput["items"], rawLimits: record.limits };
}

export function parseStartRequest(body: unknown): StartRunInput & { rawLimits: unknown } {
  const base = parseRunRequest(body);
  const record = body as Record<string, unknown>;
  if (typeof record.planDigest !== "string" || !/^[0-9a-f]{64}$/.test(record.planDigest)) throw invalidRequest("'planDigest' must be the digest returned by the preview.");
  const confirmation = record.confirmation as Record<string, unknown> | null;
  if (typeof confirmation !== "object" || confirmation === null || Array.isArray(confirmation)) throw invalidRequest("'confirmation' must be an object.");
  const ids = confirmation.destructiveScenarioIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))) throw invalidRequest("'confirmation.destructiveScenarioIds' must be an array of scenario ids.");
  return {
    ...base,
    planDigest: record.planDigest,
    confirmation: {
      targetName: typeof confirmation.targetName === "string" ? confirmation.targetName : "",
      targetBaseUrl: typeof confirmation.targetBaseUrl === "string" ? confirmation.targetBaseUrl : "",
      authorizationAttested: confirmation.authorizationAttested === true,
      destructiveScenarioIds: (ids as string[] | undefined) ?? [],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

function loadForPlan(context: RunLifecycleContext, profileId: string): { profile: SecurityProfile; environment: TargetEnvironment } {
  try {
    return loadProfileForUse(context.profileContext, profileId);
  } catch (error) {
    if (error instanceof ProfileInvalidError) {
      throw runPlanInvalid(error.violations.map((violation) => ({ code: "profile_invalid" as const, message: `${violation.field}: ${violation.message}` })));
    }
    throw error;
  }
}

function plannerContext(context: RunLifecycleContext, profile: SecurityProfile, environment: TargetEnvironment): PlannerContext {
  return {
    ownerId: context.ownerId,
    repo: context.deps.scenarios,
    apiModel: context.apiModel,
    profile,
    environment,
    limits: context.limits,
    hasCredential: (identity, scheme, kind) => context.credentials.isSet(context.sessionId, { profileId: profile.id, identity, scheme, kind }),
    credential: (identity, scheme, kind) => context.credentials.read(context.sessionId, { profileId: profile.id, identity, scheme, kind }),
  };
}

function plan(context: RunLifecycleContext, request: RunRequestInput & { rawLimits: unknown }): { plan: RunPlan; profile: SecurityProfile; environment: TargetEnvironment } {
  const { profile, environment } = loadForPlan(context, request.profileId);
  return { plan: planRun(plannerContext(context, profile, environment), { items: request.items, limits: request.rawLimits }), profile, environment };
}

/** Judges everything a run would and sends nothing. */
export function previewRun(context: RunLifecycleContext, body: unknown): RunPreview {
  return plan(context, parseRunRequest(body)).plan.preview;
}

// ---------------------------------------------------------------------------------------------
// Start, read, cancel
// ---------------------------------------------------------------------------------------------

function checkConfirmation(preview: RunPreview, environment: TargetEnvironment, confirmation: StartRunInput["confirmation"]): void {
  const missing: string[] = [];
  if (!confirmation.authorizationAttested) missing.push("authorizationAttested");
  if (requiresTargetRetype(environment.tier)) {
    if (confirmation.targetName !== environment.name) missing.push("targetName");
    if (confirmation.targetBaseUrl !== environment.baseUrl) missing.push("targetBaseUrl");
  }
  const planned = new Set(preview.summary.destructive.map((entry) => entry.scenarioId));
  const confirmed = new Set(confirmation.destructiveScenarioIds);
  for (const id of planned) if (!confirmed.has(id)) missing.push(`destructiveScenarioIds:${id}`);
  for (const id of confirmed) if (!planned.has(id)) missing.push(`destructiveScenarioIds:${id} is not in the plan`);
  if (missing.length > 0) {
    throw new SecurityLabError("confirmation_required", "The run needs an explicit confirmation of the target before any request is sent.", { missing });
  }
}

export function startRun(context: RunLifecycleContext, body: unknown): { run: SecurityRunView } {
  const request = parseStartRequest(body);
  const { plan: built, profile, environment } = plan(context, request);
  const { preview } = built;

  if (preview.problems.length > 0) throw runPlanInvalid(preview.problems);
  if (preview.planDigest !== request.planDigest) {
    throw new SecurityLabError("plan_changed", "The plan changed since it was previewed (the profile, the target, a scenario or the limits). Preview it again and confirm the new plan.");
  }
  checkConfirmation(preview, environment, request.confirmation);

  // One execution per session, across every run kind. Checked and inserted with no await between, so two starts cannot both pass.
  const busy = findExecutionInProgress();
  if (busy) throw new SecurityLabError("execution_in_progress", "Another execution is already in progress in this session. Wait for it to finish or cancel it first.", { runId: busy.runId });
  if (context.deps.runs.countRuns(context.ownerId) >= context.limits.retention.maxRuns) throw retentionLimitReached("runs", context.limits.retention.maxRuns);

  const head = context.deps.scenarios.getScenario(context.ownerId, built.planned[0].scenarioId);
  const startedAt = context.deps.now().toISOString();
  const run: SecurityRun = {
    id: context.deps.newId(),
    ownerId: context.ownerId,
    sessionId: context.sessionId,
    status: "in-progress",
    cancelRequested: false,
    startedAt,
    profileSummary: {
      profileId: profile.id,
      profileName: profile.name,
      environmentName: environment.name,
      tier: environment.tier,
      baseUrl: environment.baseUrl,
      tlsPolicy: profile.tlsPolicy,
      permittedCategories: [...profile.permittedCategories],
      limits: built.limits,
      destructivePermitted: profile.destructivePermitted,
    },
    plan: built.planned.map((entry) => ({ scenarioId: entry.scenarioId, version: entry.version, plannedRequests: entry.plannedRequests + entry.cleanupRequests })),
    planDigest: preview.planDigest,
    limits: built.limits,
    budget: { planned: preview.summary.plannedRequests, used: 0 },
    confirmation: request.confirmation,
    summary: { passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 },
    cleanup: [],
    assessmentKey: head?.assessmentKey ?? "",
  };
  context.deps.runs.createRun(run);

  const apiModel = context.apiModel as ApiModel;
  const controller = new AbortController();
  const done = runSecurityRun(context.deps, {
    run,
    planned: built.planned,
    profile,
    environment: { tier: environment.tier as EnvironmentTier, baseUrl: environment.baseUrl },
    apiModel,
    limits: built.limits,
    credential: (identity, scheme, kind) => context.credentials.read(context.sessionId, { profileId: profile.id, identity, scheme, kind }),
    signal: controller.signal,
    profileSecrets: profileSecretsOf(context, profile.id),
  }).finally(() => activeRuns.delete(run.id));
  activeRuns.set(run.id, { controller, done });

  return { run: toRunView(run) };
}

/** Every credential value of the profile, plus the base64 form a Basic header carries, for literal masking. Held in memory for the run only. */
function profileSecretsOf(context: RunLifecycleContext, profileId: string): string[] {
  return context.credentials
    .readAllForRun(context.sessionId, profileId)
    .flatMap((credential) => [credential.value, Buffer.from(credential.value, "utf8").toString("base64")]);
}

export function listRuns(context: RunLifecycleContext): { runs: SecurityRunView[] } {
  return { runs: context.deps.runs.listRuns(context.ownerId).map(toRunView) };
}

export function getRun(context: RunLifecycleContext, id: string, query: { evidence?: boolean; scenarioId?: string }): RunDetail & { evidence?: { available: boolean; records: EvidenceRecord[] } } {
  const run = context.deps.runs.getRun(context.ownerId, id);
  if (!run) throw runNotFound(id);
  const stored = context.deps.runs.listResults(context.ownerId, id);
  const available = context.deps.evidence.availableResultIds(context.sessionId, stored.map((result) => result.id));
  const results = stored.map((result) => ({ ...result, evidenceAvailable: available.has(result.id) }));
  const finished = results.length;
  const detail: RunDetail = {
    run: toRunView(run),
    results,
    progress: { planned: run.plan.length, finished, inFlight: run.status === "in-progress" ? Math.max(0, Math.min(run.limits.maxConcurrency, run.plan.length - finished)) : 0 },
  };
  if (!query.evidence) return detail;
  const result = results.find((entry) => entry.scenarioId === query.scenarioId);
  if (!result) throw invalidRequest("'scenarioId' must name a scenario of this run when 'evidence' is requested.");
  const records = context.deps.evidence.list(context.sessionId, result.id);
  return { ...detail, evidence: { available: records.length > 0, records } };
}

export function cancelRun(context: RunLifecycleContext, id: string): { run: SecurityRunView } {
  const run = context.deps.runs.getRun(context.ownerId, id);
  if (!run) throw runNotFound(id);
  const active = activeRuns.get(id);
  if (run.status !== "in-progress" || !active) {
    throw new SecurityLabError("no_run_in_progress", "This run is not in progress, so there is nothing to cancel.");
  }
  context.deps.runs.updateRun(context.ownerId, id, { cancelRequested: true, cancelReason: "user-requested" });
  active.controller.abort();
  const updated = context.deps.runs.getRun(context.ownerId, id) as SecurityRun;
  return { run: toRunView(updated) };
}

