/**
 * API Test Coverage Intelligence contracts (AP-046, specs/046-api-test-coverage-intelligence).
 *
 * Everything here is derived per request from the session's specification, scenarios and run
 * results; nothing is persisted. Two dimensions are always kept apart: *specification coverage*
 * (a qualifying generated scenario exists for a requirement) and *runtime-verified coverage*
 * (an actual execution produced sufficient evidence). Generation alone never counts as
 * verification.
 */

/** The kinds of contract element coverage is measured against. */
export type CoverageDimensionKind =
  | "operation"
  | "parameter"
  | "parameter-case"
  | "request-schema"
  | "response-code"
  | "response-schema";

/**
 * Exactly one per requirement (data-model.md "State precedence"). `stale` is part of the contract
 * for attributable evidence flagged for revalidation, but no rule in this feature produces it:
 * results that no longer join to a current scenario are reported as unattributed instead
 * (spec Clarifications 2026-10-10).
 */
export type CoverageState =
  | "not-covered"
  | "generated-not-executed"
  | "executed-failed"
  | "verified"
  | "inconclusive"
  | "stale";

export const COVERAGE_STATES: readonly CoverageState[] = [
  "not-covered",
  "generated-not-executed",
  "executed-failed",
  "verified",
  "inconclusive",
  "stale",
];

/** `security` is reported as unavailable: no scenario category identifies authorization intent. */
export type CoverageCategoryGroup = "positive" | "negative" | "boundary" | "security";

/**
 * The one category group a requirement belongs to. Response keys other than an exact `2xx` or
 * `4xx` (`default`, ranges, `3xx`, `5xx`) are `unclassified`: they stay in their own metric but in
 * no category denominator (coverage-rules.md section 4.3).
 */
export type CoverageRequirementGroup = "positive" | "negative" | "boundary" | "unclassified";

/**
 * Why a requirement is not simply verified. Shown beside the state so an assertion failure is never
 * confused with a transport problem, an unevaluated check or a request that was never run.
 */
export type CoverageCause =
  | "assertion-failed"
  | "transport-error"
  | "check-not-evaluated"
  | "no-relevant-check"
  | "request-edited"
  | "blocked-by-dependency"
  | "run-cancelled"
  | "not-reached"
  | "never-run"
  | "not-in-selected-run";

/** What one counted scenario established in the selected evidence (coverage-rules.md section 5.1). */
export type ScenarioVerdict = "passed" | "failed" | "inconclusive" | "not-executed";

export type CoveragePriority = "high" | "medium" | "low";

export type CoverageMetricDimension = "specification" | "runtime";

/**
 * Which of a scenario's checks decide runtime verification for a requirement: `any` (every
 * evaluated check must pass; used for scenario verdicts), `status` (the scenario's status-code
 * checks: the request was accepted as expected), `status-code` (the check expecting one code), or
 * `schema-conformance` (its schema check).
 */
export type CoverageCheckScope = "any" | "status" | "status-code" | "schema-conformance";

/** One measurable contract element. Elements that cannot be measured are listed separately. */
export interface CoverageRequirement {
  /** Stable, revision-independent id, e.g. `op:POST /orders`, `resp:GET /users/{id}:404`. */
  id: string;
  kind: CoverageDimensionKind;
  /** `"METHOD /path"`, matching `toOperationKey()`. */
  operationKey: string;
  label: string;
  /** SHA-256 of this element's normalized contract fragment. */
  contractHash: string;
  group: CoverageRequirementGroup;
  /** Specification location, JSON-pointer style (for example `#/paths/~1orders/post/responses/201`). */
  source?: string;
}

/** How one execution result bears on a requirement. Never carries headers, bodies or URLs. */
export interface CoverageEvidenceRef {
  runId: string;
  runKind: "uploaded" | "guided";
  scenarioId: string;
  itemId?: string;
  startedAt: string;
  outcome: "passed" | "failed";
  verdict: "verified" | "failed" | "inconclusive" | "stale";
  cause?: CoverageCause;
  note?: string;
}

export interface CoverageRequirementResult extends CoverageRequirement {
  state: CoverageState;
  /** Set for `executed-failed`, `inconclusive` and `generated-not-executed`. */
  cause?: CoverageCause;
  reason: string;
  /** Contributing scenario ids, deduplicated and sorted. */
  scenarioIds: string[];
  acceptedCount: number;
  pendingCount: number;
  /** What the mapped scenarios established: passed, failed, inconclusive and not executed. */
  tally: { passed: number; failed: number; inconclusive: number; notExecuted: number };
  /** Bounded, sorted. */
  evidence: CoverageEvidenceRef[];
  /** Stale only (reserved, never produced yet): what changed, since when, and that a re-run is required. */
  staleReason?: string;
  staleSince?: string;
  reExecutionRequired?: boolean;
}

