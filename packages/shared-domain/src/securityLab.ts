import type { FactOrigin } from "./apiInput";
import type { GeneratedRequest } from "./testModel";

/**
 * Security Lab contracts (specs/057-security-lab-v1, data-model.md). Framework-agnostic: no Express,
 * React, browser or Node dependency. Every id is a string and every time an ISO 8601 string supplied by
 * an injected clock, so deterministic code never reads the system clock.
 */

// ---------------------------------------------------------------------------------------------
// Registry and taxonomy (data-model.md §2)
// ---------------------------------------------------------------------------------------------

/** Where an operation's effective `security` came from (research R2). Unset for HAR and definition input. */
export type SecuritySource = "operation" | "root" | "explicit-public" | "none-declared";

export const SUPPORT_LEVELS = ["supported", "limited", "analysis-only"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const TAXONOMY_EDITION = "owasp-api-top10-2023" as const;
export type TaxonomyEdition = typeof TAXONOMY_EDITION;

export const TAXONOMY_IDS = ["API1", "API2", "API3", "API4", "API5", "API6", "API7", "API8", "API9", "API10"] as const;
export type TaxonomyId = (typeof TAXONOMY_IDS)[number];

export interface TaxonomyMapping {
  edition: TaxonomyEdition;
  id: TaxonomyId;
  /** `related` is ApiPilot's judgement, not an OWASP statement (research R19). */
  relation: "primary" | "related";
}

export const SECURITY_CATEGORY_IDS = [
  "authentication",
  "authorization",
  "broken-object-level-authorization",
  "object-property-authorization",
  "input-validation",
  "resource-consumption",
  "sensitive-data-exposure",
  "security-misconfiguration",
  "sensitive-business-flows",
  "ssrf-unsafe-consumption",
  "api-inventory",
] as const;
export type SecurityCategoryId = (typeof SECURITY_CATEGORY_IDS)[number];

/** The categories a scenario can be generated for (SSRF and inventory generate none in V1). */
export const GENERATABLE_CATEGORY_IDS = [
  "authentication",
  "authorization",
  "broken-object-level-authorization",
  "object-property-authorization",
  "input-validation",
  "resource-consumption",
  "sensitive-data-exposure",
  "security-misconfiguration",
  "sensitive-business-flows",
] as const;
export type GeneratableCategoryId = (typeof GENERATABLE_CATEGORY_IDS)[number];

export const PREREQUISITE_KINDS = [
  "identity",
  "role",
  "test-data",
  "ownership",
  "threshold",
  "expired-credential",
  "persisted-read",
] as const;
export type PrerequisiteKind = (typeof PREREQUISITE_KINDS)[number];

export interface SecurityCategory {
  id: SecurityCategoryId;
  name: string;
  supportLevel: SupportLevel;
  /** Whether a scenario of this category can be sent to a target in V1. */
  executable: boolean;
  /** Whether the generator emits scenarios for it. */
  generatable: boolean;
  prerequisites: PrerequisiteKind[];
  taxonomy: TaxonomyMapping[];
  limitationNote?: string;
  description: string;
}

// ---------------------------------------------------------------------------------------------
// Analysis (data-model.md §3)
// ---------------------------------------------------------------------------------------------

export const OBSERVATION_CLASSES = ["informational", "potential-risk", "requires-context", "not-measurable"] as const;
export type ObservationClass = (typeof OBSERVATION_CLASSES)[number];

export type SensitivityBasis = "format-password" | "write-only" | "user-configured" | "name-match";

export interface SecurityObservation {
  id: string;
  ruleId: string;
  classification: ObservationClass;
  /** `"METHOD /path"`, absent for a specification-wide observation. */
  operationKey?: string;
  /** A JSON-Pointer-like path into the model, for example `/operations/GET /orders/security`. */
  elementPointer: string;
  rationale: string;
  basis?: SensitivityBasis | "method" | "path-token" | "identifier-parameter";
  /** The origin label of the model fact the observation rests on (FR-011). Absent means documented. */
  origin: FactOrigin;
  categoryId?: SecurityCategoryId;
}

export interface EffectiveSecurity {
  operationKey: string;
  requirement: { schemes: { name: string; scopes: string[] }[] }[];
  source: SecuritySource | "unknown";
  /** True when the root declared `security: []` and no operation overrode it. */
  rootExplicitlyEmpty: boolean;
}

export interface SecurityAnalysis {
  specificationRevision: string;
  effective: EffectiveSecurity[];
  observations: SecurityObservation[];
  counts: Record<ObservationClass, number>;
  /** Named inputs that were absent, which is why a question is "not measurable". */
  unmeasurable: string[];
}

// ---------------------------------------------------------------------------------------------
// Scenarios (data-model.md §4)
// ---------------------------------------------------------------------------------------------

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SECURITY_REVIEW_STATES = ["draft", "in_review", "approved", "rejected"] as const;
export type SecurityReviewState = (typeof SECURITY_REVIEW_STATES)[number];

export const EXECUTION_STATUSES = ["not_run", "executed", "evaluated"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const SCENARIO_ORIGINS = ["rule", "ai", "user"] as const;
export type ScenarioOrigin = (typeof SCENARIO_ORIGINS)[number];

export interface Prerequisite {
  id: string;
  kind: PrerequisiteKind;
  description: string;
  /** Derived at read time from the selected profile, never stored. */
  state?: "met" | "missing" | "unsupported";
  detail?: string;
}

export const INJECTION_PROBE_IDS = [
  "sql-quote",
  "sql-comment",
  "xss-angle",
  "path-traversal-dots",
  "template-braces",
  "null-byte",
] as const;
export type InjectionProbeId = (typeof INJECTION_PROBE_IDS)[number];

export const LEAK_PATTERN_IDS = ["stack-trace", "server-banner", "internal-path", "secret-shaped-value", "sql-error"] as const;
export type LeakPatternId = (typeof LEAK_PATTERN_IDS)[number];

export const CONSTRAINT_KINDS = [
  "type",
  "format",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "required",
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export const PROBE_METHODS = ["HEAD", "OPTIONS", "TRACE"] as const;
export type ProbeMethod = (typeof PROBE_METHODS)[number];

/** The closed set of controlled mutations (research R6). No member carries a URL, host or free-form value. */
export type SecurityMutation =
  | { kind: "auth.omit" }
  | { kind: "auth.invalid-token" }
  | { kind: "auth.malformed" }
  | { kind: "auth.expired"; identity: string }
  | { kind: "identity.swap"; from: string; to: string }
  | { kind: "path-id.substitute"; parameter: string; ownerIdentity: string }
  | { kind: "body.add-property"; path: string; name: string; valueKind: "string" | "number" | "boolean" | "protected-example" }
  | { kind: "field.violate-constraint"; path: string; constraint: ConstraintKind }
  | { kind: "method.probe"; method: ProbeMethod }
  | { kind: "request.repeat"; count: number }
  | { kind: "input.injection-probe"; path: string; probeId: InjectionProbeId };

export type SecurityMutationKind = SecurityMutation["kind"];

/** The closed set of evaluation conditions (research R6). No expression, regex or function. */
export type EvaluationCondition =
  | { kind: "status.not-success" }
  | { kind: "status.in-set"; codes: number[] }
  | { kind: "status.equals"; code: number }
  | { kind: "status.not-equals"; code: number }
  | { kind: "header.present"; name: string }
  | { kind: "header.absent"; name: string }
  | { kind: "header.value-not-contains"; name: string; token: string }
  | { kind: "body.field-absent"; path: string }
  | { kind: "body.field-present"; path: string }
  | { kind: "body.not-match-leak-pattern"; patternId: LeakPatternId }
  | { kind: "repeat.limit-engaged"; withinRequests: number }
  | { kind: "persisted.field-unchanged"; path: string };

export type EvaluationConditionKind = EvaluationCondition["kind"];

export const EXPECTED_BEHAVIOR_KINDS = ["rejected", "allowed", "limited", "no-leak", "header-policy", "persisted-unchanged"] as const;
export type ExpectedBehaviorKind = (typeof EXPECTED_BEHAVIOR_KINDS)[number];

export interface ExpectedBehavior {
  kind: ExpectedBehaviorKind;
  statement: string;
  /** `documented` only when the specification documents the response; otherwise a named product rule. */
  basis: "documented" | "product-rule";
  ruleId?: string;
  documentedStatusCodes?: number[];
  /** A specification element pointer, when `basis` is `documented`. */
  citation?: string;
}

export interface SecurityScenarioContent {
  operationKey: string;
  operationMethod: string;
  operationPath: string;
  categoryId: GeneratableCategoryId;
  taxonomy: TaxonomyMapping[];
  title: string;
  objective: string;
  rationale: string;
  prerequisites: Prerequisite[];
  requiredIdentities: { role: string; label: string }[];
  baseRequest: GeneratedRequest;
  mutations: SecurityMutation[];
  expected: ExpectedBehavior;
  conditions: EvaluationCondition[];
  impact: string;
  suggestedSeverity: Severity;
  destructive: { flag: boolean; reasons: string[] };
  plannedRequestCount: number;
  limitations: string[];
  manualInputs: string[];
  provenance: {
    operationKey: string;
    specElementPointer: string;
    observationId?: string;
    ruleId?: string;
    aiModel?: string;
    aiConfidence?: number;
    aiAssumptions?: string[];
    /** Other rules that produced an equivalent scenario, kept when duplicates are merged (FR-024). */
    duplicateOfRules?: string[];
  };
  /** Present when the model came from HAR input (constitution XIII). */
  evidenceOrigin?: FactOrigin;
  observationCount?: number;
}

export interface ApprovalRecord {
  version: number;
  contentHash: string;
  approvedAt: string;
  actor: string;
  destructiveConfirmed: boolean;
  /** Set when the approval was withdrawn or the scenario rejected. The record stays, so history shows what was approved when. */
  withdrawnAt?: string;
  /** Set when a non-material edit created this version and the approval of the earlier one was carried over (its hash is unchanged). */
  carriedFromVersion?: number;
}

export interface SecurityScenarioVersion {
  scenarioId: string;
  version: number;
  contentHash: string;
  specificationRevision: string;
  securityBasisHash: string;
  content: SecurityScenarioContent;
  author: "generator" | "ai" | "user";
  createdAt: string;
  editNote?: string;
  materialChange: boolean;
  approval?: ApprovalRecord;
  rejection?: { reason: string; at: string };
}

export interface SecurityScenario {
  id: string;
  ownerId: string;
  assessmentKey: string;
  /** `"<title> · <filename>"` (research R22). */
  assessmentLabel: string;
  currentVersion: number;
  reviewState: SecurityReviewState;
  executionStatus: ExecutionStatus;
  origin: ScenarioOrigin;
  createdAt: string;
}

/** Flags derived at read time from the current model; never stored. */
export interface ScenarioDerivedFlags {
  specificationNotLoaded: boolean;
  stale: boolean;
  orphaned: boolean;
  blocked: boolean;
  executable: boolean;
}

export type GenerationScopeMode = "selection" | "all" | "custom";

export interface GenerationScope {
  mode: GenerationScopeMode;
  operationKeys?: string[];
}

export interface AppliedGenerationScope {
  mode: GenerationScopeMode;
  included: number;
  excluded: number;
}

// ---------------------------------------------------------------------------------------------
// Profiles (data-model.md §5)
// ---------------------------------------------------------------------------------------------

export type TlsPolicy = "verify" | "relaxed-local";

export interface TestIdentity {
  name: string;
  role: string;
  /**
   * The security schemes this identity has a credential for. No secret value is a member: the values live in a
   * write-only, session-scoped store that no route returns (specs/057 research R8).
   */
  credentialSchemes: string[];
  /** The schemes this identity has a known-expired credential for, used by `auth.expired` scenarios. */
  expiredCredentialSchemes?: string[];
}

/** Whether a credential is set, never its value. */
export interface CredentialStatus {
  identity: string;
  scheme: string;
  kind: "active" | "expired";
  set: boolean;
}

export interface TestDataEntry {
  ownerIdentity: string;
  operationKey?: string;
  parameter: string;
  /** A non-secret identifier such as a resource id. A credential-shaped value is refused. */
  value: string;
}

export type CleanupStrategy = { strategy: "none" } | { strategy: "delete-created-via-spec"; idField: string };

export interface SecurityProfile {
  id: string;
  name: string;
  environmentId: string;
  allowedHosts: string[];
  allowedPorts: number[];
  /** Local tier only. Addresses or CIDR ranges the profile explicitly allows. */
  allowedAddressRanges: string[];
  tlsPolicy: TlsPolicy;
  identities: TestIdentity[];
  testData: TestDataEntry[];
  timeoutMs: number;
  maxRequests: number;
  maxConcurrency: number;
  permittedCategories: string[];
  destructivePermitted: boolean;
  cleanup: CleanupStrategy;
  createdAt: string;
  updatedAt: string;
}

export type SecurityProfileInput = Omit<SecurityProfile, "id" | "createdAt" | "updatedAt">;

/** Kept on a run: no identities, test data, host allow-lists or credentials. */
export interface ProfileSummary {
  /** Ties an in-progress run to its profile, so that profile cannot be edited or deleted mid-run. Not a secret; meaningless once the session ends. */
  profileId: string;
  profileName: string;
  environmentName: string;
  tier: string;
  baseUrl: string;
  tlsPolicy: TlsPolicy;
  permittedCategories: string[];
  limits: { maxRequests: number; maxConcurrency: number; timeoutMs: number };
  destructivePermitted: boolean;
}

// ---------------------------------------------------------------------------------------------
// Runs, evidence, outcomes (data-model.md §6)
// ---------------------------------------------------------------------------------------------

export const SCENARIO_OUTCOME_KINDS = ["passed", "failed", "inconclusive", "blocked", "errored", "not_run"] as const;
export type ScenarioOutcomeKind = (typeof SCENARIO_OUTCOME_KINDS)[number];

export type SecurityRunStatus = "in-progress" | "completed" | "cancelled" | "failed";

export interface PlannedItem {
  scenarioId: string;
  version: number;
  plannedRequests: number;
}

export interface RunLimits {
  maxRequests: number;
  maxConcurrency: number;
  timeoutMs: number;
}

export interface RunConfirmation {
  targetName: string;
  targetBaseUrl: string;
  authorizationAttested: boolean;
  destructiveScenarioIds: string[];
}

export interface CleanupResult {
  scenarioId?: string;
  action: string;
  state: "done" | "failed" | "skipped";
  detail: string;
  leftBehind?: string;
  manualRemoval?: string;
}

export interface SecurityRun {
  id: string;
  ownerId: string;
  /** The starting session, used for the execution slot. */
  sessionId: string;
  status: SecurityRunStatus;
  cancelRequested: boolean;
  cancelReason?: "user-requested" | "backend-restart";
  startedAt: string;
  completedAt?: string;
  profileSummary: ProfileSummary;
  plan: PlannedItem[];
  planDigest: string;
  limits: RunLimits;
  budget: { planned: number; used: number };
  confirmation: RunConfirmation;
  summary: Record<ScenarioOutcomeKind, number>;
  cleanup: CleanupResult[];
  assessmentKey: string;
}

export type AddressClass =
  | "loopback"
  | "private"
  | "cgnat"
  | "link-local"
  | "unique-local"
  | "multicast"
  | "unspecified"
  | "public";

export type EvidenceErrorCategory = "timeout" | "connect" | "tls" | "aborted" | "blocked" | "read-limit";

/** Redacted at construction. Session data: removed with the session (FR-051). */
export interface EvidenceRecord {
  index: number;
  sentAt: string;
  durationMs: number;
  method: string;
  urlRedacted: string;
  requestHeadersRedacted: Record<string, string>;
  requestBodyExcerpt?: string;
  destination: { host: string; port: number; addressClass: AddressClass; verdict: "allowed" | "blocked"; reason?: string };
  redirects: { toRedacted: string; verdict: "followed" | "blocked"; reason?: string }[];
  responseStatus?: number;
  responseHeadersSelected: Record<string, string>;
  responseBodyExcerpt?: string;
  truncated: boolean;
  error?: { category: EvidenceErrorCategory };
}

/** Deterministic, bounded and retained. Never contains a body excerpt. */
export interface ObservedSummary {
  responseStatus?: number;
  responseHeadersSelected: Record<string, string>;
  statement: string;
  truncated: boolean;
}

export interface ConditionResult {
  condition: EvaluationCondition;
  state: "satisfied" | "violated" | "indeterminate";
}

export interface ScenarioResult {
  id: string;
  runId: string;
  scenarioId: string;
  version: number;
  outcome: ScenarioOutcomeKind;
  reason: string;
  conditionResults: ConditionResult[];
  observed: ObservedSummary;
  evidenceCount: number;
  startedAt: string;
  durationMs: number;
  /** Derived from the presence of session evidence rows; never stored. */
  evidenceAvailable?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Findings (data-model.md §7)
// ---------------------------------------------------------------------------------------------

export const FINDING_STATUSES = ["open", "accepted-risk", "false-positive", "resolved"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type ConfidenceLevel = "high" | "medium" | "low";

export interface FindingOccurrence {
  resultId: string;
  runId: string;
  at: string;
  observed: ObservedSummary;
  confidence: { level: ConfidenceLevel; basis: string };
  /** Derived from the presence of session evidence rows; never stored. */
  evidenceAvailable?: boolean;
}

export interface FindingHistoryEntry {
  at: string;
  field: string;
  from: string;
  to: string;
  note?: string;
  actor: string;
}

export interface SecurityFinding {
  id: string;
  ownerId: string;
  assessmentKey: string;
  scenarioId: string;
  scenarioVersion: number;
  /** The finding for an earlier version of the same scenario (research R24). */
  supersedes?: string;
  operationKey: string;
  specElementPointer: string;
  categoryId: GeneratableCategoryId;
  taxonomy: TaxonomyMapping[];
  expected: ExpectedBehavior;
  severity: { suggested: Severity; current: Severity };
  /** Of the latest occurrence. */
  confidence: { level: ConfidenceLevel; basis: string };
  remediationId: string;
  remediation: string;
  status: FindingStatus;
  resolvedAssertion: "engineer-asserted" | "verified-by-rerun";
  occurrences: FindingOccurrence[];
  occurrenceCount: number;
  firstFailedAt: string;
  latestFailedAt: string;
  unreviewedOccurrence: boolean;
  history: FindingHistoryEntry[];
}

// ---------------------------------------------------------------------------------------------
// Overview, report, retained data (data-model.md §8, §11)
// ---------------------------------------------------------------------------------------------

export interface SecurityOverview {
  specificationLoaded: boolean;
  specificationRevision?: string;
  observationCounts: Record<ObservationClass, number>;
  scenarioCounts: {
    total: number;
    byCategory: Record<string, number>;
    byReviewState: Record<SecurityReviewState, number>;
    stale: number;
    orphaned: number;
    blocked: number;
    specificationNotLoaded: number;
  };
  scope?: AppliedGenerationScope;
  latestRun?: { id: string; startedAt: string; status: SecurityRunStatus; summary: Record<ScenarioOutcomeKind, number> };
  findingCounts: {
    total: number;
    bySeverity: Record<Severity, number>;
    byStatus: Record<FindingStatus, number>;
    occurrences: number;
    withUnreviewedOccurrence: number;
  };
  untestedHighPriority: { operationKey: string; basis: string }[];
}

export interface SecurityReport {
  generatedAt: string;
  assessmentLabel?: string;
  specificationRevision?: string;
  taxonomyEdition: TaxonomyEdition;
  overview: SecurityOverview;
  categoryCoverage: {
    categoryId: SecurityCategoryId;
    name: string;
    supportLevel: SupportLevel;
    scenarios: number;
    outcomes: Record<ScenarioOutcomeKind, number>;
  }[];
  findings: SecurityFinding[];
  runs: { id: string; startedAt: string; status: SecurityRunStatus; profileName: string; tier: string; baseUrl: string }[];
  notCovered: { categoryId: SecurityCategoryId; reason: string }[];
  limitsStatement: string;
}

export interface RetainedAssessmentSummary {
  assessmentKey: string;
  assessmentLabel: string;
  scenarios: number;
  runs: number;
  findings: number;
}

export interface RetainedDataSummary {
  assessments: RetainedAssessmentSummary[];
  totals: { scenarios: number; runs: number; findings: number };
  caps: { maxScenarios: number; maxRuns: number };
  removedWithSession: string[];
  retained: string[];
}

// ---------------------------------------------------------------------------------------------
// Scenario API replies (specs/057 contracts/security-lab-api.md "Scenarios")
// ---------------------------------------------------------------------------------------------

export const SECURITY_REVIEW_ACTIONS = ["submit", "approve", "reject", "reopen", "withdraw"] as const;
export type SecurityReviewAction = (typeof SECURITY_REVIEW_ACTIONS)[number];

export type ReviewRefusalCode =
  | "scenario_not_found"
  | "stale_version"
  | "invalid_transition"
  | "destructive_confirmation_required"
  | "not_executable_content"
  | "reason_required";

export interface ScenarioListItem {
  id: string;
  assessmentKey: string;
  assessmentLabel: string;
  reviewState: SecurityReviewState;
  executionStatus: ExecutionStatus;
  origin: ScenarioOrigin;
  currentVersion: number;
  title: string;
  operationKey: string;
  categoryId: string;
  severity: Severity;
  destructive: boolean;
  flags: ScenarioDerivedFlags;
  /** Prerequisites met against the selected profile (none met when no profile is selected). */
  prerequisites: { total: number; met: number };
}

export interface ScenarioVersionSummary {
  version: number;
  author: SecurityScenarioVersion["author"];
  createdAt: string;
  editNote?: string;
  materialChange: boolean;
  contentHash: string;
  specificationRevision: string;
  approval?: ApprovalRecord;
  rejection?: { reason: string; at: string };
}

export interface ScenarioDetail {
  scenario: ScenarioListItem;
  /** The current version's content, with each prerequisite's derived state filled in. */
  content: SecurityScenarioContent;
  versions: ScenarioVersionSummary[];
}

export interface ReviewItemOutcome {
  id: string;
  version: number;
  applied: boolean;
  reviewState?: SecurityReviewState;
  reasonCode?: ReviewRefusalCode;
  message?: string;
}

export interface GenerationNoteView {
  categoryId: string;
  operationKey?: string;
  reason: string;
}

export interface GenerationReply {
  scope: AppliedGenerationScope;
  /** New scenarios stored. */
  created: number;
  /** Existing scenarios left exactly as they were. */
  kept: number;
  /** Existing scenarios that gained a new version because their content or their basis changed. */
  newVersions: number;
  rejected: Array<{ operationKey: string; categoryId: string; violations: Array<{ pointer: string; code: string; message: string }> }>;
  omittedByCap: Array<{ operationKey: string; categoryId: string; omitted: number }>;
  notes: GenerationNoteView[];
}

/** The facets of a scenario list, over everything the filters (other than the derived flag) match, so a facet never lies about the filtered set. */
export interface ScenarioListCounts {
  byReviewState: Record<string, number>;
  byExecutionStatus: Record<string, number>;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface ScenarioListReply {
  items: ScenarioListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: ScenarioListCounts;
}

/** One scenario named for a batch: the id and the version the reviewer saw. */
export interface ScenarioReference {
  id: string;
  version: number;
}

/** `GET /scenarios/ids`: the exact set a filter matches, capped, so a batch is always an explicit list. */
export interface ScenarioIdsReply {
  items: ScenarioReference[];
  total: number;
  /** True when more scenarios matched than `items` holds; a batch must not act on a partial set. */
  capped: boolean;
}

/** `GET /scope`: the default generation scope (research R23). */
export interface ScenarioScopeReply {
  mode: "selection" | "all";
  selectedCount: number;
  totalCount: number;
}

/** One reason a scenario was refused as invalid, as a JSON pointer into its content. */
export interface ScenarioViolationView {
  pointer: string;
  code: string;
  message: string;
}

/** `PATCH /scenarios/:id`. */
export interface ScenarioEditReply {
  scenarioId: string;
  version: number;
  /** True when the edit changed a material field, so an earlier approval did not carry over. */
  material: boolean;
  reviewState: SecurityReviewState;
  scenario: ScenarioDetail;
}

/** `POST /scenarios/review`: each item is applied or refused on its own. */
export interface ScenarioReviewReply {
  applied: ReviewItemOutcome[];
  refused: ReviewItemOutcome[];
}
