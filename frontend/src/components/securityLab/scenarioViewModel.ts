import type {
  EvaluationCondition,
  ExpectedBehavior,
  Prerequisite,
  ReviewItemOutcome,
  ScenarioDerivedFlags,
  ScenarioListItem,
  ScenarioReference,
  ScenarioVersionSummary,
  ScenarioViolationView,
  SecurityReviewAction,
  SecurityReviewState,
  SecurityScenarioContent,
  Severity,
} from "@apipilot/shared-domain";
import { SECURITY_REVIEW_ACTIONS } from "@apipilot/shared-domain";
import type { ScenarioFilterQuery } from "../../services/securityLabClient";
import type { StatusTone } from "../StatusBadge";
import type { Variant } from "./securityViewModel";

/**
 * Pure view logic for the Scenarios area (specs/057 FR-025 to FR-033, CLAUDE.md section 43): labels, flag
 * explanations, the review state machine as the interface offers it, the material-edit rule, batch partitioning
 * and condition wording. Components render what these return. Every rule that mirrors the backend (the review
 * transitions, the material and editable fields) is pinned against the backend source by a test, so it cannot
 * drift silently; nothing here imports backend code.
 */

/** Splits `"GET /orders/{id}"` into a method and a path for display. */
export function splitOperationKey(key: string): { method: string; path: string } {
  const space = key.indexOf(" ");
  return space < 0 ? { method: "", path: key } : { method: key.slice(0, space), path: key.slice(space + 1) };
}

/** `2026-10-18T09:12:03.000Z` as `2026-10-18 09:12 UTC`. Deterministic: no locale, no time zone of the machine. */
export function formatTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}

// ---------------------------------------------------------------------------------------------
// Derived flags (FR-004, FR-029)
// ---------------------------------------------------------------------------------------------

export type FlagKey = "specificationNotLoaded" | "orphaned" | "stale" | "blocked" | "executable";

export interface FlagView extends Variant {
  readonly key: FlagKey;
  /** Plain-language meaning, always shown beside or under the badge so the flag is never colour alone. */
  readonly explanation: string;
}

const FLAG_VIEWS: Readonly<Record<FlagKey, FlagView>> = {
  specificationNotLoaded: {
    key: "specificationNotLoaded",
    label: "Specification not loaded",
    tone: "neutral",
    explanation:
      "No specification is loaded, so this scenario cannot be checked against it. It stays readable; submitting, approving and editing its test need a specification.",
  },
  orphaned: {
    key: "orphaned",
    label: "Orphaned",
    tone: "warning",
    explanation: "The operation this scenario tests is no longer in the loaded specification.",
  },
  stale: {
    key: "stale",
    label: "Stale",
    tone: "warning",
    explanation: "The operation changed since this scenario was generated. Regenerate it and review the new version.",
  },
  blocked: {
    key: "blocked",
    label: "Blocked",
    tone: "warning",
    explanation: "At least one prerequisite is not met. The scenario can be approved, but it cannot run until they are met.",
  },
  executable: {
    key: "executable",
    label: "Executable",
    tone: "success",
    explanation: "Approved at its current version with every prerequisite met against the selected profile.",
  },
};

const FLAG_ORDER: readonly FlagKey[] = ["specificationNotLoaded", "orphaned", "stale", "blocked", "executable"];

/** The flags that are set, in a fixed order. */
export function flagViews(flags: ScenarioDerivedFlags): FlagView[] {
  return FLAG_ORDER.filter((key) => flags[key]).map((key) => FLAG_VIEWS[key]);
}

/** True when the scenario cannot be checked against the current specification (it is not stale-but-fine). */
export const isBasisUnavailable = (flags: ScenarioDerivedFlags): boolean => flags.specificationNotLoaded || flags.orphaned || flags.stale;

export interface FlagFilterOption {
  readonly value: NonNullable<ScenarioFilterQuery["flag"]> | "";
  readonly label: string;
}

export const FLAG_FILTER_OPTIONS: readonly FlagFilterOption[] = [
  { value: "", label: "Any" },
  { value: "specification_not_loaded", label: "Specification not loaded" },
  { value: "orphaned", label: "Orphaned" },
  { value: "stale", label: "Stale" },
  { value: "blocked", label: "Blocked" },
  { value: "executable", label: "Executable" },
];

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export const EMPTY_FILTERS: ScenarioFilterQuery = {};

/** How many filters are applied, for the "clear filters" control and the empty-state wording. */
export function activeFilterCount(filters: ScenarioFilterQuery): number {
  return Object.values(filters).filter((value) => value !== undefined && value !== "").length;
}

