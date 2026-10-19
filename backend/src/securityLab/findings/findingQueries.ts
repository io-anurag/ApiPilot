import type { FindingEvidenceReply, FindingListReply, FindingStatus, SecurityFinding, Severity } from "@apipilot/shared-domain";
import { FINDING_STATUSES, SEVERITIES } from "@apipilot/shared-domain";
import type { SecurityEvidenceRepository } from "../../persistence/securityEvidenceRepository";
import type { FindingQuery } from "../../persistence/securityFindingRepository";
import { SecurityLabError, invalidRequest } from "../errors";
import { requireFinding, type FindingContext } from "./findingService";

/**
 * Reading findings (specs/057 contracts/security-lab-api.md "Findings", FR-054 to FR-059). A finding is retained work
 * and always readable; the redacted evidence behind each occurrence is session data, so every occurrence says whether
 * its raw evidence is still available, derived from what exists now and never stored.
 */

const MAX_PAGE_SIZE = 100;

export interface FindingListQuery extends FindingQuery {
  page: number;
  pageSize: number;
}

export function parseFindingQuery(raw: Record<string, unknown>): FindingListQuery {
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
  const query: FindingListQuery = { page: 1, pageSize: 25 };
  const severity = text(raw.severity);
  if (severity) {
    if (!(SEVERITIES as readonly string[]).includes(severity)) throw invalidRequest(`'severity' must be one of ${SEVERITIES.join(", ")}.`);
    query.severity = severity as Severity;
  }
  const status = text(raw.status);
  if (status) {
    if (!(FINDING_STATUSES as readonly string[]).includes(status)) throw invalidRequest(`'status' must be one of ${FINDING_STATUSES.join(", ")}.`);
    query.status = status as FindingStatus;
  }
  const unreviewed = text(raw.unreviewed);
  if (unreviewed) {
    if (unreviewed !== "true" && unreviewed !== "false") throw invalidRequest("'unreviewed' must be true or false.");
    query.unreviewed = unreviewed === "true";
  }
  query.categoryId = text(raw.category);
  query.operationKey = text(raw.operation);
  query.scenarioId = text(raw.scenario);
  query.assessmentKey = text(raw.assessment);
  const page = text(raw.page);
  if (page !== undefined) {
    if (!/^\d+$/.test(page) || Number(page) < 1) throw invalidRequest("'page' must be a positive integer.");
    query.page = Number(page);
  }
  const pageSize = text(raw.pageSize);
  if (pageSize !== undefined) {
    if (!/^\d+$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) throw invalidRequest(`'pageSize' must be between 1 and ${MAX_PAGE_SIZE}.`);
    query.pageSize = Number(pageSize);
  }
  return query;
}

export interface FindingReadContext extends FindingContext {
  readonly sessionId: string;
  readonly evidence: SecurityEvidenceRepository;
}

/** The finding with `evidenceAvailable` set on each occurrence, from the evidence this session still holds. */
function withAvailability(context: FindingReadContext, finding: SecurityFinding): SecurityFinding {
  const available = context.evidence.availableResultIds(context.sessionId, finding.occurrences.map((occurrence) => occurrence.resultId));
  return { ...finding, occurrences: finding.occurrences.map((occurrence) => ({ ...occurrence, evidenceAvailable: available.has(occurrence.resultId) })) };
}

export function readFinding(context: FindingReadContext, id: string): SecurityFinding {
  return withAvailability(context, requireFinding(context, id));
}

export function presentFinding(context: FindingReadContext, finding: SecurityFinding): SecurityFinding {
  return withAvailability(context, finding);
}

export function listFindings(context: FindingReadContext, query: FindingListQuery): FindingListReply {
  const { page, pageSize, ...filter } = query;
  const pageOfItems = context.repo.query(context.ownerId, filter, { page, pageSize });
  const all = context.repo.listAll(context.ownerId, filter);
  const tally = (values: readonly string[]) => values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
  return {
    items: pageOfItems.items.map((finding) => withAvailability(context, finding)),
    total: pageOfItems.total,
    page,
    pageSize,
    counts: {
      byStatus: tally(all.map((finding) => finding.status)),
      bySeverity: tally(all.map((finding) => finding.severity.current)),
      occurrences: all.reduce((sum, finding) => sum + finding.occurrenceCount, 0),
      withUnreviewedOccurrence: all.filter((finding) => finding.unreviewedOccurrence).length,
    },
  };
}

/** The redacted evidence behind one occurrence, or `available: false` once the session that held it has gone. */
export function readOccurrenceEvidence(context: FindingReadContext, id: string, resultId: string): FindingEvidenceReply {
  const finding = requireFinding(context, id);
  if (!finding.occurrences.some((occurrence) => occurrence.resultId === resultId)) {
    throw new SecurityLabError("finding_not_found", `The finding has no occurrence for result '${resultId}'.`);
  }
  const records = context.evidence.list(context.sessionId, resultId);
  return { available: records.length > 0, records };
}

