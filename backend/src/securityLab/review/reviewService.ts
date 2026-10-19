import type {
  ApiModel,
  ReviewItemOutcome,
  ReviewRefusalCode,
  ScenarioDerivedFlags,
  SecurityReviewAction,
  SecurityReviewState,
  SecurityScenarioContent,
  SecurityScenarioVersion,
} from "@apipilot/shared-domain";
import type { SecurityScenarioRepository, StoredScenario } from "../../persistence/securityScenarioRepository";
import { SecurityLabError, invalidRequest, noSpecification, scenarioNotFound } from "../errors";
import { contentHashOf, isMaterialChange } from "../scenarios/scenarioIdentity";
import { validateScenario, type ScenarioViolation } from "../scenarios/validateScenario";
import { nextReviewState } from "./stateMachine";

/**
 * Versioned review (specs/057 FR-028 to FR-033, research R7, contracts/review-and-approval-rules.md). Scenario content
 * lives in immutable numbered **versions**, the generated original being version 1 and never edited. An approval
 * names a version and the hash of its material content, so an edit to anything material can never inherit an earlier
 * approval, while an edit to a title or a note keeps it. Edits keep the scenario's origin; the version records who made
 * them. Every transition is checked here, in the service, not by the interface.
 */

export interface ReviewContext {
  readonly repo: SecurityScenarioRepository;
  readonly now: () => Date;
  readonly actor: string;
  /** The derived flags of a scenario's current version against the model currently loaded. */
  readonly flagsFor: (scenario: StoredScenario, version: SecurityScenarioVersion) => ScenarioDerivedFlags;
}

export interface ReviewRequest {
  readonly action: SecurityReviewAction;
  readonly items: ReadonlyArray<{ id: string; version: number }>;
  readonly reason?: string;
  readonly destructiveConfirmations?: readonly string[];
}

function refuse(item: { id: string; version: number }, reasonCode: ReviewRefusalCode, message: string): ReviewItemOutcome {
  return { id: item.id, version: item.version, applied: false, reasonCode, message };
}

/** Actions that need the specification to judge: they could lead to a run, so a stale or orphaned scenario is refused. */
const NEEDS_CURRENT_BASIS: ReadonlySet<SecurityReviewAction> = new Set(["submit", "approve", "reopen"]);

/**
 * Applies one review action to an explicit list of `{id, version}` items. Each item succeeds or is refused on its
 * own, with a code and a reason; the others proceed, and a partial application is reported as one (FR-031, FR-032).
 * The server never expands a filter: the caller names every scenario.
 */
export function reviewItems(context: ReviewContext, ownerId: string, request: ReviewRequest): ReviewItemOutcome[] {
  const confirmed = new Set(request.destructiveConfirmations ?? []);
  const reason = request.reason?.trim() ?? "";
  return request.items.map((item) => reviewOne(context, ownerId, item, request.action, reason, confirmed));
}

function reviewOne(
  context: ReviewContext,
  ownerId: string,
  item: { id: string; version: number },
  action: SecurityReviewAction,
  reason: string,
  confirmed: ReadonlySet<string>,
): ReviewItemOutcome {
  const { repo } = context;
  const scenario = repo.getScenario(ownerId, item.id);
  if (!scenario) return refuse(item, "scenario_not_found", `No security scenario with id '${item.id}' was found.`);
  if (item.version !== scenario.currentVersion) {
    return refuse(item, "stale_version", `The scenario is at version ${scenario.currentVersion}, not ${item.version}. Reload it and review the current version.`);
  }
  const version = repo.getVersion(ownerId, item.id, scenario.currentVersion);
  if (!version) return refuse(item, "scenario_not_found", "The scenario's current version is missing.");

  const next = nextReviewState(scenario.reviewState, action);
  if (!next) {
    return refuse(item, "invalid_transition", `A scenario that is ${scenario.reviewState.replace("_", " ")} cannot be ${past(action)}.`);
  }
  if (action === "reject" && reason === "") return refuse(item, "reason_required", "Rejecting a scenario needs a reason.");

  if (NEEDS_CURRENT_BASIS.has(action)) {
    const flags = context.flagsFor(scenario, version);
    if (flags.specificationNotLoaded) return refuse(item, "not_executable_content", "No specification is loaded, so this scenario cannot be checked against it.");
    if (flags.orphaned) return refuse(item, "not_executable_content", "The scenario's operation is no longer in the specification.");
    if (flags.stale) return refuse(item, "not_executable_content", "The operation changed since this scenario was generated. Regenerate it and review the new version.");
  }

  const now = context.now().toISOString();
  if (action === "approve") {
    if (version.content.destructive.flag && !confirmed.has(item.id)) {
      return refuse(item, "destructive_confirmation_required", "This scenario may change or delete data. Confirm it by name to approve it.");
    }
    if (contentHashOf(version.content) !== version.contentHash) {
      return refuse(item, "not_executable_content", "The stored content does not match its hash, so it cannot be approved.");
    }
    repo.setApproval(ownerId, item.id, version.version, {
      version: version.version,
      contentHash: version.contentHash,
      approvedAt: now,
      actor: context.actor,
      destructiveConfirmed: version.content.destructive.flag,
    });
  } else if (action === "reject") {
    repo.setRejection(ownerId, item.id, version.version, { reason, at: now });
    withdrawApproval(repo, ownerId, version, now);
  } else if (action === "withdraw") {
    withdrawApproval(repo, ownerId, version, now);
  } else if (action === "reopen") {
    repo.setRejection(ownerId, item.id, version.version, undefined);
  }

  repo.updateHead(ownerId, item.id, { reviewState: next, updatedAt: now });
  return { id: item.id, version: item.version, applied: true, reviewState: next };
}