/** A filter object with `field` set, or removed when `value` is empty, so an unset filter is never sent. */
export function withFilter<K extends keyof ScenarioFilterQuery>(filters: ScenarioFilterQuery, field: K, value: ScenarioFilterQuery[K] | ""): ScenarioFilterQuery {
  const next: ScenarioFilterQuery = { ...filters };
  if (value === "" || value === undefined) delete next[field];
  else next[field] = value as ScenarioFilterQuery[K];
  return next;
}

// ---------------------------------------------------------------------------------------------
// Review actions (FR-028, contracts/review-and-approval-rules.md "Transitions")
// ---------------------------------------------------------------------------------------------

/** The transitions the interface offers. Mirrors `backend/src/securityLab/review/stateMachine.ts`; pinned by a test. */
export const REVIEW_TRANSITIONS: Readonly<Record<SecurityReviewState, Readonly<Partial<Record<SecurityReviewAction, SecurityReviewState>>>>> = {
  draft: { submit: "in_review", reject: "rejected" },
  in_review: { approve: "approved", reject: "rejected", withdraw: "draft" },
  approved: { withdraw: "in_review", reject: "rejected" },
  rejected: { reopen: "in_review" },
};

export function allowedActions(state: SecurityReviewState): SecurityReviewAction[] {
  return SECURITY_REVIEW_ACTIONS.filter((action) => REVIEW_TRANSITIONS[state][action] !== undefined);
}

export const ACTION_LABEL: Readonly<Record<SecurityReviewAction, string>> = {
  submit: "Submit for review",
  approve: "Approve",
  reject: "Reject",
  reopen: "Reopen",
  withdraw: "Withdraw",
};

/** Actions that could lead to a run, which the server refuses for a scenario it cannot check against the specification. */
export const NEEDS_CURRENT_BASIS: ReadonlySet<SecurityReviewAction> = new Set<SecurityReviewAction>(["submit", "approve", "reopen"]);

/** Why `action` cannot be taken on a scenario with these flags, or undefined when nothing stops it. The server refuses it too. */
export function actionBlockedReason(flags: ScenarioDerivedFlags, action: SecurityReviewAction): string | undefined {
  if (!NEEDS_CURRENT_BASIS.has(action)) return undefined;
  if (flags.specificationNotLoaded) return "No specification is loaded, so this scenario cannot be checked against it. Upload one to continue.";
  if (flags.orphaned) return "The operation is no longer in the specification.";
  if (flags.stale) return "The operation changed since this scenario was generated. Regenerate it first.";
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Batch review (FR-031, FR-033)
// ---------------------------------------------------------------------------------------------

export interface BatchCandidate extends ScenarioReference {
  readonly title: string;
  readonly operationKey: string;
  readonly reviewState: SecurityReviewState;
  readonly destructive: boolean;
  readonly flags: ScenarioDerivedFlags;
}

/**
 * Joins the explicit `{id, version}` set a filter resolved to with the details the list carries. The version is the
 * one `/scenarios/ids` returned, so a batch names exactly what the reviewer was shown. An id with no details means
 * the set changed while it was loading; the caller must reload rather than act on part of it.
 */
export function joinCandidates(references: readonly ScenarioReference[], items: readonly ScenarioListItem[]): { candidates: BatchCandidate[]; missing: number } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const candidates: BatchCandidate[] = [];
  let missing = 0;
  for (const reference of references) {
    const item = byId.get(reference.id);
    if (!item) {
      missing += 1;
      continue;
    }
    candidates.push({
      id: reference.id,
      version: reference.version,
      title: item.title,
      operationKey: item.operationKey,
      reviewState: item.reviewState,
      destructive: item.destructive,
      flags: item.flags,
    });
  }
  return { candidates, missing };
}

/** The actions at least one candidate can take, in the order the interface lists them. */
export function actionsOffered(candidates: readonly BatchCandidate[]): SecurityReviewAction[] {
  return SECURITY_REVIEW_ACTIONS.filter((action) => candidates.some((candidate) => REVIEW_TRANSITIONS[candidate.reviewState][action] !== undefined));
}

export interface BatchOptions {
  readonly includeDestructive: boolean;
  readonly includeIncomplete: boolean;
}

export interface BatchExclusions {
  /** The action is not allowed from the scenario's review state. */
  readonly notAllowedFromState: number;
  /** The action needs a specification the scenario can be checked against, and it cannot be. Cannot be included. */
  readonly needsCurrentSpecification: number;
  /** Destructive, and not included by choice. */
  readonly destructive: number;
  /** Blocked by an unmet prerequisite (or not checkable against the specification, for an action that does not need that), and not included by choice. */
  readonly incomplete: number;
}

