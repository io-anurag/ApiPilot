import type {
  ApiModel,
  PlannedScenarioSummary,
  RunLimits,
  RunPlanProblem,
  RunPlanProblemCode,
  RunPreview,
  RunRequestItem,
  SecurityProfile,
  SecurityScenarioVersion,
} from "@apipilot/shared-domain";
import type { SecurityScenarioRepository, StoredScenario } from "../../persistence/securityScenarioRepository";
import { basisHashes } from "../analysis/securityBasisHash";
import { hasLiveApproval } from "../review/reviewService";
import { contentHashOf } from "../scenarios/scenarioIdentity";
import { evaluatePrerequisites, type PrerequisiteContext } from "../scenarios/prerequisites";
import type { SecurityLabLimits } from "../config";
import { buildSecurityRequest, type CredentialLookup } from "./buildSecurityRequest";
import { planCleanup } from "./cleanup";
import { effectiveLimits, parseLimitOverrides } from "./limits";
import { computePlanDigest } from "./planDigest";

/**
 * The run preview (specs/057 FR-041 to FR-043, contracts/security-lab-api.md "Runs"). It judges everything a run
 * would, **sends nothing**, and returns the summary the person confirms, a digest that binds the confirmation to
 * this exact plan, and every problem with a code and a sentence. `POST /runs` recomputes the same plan and refuses
 * a different digest, so what runs is what was confirmed. The planner is pure over its inputs: repository reads
 * and a credential lookup, and no network.
 */

export const REAL_REQUESTS_STATEMENT = "Real requests will be sent to this target.";

export interface PlannerContext {
  readonly ownerId: string;
  readonly repo: SecurityScenarioRepository;
  readonly apiModel?: ApiModel;
  readonly profile: SecurityProfile;
  readonly environment: { readonly name: string; readonly tier: string; readonly baseUrl: string };
  readonly limits: SecurityLabLimits;
  readonly hasCredential: PrerequisiteContext["hasCredential"];
  /** Reads a credential value in memory, only to prove the request can be built. Never returned. */
  readonly credential: CredentialLookup;
}

/** One scenario version the run will execute, with everything the run service needs and nothing it must look up again. */
export interface PlannedExecution {
  readonly scenarioId: string;
  readonly version: number;
  readonly content: SecurityScenarioVersion["content"];
  readonly contentHash: string;
  readonly plannedRequests: number;
  readonly cleanupRequests: number;
}

export interface RunPlan {
  readonly preview: RunPreview;
  readonly planned: readonly PlannedExecution[];
  readonly limits: RunLimits;
}

function problem(code: RunPlanProblemCode, message: string, item?: RunRequestItem, extra: Partial<RunPlanProblem> = {}): RunPlanProblem {
  return { code, message, ...(item ? { scenarioId: item.id, version: item.version } : {}), ...extra };
}

function judgeItem(
  context: PlannerContext,
  item: RunRequestItem,
  scenario: StoredScenario,
  version: SecurityScenarioVersion,
  basis: ReadonlyMap<string, string> | undefined,
): RunPlanProblem[] {
  const problems: RunPlanProblem[] = [];
  const { content } = version;
  const { profile } = context;

  if (scenario.reviewState !== "approved" || !hasLiveApproval(version)) {
    problems.push(problem("not_approved", `"${content.title}" is not approved at version ${version.version}. Only an approved version can run.`, item));
  } else if (contentHashOf(content) !== version.contentHash || version.approval?.contentHash !== version.contentHash) {
    problems.push(problem("approval_not_current", `The content of "${content.title}" no longer matches what was approved. Review and approve it again.`, item));
  }

  if (!basis) {
    problems.push(problem("specification_not_loaded", `No specification is loaded, so "${content.title}" cannot be checked against its operation.`, item));
  } else if (!basis.has(content.operationKey)) {
    problems.push(problem("operation_missing", `${content.operationKey} is no longer in the specification.`, item));
  } else if (basis.get(content.operationKey) !== version.securityBasisHash) {
    problems.push(problem("operation_changed", `${content.operationKey} changed since "${content.title}" was generated. Regenerate and review it.`, item));
  }

  if (!profile.permittedCategories.includes(content.categoryId)) {
    problems.push(problem("category_not_permitted", `The profile does not permit the "${content.categoryId}" category.`, item));
  }
  if (content.destructive.flag) {
    if (!profile.destructivePermitted) problems.push(problem("destructive_not_permitted", `"${content.title}" may change or delete data, and this profile does not permit destructive scenarios.`, item));
    if (!version.approval?.destructiveConfirmed) problems.push(problem("destructive_not_approved", `"${content.title}" was not approved with the destructive confirmation.`, item));
  }

  const unmet = evaluatePrerequisites(content.prerequisites, { profile, hasCredential: context.hasCredential }).filter((entry) => entry.state !== "met");
  if (unmet.length > 0) {
    problems.push(problem("prerequisite_unmet", `"${content.title}" needs: ${unmet.map((entry) => entry.detail ?? entry.description).join(" ")}`, item));
  } else if (context.apiModel && basis?.has(content.operationKey)) {
    const built = buildSecurityRequest({ content, apiModel: context.apiModel, profile, baseUrl: context.environment.baseUrl, credential: context.credential });
    if (!built.ok) problems.push(problem("request_not_buildable", `"${content.title}" cannot be built: ${built.message}`, item));
  }
  return problems;
}