/** One counted scenario and what the selected evidence says about it. Never carries request data. */
export interface CoverageScenarioResult {
  scenarioId: string;
  operationKey: string;
  group: Exclude<CoverageCategoryGroup, "security">;
  reviewState: "accepted" | "pending";
  verdict: ScenarioVerdict;
  cause?: CoverageCause;
  runId?: string;
  /** Assertions evaluated in the selected evidence; zero when edited, no response or not executed. */
  assertions: { passed: number; failed: number; notEvaluated: number };
}

/** A named figure with its numerator, denominator and basis (FR-007). */
export interface CoverageMetric {
  id: string;
  dimension: CoverageMetricDimension;
  kind: CoverageDimensionKind | "assertion";
  label: string;
  numerator: number;
  denominator: number;
  /** `null` when the denominator is 0: never NaN or Infinity. */
  percentage: number | null;
  available: boolean;
  /** What qualifies for the numerator and the denominator. */
  basis: string;
}

export interface CoveragePriorityFactor {
  factor: string;
  points: number;
  explanation: string;
}

/**
 * One underlying gap (FR-030). Requirements that share a cause are one gap: every unexecuted
 * requirement of an operation, every failing one, every one whose evidence is too weak, and, when
 * an operation has no scenario at all, everything about it. Remaining uncovered requirements are
 * grouped by kind.
 */
export interface CoverageGap {
  id: string;
  operationKey: string;
  /** `mixed` for gaps that gather requirements of several kinds sharing one cause (for example "not executed"). */
  kind: CoverageDimensionKind | "mixed";
  requirementIds: string[];
  /** The most severe state among its requirements. */
  state: CoverageState;
  /** Shared cause of the requirements in this gap, when they have one (never mixed across causes). */
  cause?: CoverageCause;
  reason: string;
  categoryGroups: Exclude<CoverageCategoryGroup, "security">[];
  priority: CoveragePriority;
  score: number;
  factors: CoveragePriorityFactor[];
  evidence: CoverageEvidenceRef[];
}

export interface CoverageRecommendation {
  rank: number;
  gapId: string;
  operationKey: string;
  /** Label of the first uncovered requirement, with a count when the gap holds several. */
  requirement: string;
  why: string;
  evidence: CoverageEvidenceRef[];
  priority: CoveragePriority;
  rationale: string;
  action: {
    type: "generate-scenario" | "review-scenario" | "open-result" | "re-run";
    scenarioIds: string[];
    runId?: string;
  };
}

export interface OperationCoverage {
  operationKey: string;
  method: string;
  path: string;
  specification: { covered: number; total: number };
  runtime: { verified: number; total: number };
  failedCount: number;
  /** Requirement states over every eligible requirement of the operation. There is no single status. */
  stateCounts: Record<CoverageState, number>;
  /** Scenario verdicts; they sum to `scenarioCount` and are never a coverage numerator. */
  scenarioVerdicts: { passed: number; failed: number; inconclusive: number; notExecuted: number };
  scenarioCount: number;
  /** Short labels of what is missing, unverified or failing. */
  missing: string[];
  priority: CoveragePriority;
  categoryGroups: Exclude<CoverageCategoryGroup, "security">[];
  assertions: { evaluated: number; passed: number; failed: number; notEvaluated: number };
  /** Requirements matching an active state or gap-type filter; absent when none is active. */
  matchingRequirements?: number;
  /** True when the specification itself declares a security requirement; never inferred. */
  securityDeclared: boolean;
}

/** A contract element or construct that cannot be reliably measured, excluded from denominators. */
export interface CoverageNotMeasurable {
  kind: CoverageDimensionKind | "construct";
  operationKey?: string;
  label: string;
  location?: string;
  reason: string;
}

export interface CoverageNotice {
  code:
    | "evidence"
    | "no-scenarios"
    | "not-executed"
    | "unattributed-results"
    | "edited-results"
    | "not-measurable"
    | "security-unavailable"
    | "response-detail-limited"
    | "infrastructure-error"
    | "excluded-runs";
  severity: "info" | "warning";
  message: string;
}

/**
 * Coverage of one category, counted in classified testable requirements (never scenarios). The
 * state counts partition `eligible`; `specCovered` is `eligible` minus the not-covered ones.
 */
