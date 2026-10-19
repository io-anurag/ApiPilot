import type {
  ConfidenceLevel,
  FindingHistoryEntry,
  FindingStatus,
  ObservedSummary,
  SecurityFinding,
  SecurityScenarioContent,
  Severity,
} from "@apipilot/shared-domain";
import { FINDING_STATUSES, SEVERITIES } from "@apipilot/shared-domain";
import type { SecurityFindingRepository } from "../../persistence/securityFindingRepository";
import { hash16 } from "../canonical";
import { SecurityLabError, findingNotFound } from "../errors";
import { remediationFor } from "../evaluation/remediationText";

/**
 * Findings and their lifecycle (specs/057 contracts/evaluation-and-findings-rules.md "Finding lifecycle and
 * occurrences", research R24, FR-054 to FR-059). A scenario **version** has at most one finding: the first `failed`
 * result creates it and every later `failed` result of the same version appends an occurrence, so the occurrence
 * count equals the number of failed results over any number of reruns (SC-011). A material edit makes a new version,
 * whose first failure creates a separate finding that names the earlier one in `supersedes`.
 *
 * Only a `failed` result reaches this module. `blocked`, `not_run`, `errored` and `inconclusive` never create or extend a
 * finding, and none counts as a pass. History and occurrences are append-only.
 */

export interface FindingContext {
  readonly ownerId: string;
  readonly repo: SecurityFindingRepository;
  readonly now: () => Date;
  /** Who a manual change is attributed to. ApiPilot is single-user per browser, so this is a fixed label. */
  readonly actor: string;
}

export const SYSTEM_ACTOR = "system";

export function findingIdFor(scenarioId: string, version: number): string {
  return `sf-${hash16([scenarioId, version])}`;
}

export interface FailureInput {
  readonly assessmentKey: string;
  readonly scenarioId: string;
  readonly version: number;
  readonly content: SecurityScenarioContent;
  readonly resultId: string;
  readonly runId: string;
  readonly observed: ObservedSummary;
  readonly confidence: { level: ConfidenceLevel; basis: string };
}

function entry(context: FindingContext, field: string, from: string, to: string, actor: string, note?: string): FindingHistoryEntry {
  return { at: context.now().toISOString(), field, from, to, actor, ...(note ? { note } : {}) };
}

/** The finding of the closest earlier version of the scenario, if any: what a material edit supersedes. */
function earlierFinding(context: FindingContext, scenarioId: string, version: number): SecurityFinding | undefined {
  for (let earlier = version - 1; earlier >= 1; earlier -= 1) {
    const found = context.repo.findByVersion(context.ownerId, scenarioId, earlier);
    if (found) return found;
  }
  return undefined;
}

/** Records one failed result: creates the finding, or extends it according to its status. */
export function recordFailure(context: FindingContext, input: FailureInput): SecurityFinding {
  const at = context.now().toISOString();
  const occurrence = { resultId: input.resultId, runId: input.runId, at, observed: input.observed, confidence: input.confidence };
  const existing = context.repo.findByVersion(context.ownerId, input.scenarioId, input.version);

  if (!existing) {
    const remediation = remediationFor(input.content);
    const supersedes = earlierFinding(context, input.scenarioId, input.version);
    const created: SecurityFinding = {
      id: findingIdFor(input.scenarioId, input.version),
      ownerId: context.ownerId,
      assessmentKey: input.assessmentKey,
      scenarioId: input.scenarioId,
      scenarioVersion: input.version,
      ...(supersedes ? { supersedes: supersedes.id } : {}),
      operationKey: input.content.operationKey,
      specElementPointer: input.content.provenance.specElementPointer,
      categoryId: input.content.categoryId,
      taxonomy: input.content.taxonomy,
      expected: input.content.expected,
      severity: { suggested: input.content.suggestedSeverity, current: input.content.suggestedSeverity },
      confidence: input.confidence,
      remediationId: remediation.id,
      remediation: remediation.text,
      status: "open",
      resolvedAssertion: "engineer-asserted",
      occurrences: [occurrence],
      occurrenceCount: 1,
      firstFailedAt: at,
      latestFailedAt: at,
      unreviewedOccurrence: false,
      history: [],
    };
    context.repo.save(created);
    return created;
  }

  // The same result is never counted twice, so recording is safe to repeat.
  if (existing.occurrences.some((known) => known.resultId === input.resultId)) return existing;

  const history = [...existing.history];
  let status: FindingStatus = existing.status;
  let unreviewed = existing.unreviewedOccurrence;
  if (existing.status === "resolved") {
    status = "open";
    history.push(entry(context, "status", "resolved", "open", SYSTEM_ACTOR, "Reopened by a new occurrence."));
  } else if (existing.status === "accepted-risk" || existing.status === "false-positive") {
    if (!unreviewed) {
      history.push(entry(context, "unreviewedOccurrence", "false", "true", SYSTEM_ACTOR, `A new occurrence arrived while the finding was marked ${existing.status}.`));
    }
    unreviewed = true;
  }

  const occurrences = [...existing.occurrences, occurrence];
  const updated: SecurityFinding = {
    ...existing,
    status,
    unreviewedOccurrence: unreviewed,
    confidence: input.confidence,
    occurrences,
    occurrenceCount: occurrences.length,
    latestFailedAt: at,
    history,
  };
  context.repo.save(updated);
  return updated;
}