export function planRun(context: PlannerContext, input: { items: readonly RunRequestItem[]; limits?: unknown }): RunPlan {
  const problems: RunPlanProblem[] = [];
  const { overrides, problems: limitInputProblems } = parseLimitOverrides(input.limits);
  problems.push(...limitInputProblems.map((entry) => problem(entry.code, entry.message)));
  const { limits, problems: limitProblems } = effectiveLimits(context.profile, overrides, context.limits.ceilings);
  problems.push(...limitProblems.map((entry) => problem(entry.code, entry.message)));

  if (input.items.length === 0) problems.push(problem("no_items", "Choose at least one approved scenario to run."));

  const basis = context.apiModel ? basisHashes(context.apiModel) : undefined;
  const seen = new Set<string>();
  const planned: PlannedExecution[] = [];
  const summaries: PlannedScenarioSummary[] = [];

  for (const item of input.items) {
    if (seen.has(item.id)) {
      problems.push(problem("duplicate_item", `The scenario ${item.id} is listed more than once.`, item));
      continue;
    }
    seen.add(item.id);

    const scenario = context.repo.getScenario(context.ownerId, item.id);
    if (!scenario) {
      problems.push(problem("scenario_not_found", `No security scenario with id ${item.id} was found.`, item));
      continue;
    }
    if (item.version !== scenario.currentVersion) {
      problems.push(problem("stale_version", `The scenario is at version ${scenario.currentVersion}, not ${item.version}. Reload and choose the current version.`, item));
      continue;
    }
    const version = context.repo.getVersion(context.ownerId, item.id, scenario.currentVersion);
    if (!version) {
      problems.push(problem("scenario_not_found", `The scenario ${item.id} has no stored version ${item.version}.`, item));
      continue;
    }

    problems.push(...judgeItem(context, item, scenario, version, basis));

    const cleanup = context.apiModel ? planCleanup(context.apiModel, version.content, context.profile.cleanup) : { applicable: false, deleteOperation: undefined };
    const cleanupRequests = cleanup.applicable && cleanup.deleteOperation ? 1 : 0;
    const plannedRequests = version.content.plannedRequestCount;
    planned.push({ scenarioId: item.id, version: item.version, content: version.content, contentHash: version.contentHash, plannedRequests, cleanupRequests });
    summaries.push({
      scenarioId: item.id,
      version: item.version,
      title: version.content.title,
      operationKey: version.content.operationKey,
      categoryId: version.content.categoryId,
      plannedRequests,
      destructive: version.content.destructive.flag,
    });
  }

  const scenarioRequests = planned.reduce((sum, entry) => sum + entry.plannedRequests, 0);
  const cleanupRequests = planned.reduce((sum, entry) => sum + entry.cleanupRequests, 0);
  const allowed = Math.min(limits.maxRequests, context.limits.ceilings.maxRequests);
  if (scenarioRequests + cleanupRequests > allowed) {
    problems.push(
      problem("budget_exceeded", `The plan needs ${scenarioRequests + cleanupRequests} requests (${scenarioRequests} for scenarios, ${cleanupRequests} for cleanup) but at most ${allowed} are allowed. Choose fewer scenarios or raise the profile's limit within its ceiling.`, undefined, {
        required: scenarioRequests + cleanupRequests,
        allowed,
      }),
    );
  }

  const url = (() => {
    try {
      return new URL(context.environment.baseUrl);
    } catch {
      return undefined;
    }
  })();
  const port = url ? (url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port)) : 0;

  return {
    limits,
    planned,
    preview: {
      summary: {
        profileName: context.profile.name,
        environmentName: context.environment.name,
        tier: context.environment.tier,
        baseUrl: context.environment.baseUrl,
        tlsPolicy: context.profile.tlsPolicy,
        scenarioCount: planned.length,
        plannedRequests: scenarioRequests + cleanupRequests,
        cleanupRequests,
        destructive: summaries.filter((entry) => entry.destructive),
        destinations: url ? [{ host: url.hostname.replace(/^\[|\]$/g, ""), port }] : [],
        limits,
        permittedCategories: [...context.profile.permittedCategories],
        statement: REAL_REQUESTS_STATEMENT,
      },
      scenarios: summaries,
      planDigest: computePlanDigest({
        profile: context.profile,
        environment: { name: context.environment.name, tier: context.environment.tier, baseUrl: context.environment.baseUrl },
        items: planned.map((entry) => ({ id: entry.scenarioId, version: entry.version, contentHash: entry.contentHash })),
        limits,
      }),
      problems,
    },
  };
}
