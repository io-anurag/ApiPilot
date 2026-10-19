import type {
  CleanupResult,
  RunConfirmation,
  RunLimits,
  RunPlanProblem,
  RunPreviewSummary,
  ScenarioListItem,
  ScenarioOutcomeKind,
  SecurityProfile,
  SecurityRunStatus,
} from "@apipilot/shared-domain";
import { requiresTargetRetype, parsePositiveInteger } from "./profileViewModel";
import type { Variant } from "./securityViewModel";

/**
 * Pure view logic for planning and following a run (specs/057 FR-041 to FR-047, contracts/execution-safety-rules.md):
 * why a scenario cannot be chosen, the limits a run may set, what the confirmation needs before Start is enabled, and
 * the wording of statuses, outcomes and cleanup. Labels are always text, and "blocked" and "not run" are worded so
 * they can never be read as a pass.
 */

// ---------------------------------------------------------------------------------------------
// Choosing scenarios
// ---------------------------------------------------------------------------------------------

/**
 * Why `item` cannot be chosen for a run with `profile`, one sentence per reason, or an empty list when it can. The
 * server judges this again at preview and at start; the reasons here are for the person choosing, so an unavailable
 * scenario is shown with its reason and never silently hidden.
 */
export function unselectableReasons(item: ScenarioListItem, profile: SecurityProfile | undefined): string[] {
  if (!profile) return ["Choose a profile first: a scenario is judged against the profile it would run with."];
  const reasons: string[] = [];
  if (item.reviewState !== "approved") reasons.push("It is not approved.");
  if (item.flags.specificationNotLoaded) reasons.push("No specification is loaded, so it cannot be checked against its operation.");
  if (item.flags.orphaned) reasons.push("Its operation is no longer in the specification.");
  if (item.flags.stale) reasons.push("Its operation changed since it was generated. Regenerate it and approve the new version.");
  if (!profile.permittedCategories.includes(item.categoryId)) reasons.push(`The profile does not permit the "${item.categoryId}" category.`);
  if (item.destructive && !profile.destructivePermitted) reasons.push("It may change or delete data, and the profile does not permit destructive scenarios.");
  if (item.flags.blocked) {
    const unmet = item.prerequisites.total - item.prerequisites.met;
    reasons.push(`${unmet} of ${item.prerequisites.total} prerequisites are not met by this profile (an identity, a role, test data or a credential it lacks).`);
  }
  if (reasons.length === 0 && !item.flags.executable) reasons.push("Its approval is not current for this version.");
  return reasons;
}

export const isSelectable = (item: ScenarioListItem, profile: SecurityProfile | undefined): boolean => unselectableReasons(item, profile).length === 0 && item.flags.executable;

// ---------------------------------------------------------------------------------------------
// Limits (a run may lower the profile's limits, never raise them)
// ---------------------------------------------------------------------------------------------

export interface LimitInputs {
  maxRequests: string;
  maxConcurrency: string;
  timeoutMs: string;
}

export const limitInputsFrom = (limits: Pick<SecurityProfile, keyof RunLimits>): LimitInputs => ({
  maxRequests: String(limits.maxRequests),
  maxConcurrency: String(limits.maxConcurrency),
  timeoutMs: String(limits.timeoutMs),
});

const LIMIT_LABEL: Readonly<Record<keyof RunLimits, string>> = {
  maxRequests: "Most requests",
  maxConcurrency: "Most requests at once",
  timeoutMs: "Timeout per request",
};

export interface LimitCheck {
  /** Only the limits that are lower than the profile's, which is all the server accepts as an override. */
  readonly overrides: Partial<RunLimits>;
  readonly errors: string[];
}

/** Reads the run's limit fields against the profile's. A value above the profile's is an error, never clamped. */
export function checkLimits(inputs: LimitInputs, profile: Pick<SecurityProfile, keyof RunLimits>): LimitCheck {
  const overrides: Partial<RunLimits> = {};
  const errors: string[] = [];
  for (const field of ["maxRequests", "maxConcurrency", "timeoutMs"] as const) {
    const value = parsePositiveInteger(inputs[field]);
    if (value === undefined) errors.push(`${LIMIT_LABEL[field]} must be a whole number of at least 1.`);
    else if (value > profile[field]) errors.push(`${LIMIT_LABEL[field]} is ${value}, above the ${profile[field]} this profile allows. A run can lower a limit but never raise it.`);
    else if (value < profile[field]) overrides[field] = value;
  }
  return { overrides, errors };
}

// ---------------------------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------------------------

export interface ConfirmationInputs {
  readonly attested: boolean;
  readonly typedName: string;
  readonly typedUrl: string;
  readonly destructiveConfirmed: ReadonlySet<string>;
}

export interface StartCheck {
  readonly canStart: boolean;
  /** Everything still needed before Start is enabled, in words. */
  readonly reasons: string[];
}