/**
 * Records a `passed` result of a scenario version. If the finding for that version was marked resolved by the engineer,
 * the pass verifies it: `engineer-asserted` becomes `verified-by-rerun`. Nothing else changes, and a pass never
 * resolves a finding on its own.
 */
export function recordPass(context: FindingContext, scenarioId: string, version: number): SecurityFinding | undefined {
  const existing = context.repo.findByVersion(context.ownerId, scenarioId, version);
  if (!existing || existing.status !== "resolved" || existing.resolvedAssertion === "verified-by-rerun") return existing;
  const updated: SecurityFinding = {
    ...existing,
    resolvedAssertion: "verified-by-rerun",
    history: [
      ...existing.history,
      entry(context, "resolvedAssertion", "engineer-asserted", "verified-by-rerun", SYSTEM_ACTOR, "A later run of this scenario version passed."),
    ],
  };
  context.repo.save(updated);
  return updated;
}

// ---------------------------------------------------------------------------------------------
// Manual changes
// ---------------------------------------------------------------------------------------------

export interface FindingPatch {
  status?: FindingStatus;
  severity?: Severity;
  note?: string;
  acknowledgeOccurrences?: boolean;
}

const MAX_NOTE = 1000;

const invalid = (message: string) => new SecurityLabError("invalid_finding_update", message);

export function parseFindingPatch(body: unknown): FindingPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid("The request body must be an object.");
  const record = body as Record<string, unknown>;
  const allowed = new Set(["status", "severity", "note", "acknowledgeOccurrences"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw invalid(`'${key}' cannot be changed. Only status, severity, note and acknowledgeOccurrences can.`);
  }
  const patch: FindingPatch = {};
  if (record.status !== undefined) {
    if (typeof record.status !== "string" || !(FINDING_STATUSES as readonly string[]).includes(record.status)) {
      throw invalid(`'status' must be one of ${FINDING_STATUSES.join(", ")}.`);
    }
    patch.status = record.status as FindingStatus;
  }
  if (record.severity !== undefined) {
    if (typeof record.severity !== "string" || !(SEVERITIES as readonly string[]).includes(record.severity)) {
      throw invalid(`'severity' must be one of ${SEVERITIES.join(", ")}.`);
    }
    patch.severity = record.severity as Severity;
  }
  if (record.note !== undefined) {
    if (typeof record.note !== "string" || record.note.length > MAX_NOTE) throw invalid(`'note' must be a string of at most ${MAX_NOTE} characters.`);
    patch.note = record.note.trim();
  }
  if (record.acknowledgeOccurrences !== undefined) {
    if (typeof record.acknowledgeOccurrences !== "boolean") throw invalid("'acknowledgeOccurrences' must be true or false.");
    patch.acknowledgeOccurrences = record.acknowledgeOccurrences;
  }
  return patch;
}

/**
 * A manual change by the engineer. Every status or severity change needs a note and is added to the history with the
 * time and the previous value. An open finding can move to accepted-risk, false-positive or resolved, and any other
 * status can only return to open. The suggested severity is never touched.
 */
export function updateFinding(context: FindingContext, id: string, patch: FindingPatch): SecurityFinding {
  const existing = context.repo.get(context.ownerId, id);
  if (!existing) throw findingNotFound(id);
  const acknowledge = patch.acknowledgeOccurrences === true;
  if (patch.status === undefined && patch.severity === undefined && !acknowledge) {
    throw invalid("Nothing to change. Send a status, a severity or acknowledgeOccurrences.");
  }

  const history = [...existing.history];
  let status = existing.status;
  let severity = existing.severity.current;
  let resolvedAssertion = existing.resolvedAssertion;
  let unreviewed = existing.unreviewedOccurrence;
  const trimmed = patch.note?.trim();
  const note = trimmed === undefined || trimmed === "" ? undefined : trimmed;

  if (patch.status !== undefined) {
    if (patch.status === existing.status) throw invalid(`The finding is already ${existing.status}.`);
    if (!note) throw invalid("A status change needs a note saying why.");
    if (existing.status !== "open" && patch.status !== "open") {
      throw invalid(`A finding marked ${existing.status} can only return to open before it is given another status.`);
    }
    history.push(entry(context, "status", existing.status, patch.status, context.actor, note));
    status = patch.status;
    if (status === "resolved") resolvedAssertion = "engineer-asserted";
    // Reopening ends the earlier decision, so occurrences that arrived under it no longer wait for review.
    if (status === "open") unreviewed = false;
  }

  if (patch.severity !== undefined) {
    if (patch.severity === existing.severity.current) throw invalid(`The severity is already ${existing.severity.current}.`);
    if (!note) throw invalid("A severity change needs a note saying why.");
    history.push(entry(context, "severity", existing.severity.current, patch.severity, context.actor, note));
    severity = patch.severity;
  }

  if (acknowledge) {
    if (!unreviewed) throw invalid("There is no unreviewed occurrence to acknowledge.");
    history.push(entry(context, "unreviewedOccurrence", "true", "false", context.actor, note ?? "Occurrences acknowledged."));
    unreviewed = false;
  }

  const updated: SecurityFinding = {
    ...existing,
    status,
    resolvedAssertion,
    unreviewedOccurrence: unreviewed,
    severity: { suggested: existing.severity.suggested, current: severity },
    history,
  };
  context.repo.save(updated);
  return updated;
}

export function requireFinding(context: FindingContext, id: string): SecurityFinding {
  const found = context.repo.get(context.ownerId, id);
  if (!found) throw findingNotFound(id);
  return found;
}
