import type {
  ExecutionStatus,
  FindingStatus,
  ObservationClass,
  ScenarioOutcomeKind,
  SecurityReviewState,
  Severity,
  SupportLevel,
} from "@apipilot/shared-domain";
import type { StatusTone } from "../StatusBadge";

/**
 * Typed visual variants for Security Lab (specs/057 FR-066, CLAUDE.md section 43): the business meaning of a
 * severity, state or outcome is decided here, once, and the components render a `{ label, tone }`. The label is
 * always shown as text, so no meaning is carried by colour alone. Labels are unique within each set.
 */

export interface Variant {
  readonly label: string;
  readonly tone: StatusTone;
}

const SEVERITY: Readonly<Record<Severity, Variant>> = {
  info: { label: "Info", tone: "neutral" },
  low: { label: "Low", tone: "info" },
  medium: { label: "Medium", tone: "warning" },
  high: { label: "High", tone: "danger" },
  critical: { label: "Critical", tone: "danger" },
};

const REVIEW_STATE: Readonly<Record<SecurityReviewState, Variant>> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

const EXECUTION_STATUS: Readonly<Record<ExecutionStatus, Variant>> = {
  not_run: { label: "Not run", tone: "neutral" },
  executed: { label: "Executed", tone: "info" },
  evaluated: { label: "Evaluated", tone: "success" },
};

const OUTCOME: Readonly<Record<ScenarioOutcomeKind, Variant>> = {
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  inconclusive: { label: "Inconclusive", tone: "warning" },
  blocked: { label: "Blocked", tone: "warning" },
  errored: { label: "Errored", tone: "danger" },
  not_run: { label: "Not run", tone: "neutral" },
};

const CLASSIFICATION: Readonly<Record<ObservationClass, Variant>> = {
  informational: { label: "Informational observation", tone: "info" },
  "potential-risk": { label: "Potential risk", tone: "warning" },
  "requires-context": { label: "Requires additional context", tone: "neutral" },
  "not-measurable": { label: "Not measurable", tone: "neutral" },
};

const SUPPORT_LEVEL: Readonly<Record<SupportLevel, Variant>> = {
  supported: { label: "Supported", tone: "success" },
  limited: { label: "Limited", tone: "warning" },
  "analysis-only": { label: "Analysis only", tone: "info" },
};

const FINDING_STATUS: Readonly<Record<FindingStatus, Variant>> = {
  open: { label: "Open", tone: "danger" },
  "accepted-risk": { label: "Accepted risk", tone: "neutral" },
  "false-positive": { label: "False positive", tone: "neutral" },
  resolved: { label: "Resolved", tone: "success" },
};

export const severityVariant = (value: Severity): Variant => SEVERITY[value];
export const reviewStateVariant = (value: SecurityReviewState): Variant => REVIEW_STATE[value];
export const executionStatusVariant = (value: ExecutionStatus): Variant => EXECUTION_STATUS[value];
export const outcomeVariant = (value: ScenarioOutcomeKind): Variant => OUTCOME[value];
export const classificationVariant = (value: ObservationClass): Variant => CLASSIFICATION[value];
export const supportLevelVariant = (value: SupportLevel): Variant => SUPPORT_LEVEL[value];
export const findingStatusVariant = (value: FindingStatus): Variant => FINDING_STATUS[value];

/** The order severities are listed in, most severe first. */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export const ALL_VARIANT_SETS = {
  severity: SEVERITY,
  reviewState: REVIEW_STATE,
  executionStatus: EXECUTION_STATUS,
  outcome: OUTCOME,
  classification: CLASSIFICATION,
  supportLevel: SUPPORT_LEVEL,
  findingStatus: FINDING_STATUS,
} as const;