/**
 * Whether Start may be enabled. The typed target name and base URL are compared exactly (no trimming, no case
 * folding), as the server does, and only for a tier that needs them. A plan with problems can never start.
 */
export function checkStart(summary: RunPreviewSummary, problems: readonly RunPlanProblem[], inputs: ConfirmationInputs): StartCheck {
  const reasons: string[] = [];
  if (problems.length > 0) reasons.push("The plan has problems. Fix them and preview again.");
  if (!inputs.attested) reasons.push("Confirm that you are authorized to test this target.");
  if (requiresTargetRetype(summary.tier)) {
    if (inputs.typedName !== summary.environmentName) reasons.push("Type the exact target name.");
    if (inputs.typedUrl !== summary.baseUrl) reasons.push("Type the exact base URL.");
  }
  const unconfirmed = summary.destructive.filter((entry) => !inputs.destructiveConfirmed.has(entry.scenarioId));
  if (unconfirmed.length > 0) reasons.push(`Confirm each destructive scenario (${unconfirmed.length} not confirmed).`);
  return { canStart: reasons.length === 0, reasons };
}

/**
 * The confirmation sent with a start. For a tier that needs the target retyped, what the person typed is sent as
 * typed. For a local target nothing is typed, so the names the preview showed are sent.
 */
export function buildConfirmation(summary: RunPreviewSummary, inputs: ConfirmationInputs): RunConfirmation {
  const retype = requiresTargetRetype(summary.tier);
  return {
    targetName: retype ? inputs.typedName : summary.environmentName,
    targetBaseUrl: retype ? inputs.typedUrl : summary.baseUrl,
    authorizationAttested: inputs.attested,
    destructiveScenarioIds: summary.destructive.filter((entry) => inputs.destructiveConfirmed.has(entry.scenarioId)).map((entry) => entry.scenarioId),
  };
}

export const problemText = (problem: RunPlanProblem): string => `${problem.code}: ${problem.message}`;

/** The `problems` of a `run_plan_invalid` reply, read defensively from the error details. */
export function parsePlanProblems(details: Record<string, unknown>): RunPlanProblem[] {
  const raw = details.problems;
  if (!Array.isArray(raw)) return [];
  const problems: RunPlanProblem[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      if (typeof record.code === "string" && typeof record.message === "string") problems.push({ ...(record as unknown as RunPlanProblem) });
    }
  }
  return problems;
}

/** The `missing` of a `confirmation_required` reply, as sentences. */
export function missingConfirmationText(details: Record<string, unknown>): string[] {
  const missing = details.missing;
  if (!Array.isArray(missing)) return [];
  return missing.filter((entry): entry is string => typeof entry === "string").map((entry) => {
    if (entry === "authorizationAttested") return "The authorization confirmation is missing.";
    if (entry === "targetName") return "The typed target name does not match.";
    if (entry === "targetBaseUrl") return "The typed base URL does not match.";
    if (entry.startsWith("destructiveScenarioIds:")) return `A destructive scenario is not confirmed (${entry.slice("destructiveScenarioIds:".length)}).`;
    return entry;
  });
}

// ---------------------------------------------------------------------------------------------
// Statuses, outcomes, cleanup
// ---------------------------------------------------------------------------------------------

export interface ExplainedVariant extends Variant {
  readonly explanation: string;
}

export const RUN_STATUS: Readonly<Record<SecurityRunStatus, ExplainedVariant>> = {
  "in-progress": { label: "In progress", tone: "info", explanation: "Requests are being sent to the target." },
  completed: { label: "Completed", tone: "success", explanation: "Every planned scenario was attempted." },
  cancelled: { label: "Cancelled", tone: "warning", explanation: "The run was stopped before it finished. The results below are partial." },
  failed: { label: "Failed", tone: "danger", explanation: "The run stopped because of an error. The results below are partial." },
};

export const isRunFinal = (status: SecurityRunStatus): boolean => status !== "in-progress";

/** Outcomes with the sentence that says what each does and does not mean. Blocked and not run are never a pass. */
export const OUTCOME_EXPLANATION: Readonly<Record<ScenarioOutcomeKind, string>> = {
  passed: "Every evaluation condition was met by the responses seen. This is not proof that the API is secure.",
  failed: "At least one evaluation condition was violated. The behavior observed is a potential finding to review.",
  inconclusive: "The responses did not allow a pass or fail to be decided.",
  blocked: "Not run as planned: a safety rule or an unmet requirement stopped it. This is not a pass.",
  errored: "A request failed (a timeout, a connection problem or similar), so no judgement could be made. This is not a pass.",
  not_run: "Not run: the run ended before this scenario was attempted. This is not a pass.",
};

export const CLEANUP_STATE: Readonly<Record<CleanupResult["state"], Variant>> = {
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
};

/** The cleanup entries that did not finish, which the person must know about because something may remain on the target. */
export const failedCleanup = (cleanup: readonly CleanupResult[]): CleanupResult[] => cleanup.filter((entry) => entry.state === "failed");