export interface BatchPartition {
  readonly send: BatchCandidate[];
  /** The destructive scenarios among `send`: each is named in a separate confirmation. */
  readonly destructiveSent: BatchCandidate[];
  readonly excluded: BatchExclusions;
}

/**
 * What a batch action will be sent for, and what is left out and why. Each scenario is counted once, under the first
 * reason that applies, in the order of the fields of `BatchExclusions`. Destructive and incomplete scenarios are left
 * out by default and a choice brings them in; a scenario the specification cannot vouch for is never brought in for an
 * action that could lead to a run.
 */
export function partitionBatch(candidates: readonly BatchCandidate[], action: SecurityReviewAction, options: BatchOptions): BatchPartition {
  const send: BatchCandidate[] = [];
  let notAllowedFromState = 0;
  let needsCurrentSpecification = 0;
  let destructive = 0;
  let incomplete = 0;
  const needsBasis = NEEDS_CURRENT_BASIS.has(action);

  for (const candidate of candidates) {
    if (REVIEW_TRANSITIONS[candidate.reviewState][action] === undefined) {
      notAllowedFromState += 1;
    } else if (needsBasis && isBasisUnavailable(candidate.flags)) {
      needsCurrentSpecification += 1;
    } else if (candidate.destructive && !options.includeDestructive) {
      destructive += 1;
    } else if (!options.includeIncomplete && (candidate.flags.blocked || (!needsBasis && isBasisUnavailable(candidate.flags)))) {
      incomplete += 1;
    } else {
      send.push(candidate);
    }
  }
  return { send, destructiveSent: send.filter((candidate) => candidate.destructive), excluded: { notAllowedFromState, needsCurrentSpecification, destructive, incomplete } };
}

export function totalExcluded(excluded: BatchExclusions): number {
  return excluded.notAllowedFromState + excluded.needsCurrentSpecification + excluded.destructive + excluded.incomplete;
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

const PAST_TENSE: Readonly<Record<SecurityReviewAction, string>> = {
  submit: "submitted for review",
  approve: "approved",
  reject: "rejected",
  reopen: "reopened",
  withdraw: "withdrawn",
};

export const pastTense = (action: SecurityReviewAction): string => PAST_TENSE[action];

/** "3 of 5 scenarios were approved; 2 were refused." A partial application is always stated as one. */
export function outcomeSummary(action: SecurityReviewAction, applied: number, refused: number): string {
  const total = applied + refused;
  const noun = total === 1 ? "scenario" : "scenarios";
  if (refused === 0) return `${applied} of ${total} ${noun} ${applied === 1 ? "was" : "were"} ${pastTense(action)}.`;
  if (applied === 0) return `None of the ${total} ${noun} ${total === 1 ? "was" : "were"} ${pastTense(action)}; ${refused === 1 ? "it was" : "all were"} refused.`;
  return `${applied} of ${total} scenarios ${applied === 1 ? "was" : "were"} ${pastTense(action)}; ${refused} ${refused === 1 ? "was" : "were"} refused.`;
}

export const REFUSAL_LABEL: Readonly<Record<NonNullable<ReviewItemOutcome["reasonCode"]>, string>> = {
  scenario_not_found: "Not found",
  stale_version: "Version changed",
  invalid_transition: "Not allowed from its state",
  destructive_confirmation_required: "Needs destructive confirmation",
  not_executable_content: "Cannot be checked against the specification",
  reason_required: "Reason required",
};

// ---------------------------------------------------------------------------------------------
// Material and editable fields (FR-030)
// ---------------------------------------------------------------------------------------------

/**
 * The fields whose change makes a scenario a different test, so that approval does not carry over. Mirrors
 * `MATERIAL_FIELDS` in `backend/src/securityLab/scenarios/scenarioIdentity.ts`; pinned by a test.
 */
export const MATERIAL_FIELDS = [
  "operationKey",
  "categoryId",
  "baseRequest",
  "mutations",
  "expected",
  "conditions",
  "plannedRequestCount",
  "destructive.flag",
  "requiredIdentities",
] as const;

/** The fields an edit may change. Mirrors `EDITABLE_FIELDS` in `backend/src/securityLab/review/reviewService.ts`; pinned by a test. */
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

export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type ScenarioChanges = Partial<Pick<SecurityScenarioContent, EditableField>>;

/** JSON with object keys sorted, so two structurally equal values compare equal whatever their key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sameJson = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

function materialValue(content: SecurityScenarioContent, field: (typeof MATERIAL_FIELDS)[number]): unknown {
  switch (field) {
    case "operationKey":
      return content.operationKey;
    case "categoryId":
      return content.categoryId;
    case "baseRequest":
      return content.baseRequest;
    case "mutations":
      return content.mutations;
    case "expected":
      return content.expected;
    case "conditions":
      return content.conditions;
    case "plannedRequestCount":
      return content.plannedRequestCount;
    case "destructive.flag":
      return content.destructive.flag;
    case "requiredIdentities":
      return content.requiredIdentities;
  }
}

/** True when applying `changes` to `before` changes a material field, so an approval would not carry over. */
export function isMaterialEdit(before: SecurityScenarioContent, changes: ScenarioChanges): boolean {
  const after: SecurityScenarioContent = { ...before, ...changes };
  return MATERIAL_FIELDS.some((field) => !sameJson(materialValue(before, field), materialValue(after, field)));
}

/** The editable text of a scenario. JSON fields are text so the engineer sees and edits exactly what is stored. */
export interface EditDraft {
  title: string;
  objective: string;
  rationale: string;
  impact: string;
  suggestedSeverity: Severity;
  baseRequest: string;
  expected: string;
  conditions: string;
  note: string;
}

export const toJsonText = (value: unknown): string => JSON.stringify(value, null, 2);

export function draftFromContent(content: SecurityScenarioContent): EditDraft {
  return {
    title: content.title,
    objective: content.objective,
    rationale: content.rationale,
    impact: content.impact,
    suggestedSeverity: content.suggestedSeverity,
    baseRequest: toJsonText(content.baseRequest),
    expected: toJsonText(content.expected),
    conditions: toJsonText(content.conditions),
    note: "",
  };
}

export type JsonDraftField = "baseRequest" | "expected" | "conditions";

export interface DraftChanges {
  /** Only the fields whose value differs from the stored one, which is exactly what is sent. */
  readonly changes: ScenarioChanges;
  /** A JSON field that does not parse, or has the wrong shape: nothing can be saved until it is fixed. */
  readonly errors: Partial<Record<JsonDraftField, string>>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJsonField(text: string, shape: "object" | "array"): { ok: true; value: unknown } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "This is not valid JSON." };
  }
  if (shape === "object" && !isPlainObject(value)) return { ok: false, message: "This must be a JSON object." };
  if (shape === "array" && !Array.isArray(value)) return { ok: false, message: "This must be a JSON array." };
  return { ok: true, value };
}

