import type { ConfidenceLevel, EvidenceErrorCategory, EvidenceRecord, FindingStatus, SecurityFinding, Severity } from "@apipilot/shared-domain";
import type { FindingFilterQuery, FindingPatchBody } from "../../services/securityLabClient";

/**
 * Pure view logic for findings (specs/057 FR-054 to FR-059, contracts/evaluation-and-findings-rules.md "Finding
 * lifecycle and occurrences"): how a finding is named, how occurrences are counted beside it, which status changes the
 * server accepts, what a change needs, and how a redacted evidence record reads as text. The status rule mirrors
 * `updateFinding` in `backend/src/securityLab/findings/findingService.ts`, and the server still enforces it.
 */

export const CONFIDENCE_LABEL: Readonly<Record<ConfidenceLevel, string>> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const STATUS_EXPLANATION: Readonly<Record<FindingStatus, string>> = {
  open: "Needs attention: a request sent to the target did not behave as expected.",
  "accepted-risk": "You decided to accept this risk. A new occurrence is flagged for your review, never hidden.",
  "false-positive": "You decided this is not a real issue. A new occurrence is flagged for your review, never hidden.",
  resolved: "You marked this resolved. A new occurrence reopens it.",
};

/** A finding has no title of its own: it is named by the operation it is about and its category. */
export const findingTitle = (finding: SecurityFinding, categoryName?: string): string => `${finding.operationKey}: ${categoryName ?? finding.categoryId}`;

/** Occurrences are counted beside findings and never added to them. */
export const occurrenceText = (count: number): string => `${count} ${count === 1 ? "occurrence" : "occurrences"}`;

/** The statuses the server accepts as the next one: an open finding can be given any decision, and any other status can only return to open. */
export function statusTargets(status: FindingStatus): FindingStatus[] {
  return status === "open" ? ["accepted-risk", "false-positive", "resolved"] : ["open"];
}

export interface FindingChangeInput {
  readonly finding: SecurityFinding;
  readonly status: FindingStatus | "";
  readonly severity: Severity | "";
  readonly note: string;
}

export interface FindingChange {
  /** The request body, when the change can be sent. */
  readonly body?: FindingPatchBody;
  /** What is still needed, in words. */
  readonly reasons: string[];
}

/** What a change to a finding needs: something to change, and a note saying why for a status or severity change. */
export function checkFindingChange({ finding, status, severity, note }: FindingChangeInput): FindingChange {
  const statusChange = status !== "" && status !== finding.status ? status : undefined;
  const severityChange = severity !== "" && severity !== finding.severity.current ? severity : undefined;
  const trimmed = note.trim();
  const reasons: string[] = [];
  if (!statusChange && !severityChange) reasons.push("Choose a new status or a new severity.");
  else if (trimmed === "") reasons.push("Write a note saying why: a status or severity change needs one, and it is kept in the history.");
  if (reasons.length > 0) return { reasons };
  return { reasons, body: { ...(statusChange ? { status: statusChange } : {}), ...(severityChange ? { severity: severityChange } : {}), note: trimmed } };
}

/** Whether a resolved finding is only the engineer's word or has been confirmed by a later passing run. */
export function resolvedAssertionText(finding: SecurityFinding): string | undefined {
  if (finding.status !== "resolved") return undefined;
  return finding.resolvedAssertion === "verified-by-rerun"
    ? "Verified: a later run of this scenario version passed."
    : "Marked resolved by you. It has not been verified: no later run of this scenario version has passed yet.";
}

export const EMPTY_FINDING_FILTERS: FindingFilterQuery = {};

export function activeFindingFilterCount(filters: FindingFilterQuery): number {
  return Object.values(filters).filter((value) => value !== undefined && value !== "").length;
}

/** A filter object with `field` set, or removed when `value` is empty, so an unset filter is never sent. */
export function withFindingFilter<K extends keyof FindingFilterQuery>(filters: FindingFilterQuery, field: K, value: FindingFilterQuery[K] | ""): FindingFilterQuery {
  const next: FindingFilterQuery = { ...filters };
  if (value === "" || value === undefined) delete next[field];
  else next[field] = value as FindingFilterQuery[K];
  return next;
}

export const EVIDENCE_ERROR_LABEL: Readonly<Record<EvidenceErrorCategory, string>> = {
  timeout: "The request timed out.",
  connect: "The connection could not be made.",
  tls: "The TLS handshake failed.",
  aborted: "The request was cancelled.",
  blocked: "The request was blocked before it was sent.",
  "read-limit": "The response was larger than the read limit and was cut off.",
};

const headerLines = (headers: Readonly<Record<string, string>>): string[] => Object.entries(headers).map(([name, value]) => `${name}: ${value}`);

/**
 * One redacted evidence record as plain text for a code block. Values were redacted before they were stored; this only
 * lays them out. A truncated body says so.
 */
export function evidenceRecordText(record: EvidenceRecord): string {
  const lines: string[] = [`${record.method} ${record.urlRedacted}`, ...headerLines(record.requestHeadersRedacted)];
  if (record.requestBodyExcerpt !== undefined) lines.push("", record.requestBodyExcerpt);
  lines.push("", `Destination: ${record.destination.host}:${record.destination.port} (${record.destination.addressClass}, ${record.destination.verdict}${record.destination.reason ? `: ${record.destination.reason}` : ""})`);
  for (const redirect of record.redirects) lines.push(`Redirect ${redirect.verdict}: ${redirect.toRedacted}${redirect.reason ? ` (${redirect.reason})` : ""}`);
  if (record.error) lines.push(`Error: ${EVIDENCE_ERROR_LABEL[record.error.category]}`);
  if (record.responseStatus !== undefined) lines.push("", `Response ${record.responseStatus} after ${record.durationMs} ms`, ...headerLines(record.responseHeadersSelected));
  if (record.responseBodyExcerpt !== undefined) lines.push("", record.responseBodyExcerpt);
  if (record.truncated) lines.push("", "(The response was truncated.)");
  return lines.join("\n");
}