function past(action: SecurityReviewAction): string {
  return { submit: "submitted for review", approve: "approved", reject: "rejected", reopen: "reopened", withdraw: "withdrawn" }[action];
}

/** Stamps the version's approval withdrawn, keeping the record so history shows what was approved and when. */
function withdrawApproval(repo: SecurityScenarioRepository, ownerId: string, version: SecurityScenarioVersion, now: string): void {
  if (version.approval && !version.approval.withdrawnAt) {
    repo.setApproval(ownerId, version.scenarioId, version.version, { ...version.approval, withdrawnAt: now });
  }
}

/** True when `version` carries a live approval for exactly its own version and content. */
export function hasLiveApproval(version: SecurityScenarioVersion): boolean {
  const approval = version.approval;
  return approval !== undefined && approval.withdrawnAt === undefined && approval.version === version.version && approval.contentHash === version.contentHash;
}

// ---------------------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------------------

/** The fields an edit may change. The operation and the category are not editable: that would be a different scenario. */
export const EDITABLE_FIELDS = [
  "title",
  "objective",
  "rationale",
  "impact",
  "suggestedSeverity",
  "limitations",
  "manualInputs",
  "baseRequest",
  "mutations",
  "expected",
  "conditions",
  "plannedRequestCount",
  "requiredIdentities",
  "prerequisites",
  "destructive",
] as const;

export interface EditInput {
  readonly expectedVersion: number;
  readonly changes: Record<string, unknown>;
  readonly note?: string;
}

export interface EditEnvironment {
  /** Present only while a specification is loaded; a material edit needs it. */
  readonly apiModel?: ApiModel;
  readonly maxRepeat: number;
  /** The loaded model's basis hash for the scenario's operation, stamped on the new version. */
  readonly basisHash?: string;
  readonly specificationRevision?: string;
}

export interface EditResult {
  readonly scenarioId: string;
  readonly version: number;
  readonly material: boolean;
  readonly reviewState: SecurityReviewState;
}

export class ScenarioInvalidError extends SecurityLabError {
  constructor(public readonly violations: ScenarioViolation[]) {
    super("scenario_invalid", "The edited scenario is not valid. Nothing was changed.", { violations });
  }
}

export function editScenario(context: ReviewContext, ownerId: string, id: string, input: EditInput, environment: EditEnvironment): EditResult {
  const { repo } = context;
  const scenario = repo.getScenario(ownerId, id);
  if (!scenario) throw scenarioNotFound(id);
  if (input.expectedVersion !== scenario.currentVersion) {
    throw new SecurityLabError("stale_version", `The scenario is at version ${scenario.currentVersion}, not ${input.expectedVersion}. Reload it and edit the current version.`, {
      currentVersion: scenario.currentVersion,
    });
  }
  if (scenario.reviewState === "rejected") {
    throw new SecurityLabError("scenario_rejected", "A rejected scenario cannot be edited. Reopen it first.");
  }
  const current = repo.getVersion(ownerId, id, scenario.currentVersion);
  if (!current) throw scenarioNotFound(id);

  const unknown = Object.keys(input.changes).filter((key) => !(EDITABLE_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw invalidRequest(`These fields cannot be edited: ${unknown.join(", ")}. The operation and the category are fixed; a different scenario is a different scenario.`);
  }
  if (Object.keys(input.changes).length === 0) throw invalidRequest("An edit must change at least one field.");

  const merged = { ...current.content, ...input.changes } as SecurityScenarioContent;
  const material = isMaterialChange(current.content, merged);
  if (material && !environment.apiModel) throw noSpecification();

  const validation = validateScenario(merged, { apiModel: environment.apiModel, maxRepeat: environment.maxRepeat });
  const violations = validation.ok ? [] : [...validation.violations];
  const probes = merged.mutations.some((mutation) => mutation.kind === "method.probe");
  if (current.content.destructive.flag && !merged.destructive.flag && !probes) {
    violations.push({ pointer: "/destructive/flag", code: "destructive_flag_lowered", message: "/destructive/flag: the flag can be raised by an edit but never lowered." });
  }
  if (violations.length > 0) throw new ScenarioInvalidError(violations);

  const now = context.now().toISOString();
  const version = scenario.currentVersion + 1;
  repo.insertVersion(ownerId, {
    scenarioId: id,
    version,
    contentHash: contentHashOf(merged),
    specificationRevision: environment.specificationRevision ?? current.specificationRevision,
    securityBasisHash: environment.basisHash ?? current.securityBasisHash,
    content: merged,
    author: "user",
    createdAt: now,
    ...(input.note ? { editNote: input.note } : {}),
    materialChange: material,
    // A non-material edit leaves the material content, and so the approval's hash, unchanged: the approval is carried over.
    ...(!material && hasLiveApproval(current) && current.approval
      ? { approval: { ...current.approval, version, carriedFromVersion: current.version } }
      : {}),
  });

  // A material edit takes an approved scenario back to review and clears what it had shown; a non-material edit leaves both alone.
  let reviewState: SecurityReviewState = scenario.reviewState;
  if (material && reviewState === "approved") reviewState = nextReviewState("approved", "withdraw") ?? "in_review";
  repo.updateHead(ownerId, id, {
    currentVersion: version,
    reviewState,
    ...(material ? { executionStatus: "not_run" as const } : {}),
    title: merged.title,
    severity: merged.suggestedSeverity,
    destructive: merged.destructive.flag,
    updatedAt: now,
  });
  return { scenarioId: id, version, material, reviewState };
}