export interface CoverageCategoryCoverage {
  group: CoverageCategoryGroup;
  available: boolean;
  eligible: number;
  specCovered: number;
  verified: number;
  counts: Record<CoverageState, number>;
  reason?: string;
}

/** Operation-level counts over eligible operations (coverage-rules.md section 3). */
export interface CoverageOperationCounts {
  eligible: number;
  withScenarios: number;
  /** At least one passed scenario. Not a completeness measure. */
  withPassingVerification: number;
  /** At least one failed scenario. Can overlap with `withPassingVerification`. */
  withFailures: number;
  withNoScenarios: number;
}

export interface CoverageSnapshot {
  specification: {
    name: string;
    version?: string;
    /** SHA-256 of the normalized contract; `info` is excluded so a version-string bump alone does not change it. */
    revision: string;
    operationCount: number;
  };
  context: {
    workflowId: string;
    selectedOperationCount: number;
    scenarioCounts: { total: number; accepted: number; pending: number; rejected: number; rule: number; ai: number };
  };
  execution: {
    sources: ("uploaded" | "guided")[];
    /** Ids of the runs that supplied the evidence behind the figures, newest first. */
    runIds: string[];
    /** Every run available to select, newest first, whether or not a result joined to a scenario. */
    availableRuns: { id: string; kind: "uploaded" | "guided"; startedAt: string; label: string }[];
    /** `latest-per-scenario` combines runs of one environment; `single-run` evaluates the selected run as is. */
    evidenceMode: "latest-per-scenario" | "single-run";
    /** How many scenarios take their evidence from each contributing run. */
    evidenceByRun: { runId: string; scenarios: number }[];
    /** Environments contributing to the evidence (one in latest-per-scenario mode). */
    environments: { name: string; tier: string }[];
    /** Runs left out of latest-per-scenario because they ran in a different environment. */
    excludedRuns: { runId: string; environment: { name: string; tier: string }; reason: string }[];
    selectedRunId?: string;
    lastQualifyingExecutionAt?: string;
    environment?: { name: string; tier: string };
    /** Results that join to no current scenario: never counted as verified. */
    unattributedResults: number;
    /** Results from requests edited before the run: shown as evidence but inconclusive. */
    editedResults: number;
  };
  metrics: CoverageMetric[];
  operationCounts: CoverageOperationCounts;
  /** Passed, failed and not-evaluated assertions in the selected evidence; not-evaluated is outside the assertion metric's denominator. */
  assertionOutcomes: { passed: number; failed: number; notEvaluated: number };
  operations: OperationCoverage[];
  scenarios: CoverageScenarioResult[];
  requirements: CoverageRequirementResult[];
  gaps: CoverageGap[];
  recommendations: CoverageRecommendation[];
  notMeasurable: CoverageNotMeasurable[];
  categoryCoverage: CoverageCategoryCoverage[];
  /** Requirements excluded from every category denominator (response keys no generator can provoke), and scenarios that cannot be placed. */
  unclassified: { requirements: { operationKey: string; label: string }[]; scenarios: number };
  /** Operations not selected for generation: listed, never counted as gaps. */
  outOfScopeOperations: string[];
  /** Scenario ids edited in review after their evidence was produced. Informational only. */
  scenarioEditedAfterRun: string[];
  notices: CoverageNotice[];
  /** Unfiltered totals, so the view can show "X of Y". */
  totals: { operations: number; gaps: number };
  /** The only clock-dependent field; excluded from determinism comparisons. */
  calculatedAt: string;
}

export type CoverageSortKey = "priority" | "method" | "path" | "specification" | "runtime";

export interface CoverageFilter {
  methods?: string[];
  /** Case-insensitive substring of the path. */
  q?: string;
  states?: CoverageState[];
  category?: Exclude<CoverageCategoryGroup, "security">;
  priorities?: CoveragePriority[];
  /** missing: not covered or not executed; failed: executed failed; insufficient: inconclusive; stale: needs re-execution. */
  gapKind?: "missing" | "failed" | "insufficient" | "stale";
  sort?: CoverageSortKey;
  order?: "asc" | "desc";
}

export const COVERAGE_GAP_KINDS = ["missing", "failed", "insufficient", "stale"] as const;
export const COVERAGE_PRIORITIES: readonly CoveragePriority[] = ["high", "medium", "low"];
export const COVERAGE_SORT_KEYS: readonly CoverageSortKey[] = ["priority", "method", "path", "specification", "runtime"];

/** Rounds to one decimal; `null` for a zero denominator so callers never see NaN or Infinity. */
export function coveragePercentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