/** Compares a draft with the stored content and returns the changed fields, or the JSON fields that cannot be read. */
export function changesFromDraft(content: SecurityScenarioContent, draft: EditDraft): DraftChanges {
  const changes: ScenarioChanges = {};
  const errors: Partial<Record<JsonDraftField, string>> = {};

  if (draft.title !== content.title) changes.title = draft.title;
  if (draft.objective !== content.objective) changes.objective = draft.objective;
  if (draft.rationale !== content.rationale) changes.rationale = draft.rationale;
  if (draft.impact !== content.impact) changes.impact = draft.impact;
  if (draft.suggestedSeverity !== content.suggestedSeverity) changes.suggestedSeverity = draft.suggestedSeverity;

  const request = parseJsonField(draft.baseRequest, "object");
  if (!request.ok) errors.baseRequest = request.message;
  else if (!sameJson(request.value, content.baseRequest)) changes.baseRequest = request.value as SecurityScenarioContent["baseRequest"];

  const expected = parseJsonField(draft.expected, "object");
  if (!expected.ok) errors.expected = expected.message;
  else if (!sameJson(expected.value, content.expected)) changes.expected = expected.value as ExpectedBehavior;

  const conditions = parseJsonField(draft.conditions, "array");
  if (!conditions.ok) errors.conditions = conditions.message;
  else if (!sameJson(conditions.value, content.conditions)) changes.conditions = conditions.value as EvaluationCondition[];

  return { changes, errors };
}

/** The `violations` list of a `scenario_invalid` reply, read defensively from the error details. */
export function parseViolations(details: Record<string, unknown>): ScenarioViolationView[] {
  const raw = details.violations;
  if (!Array.isArray(raw)) return [];
  const violations: ScenarioViolationView[] = [];
  for (const entry of raw) {
    if (isPlainObject(entry) && typeof entry.pointer === "string" && typeof entry.code === "string" && typeof entry.message === "string") {
      violations.push({ pointer: entry.pointer, code: entry.code, message: entry.message });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------
// Detail wording
// ---------------------------------------------------------------------------------------------

/** One evaluation condition in plain language. Exhaustive over the closed set of conditions. */
export function describeCondition(condition: EvaluationCondition): string {
  switch (condition.kind) {
    case "status.not-success":
      return "The response status is not a success (not 2xx).";
    case "status.in-set":
      return `The response status is one of ${condition.codes.join(", ")}.`;
    case "status.equals":
      return `The response status is ${condition.code}.`;
    case "status.not-equals":
      return `The response status is not ${condition.code}.`;
    case "header.present":
      return `The response has the "${condition.name}" header.`;
    case "header.absent":
      return `The response does not have the "${condition.name}" header.`;
    case "header.value-not-contains":
      return `The "${condition.name}" header does not contain "${condition.token}".`;
    case "body.field-absent":
      return `The response body has no "${condition.path}" field.`;
    case "body.field-present":
      return `The response body has a "${condition.path}" field.`;
    case "body.not-match-leak-pattern":
      return `The response body does not match the "${condition.patternId}" leak pattern.`;
    case "repeat.limit-engaged":
      return `A limit engages within ${condition.withinRequests} repeated requests.`;
    case "persisted.field-unchanged":
      return `The stored "${condition.path}" field is unchanged after the request.`;
  }
}

export interface BasisView {
  readonly label: string;
  readonly tone: StatusTone;
  readonly detail: string;
}

/** Whether the expected behavior is documented in the specification or is a named product rule (FR-024, constitution XIII). */
export function expectedBasisView(expected: ExpectedBehavior): BasisView {
  if (expected.basis === "documented") {
    const codes = expected.documentedStatusCodes && expected.documentedStatusCodes.length > 0 ? ` Documented status codes: ${expected.documentedStatusCodes.join(", ")}.` : "";
    const citation = expected.citation ? ` Source: ${expected.citation}.` : "";
    return { label: "Documented in the specification", tone: "success", detail: `The specification documents this behavior.${codes}${citation}` };
  }
  const rule = expected.ruleId ? ` (${expected.ruleId})` : "";
  return {
    label: "Product rule",
    tone: "info",
    detail: `The specification does not document this behavior. It follows a named ApiPilot rule${rule}, not a statement of the specification.`,
  };
}

export const PREREQUISITE_STATE: Readonly<Record<"met" | "missing" | "unsupported" | "unknown", Variant>> = {
  met: { label: "Met", tone: "success" },
  missing: { label: "Missing", tone: "warning" },
  unsupported: { label: "Not supported", tone: "danger" },
  unknown: { label: "Not evaluated", tone: "neutral" },
};

export const prerequisiteVariant = (prerequisite: Prerequisite): Variant => PREREQUISITE_STATE[prerequisite.state ?? "unknown"];

export interface PrerequisiteSummary {
  readonly total: number;
  readonly met: number;
  /** Everything not met, which is exactly what is missing. */
  readonly unmet: Prerequisite[];
}

export function summarizePrerequisites(prerequisites: readonly Prerequisite[]): PrerequisiteSummary {
  const unmet = prerequisites.filter((prerequisite) => prerequisite.state !== "met");
  return { total: prerequisites.length, met: prerequisites.length - unmet.length, unmet };
}

export interface ApprovalView {
  readonly headline: string;
  readonly details: string[];
}

/**
 * The approval attached to one version, and the version it applies to (FR-030, acceptance US2-8). An approval carried
 * over by a non-material edit says so; a withdrawn one says when; and an approval that is not on the current version
 * says it can no longer be used for a run.
 */
export function approvalView(version: ScenarioVersionSummary, currentVersion: number): ApprovalView | undefined {
  const approval = version.approval;
  if (!approval) return undefined;
  const details = [`Approved ${formatTimestamp(approval.approvedAt)}.`];
  if (approval.carriedFromVersion !== undefined) details.push(`Carried over from version ${approval.carriedFromVersion} because this edit was not material.`);
  if (approval.destructiveConfirmed) details.push("Destructive: confirmed by name.");
  if (approval.withdrawnAt) details.push(`Withdrawn ${formatTimestamp(approval.withdrawnAt)}.`);
  else if (version.version !== currentVersion) details.push(`Not current: version ${currentVersion} is the current version, so this approval cannot be used for a run.`);
  return { headline: `Approval applies to version ${approval.version}`, details };
}

export const AUTHOR_LABEL: Readonly<Record<ScenarioVersionSummary["author"], string>> = {
  generator: "Generated by ApiPilot",
  ai: "Suggested by AI",
  user: "Edited by you",
};

export const ORIGIN_LABEL: Readonly<Record<ScenarioListItem["origin"], string>> = {
  rule: "Rule-generated",
  ai: "AI-suggested",
  user: "Written by you",
};
