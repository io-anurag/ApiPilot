/**
 * k6 Performance Testing domain contracts (AP-029, specs/031-k6-performance-testing
 * data-model.md).
 *
 * Framework-agnostic and k6-agnostic per constitution VIII/X: nothing here names a k6 option,
 * CLI flag or output format. Those stay inside `backend/src/performance/k6/`. Names that would
 * clash with other feature contracts in this package carry a `Performance` prefix (for example
 * `PerformanceFailureCategory`, since `FailureCategory` belongs to AP-017's `execution.ts`).
 */

/**
 * Where a plan was built (AP-032, specs/032-quick-performance-test data-model.md): the guided
 * workflow's Performance Testing stage, or the quick performance test straight from an uploaded
 * specification, whose scenarios were generated and not reviewed (FR-013).
 */
export type PerformancePlanSourceKind = "guided" | "quick";

/** An operation in scope that contributes no step (FR-005). */
export interface OmittedOperation {
  operationKey: string;
  reason: "no-positive-scenario";
}

/** Why a step uses the scenario it uses (FR-003, research D4). */
export type ScenarioChoiceReason =
  | "rule-generated"
  | "only-positive"
  | "ai-enhanced-no-rule-alternative";

/** Where one expected status code came from (FR-012, FR-039). */
export type ExpectedStatusSource = "specification" | "user";

/**
 * One expected status code of a step. `code` is an exact code (`^[1-5]\d\d$`) or an OpenAPI range
 * (`^[1-5]XX$`). `source` is computed by the server and never accepted from a client (D26).
 */
export interface ExpectedStatus {
  code: string;
  source: ExpectedStatusSource;
}

/** How a step authenticates. Never carries a value (FR-039, FR-040). */
export type StepAuthKind =
  | "oauth2-client-credentials"
  | "chained-login"
  | "static-credential"
  | "none";

export interface StepAuth {
  kind: StepAuthKind;
  /** The security scheme's key in the specification; `null` when `kind` is `none`. */
  schemeName: string | null;
}

/** Why a step is in a multi-step journey (FR-039). `null` on a single-step journey's step. */
export interface StepDependency {
  relationshipIds: string[];
  confidence: "CONFIRMED" | "LIKELY";
}

/**
 * Where a workflow variable enters or leaves a step, so the script and the report can say where
 * each variable came from (FR-010, FR-039). `field` is the response field for `produces`, or the
 * request field for `consumes`; `location` applies to `consumes` only.
 */
export interface StepVariableBinding {
  variable: string;
  role: "produces" | "consumes";
  field: string;
  location?: "path" | "query" | "header" | "body" | "auth";
  /** For `consumes`: the id of the step in the same journey that produces the variable. */
  producerStepId?: string;
}

/** One request in a journey (data-model.md `PerformanceStep`). */
export interface PerformanceStep {
  /** Content-derived; also the `step` metrics tag. */
  id: string;
  /** `"METHOD /path"`, with the path template, never a resolved URL (FR-040). */
  operationKey: string;
  method: string;
  path: string;
  scenarioId: string;
  /** The scenario's own provenance description, for display. */
  scenarioDescription: string;
  scenarioChoice: ScenarioChoiceReason;
  tieBrokenByLowestId: boolean;
  consumes: string[];
  produces: string[];
  variableBindings: StepVariableBinding[];
  dependency: StepDependency | null;
  /** Empty only while the specification documents no success status and the user set none. */
  expectedStatuses: ExpectedStatus[];
  auth: StepAuth;
  /** Names of the user-supplied values this step needs (FR-013). */
  requiredValues: string[];
}

export type PerformanceJourneySource =
  | { kind: "workflow"; workflowId: string }
  | { kind: "operation" };

/** An ordered sequence of steps run by every virtual user on each iteration (FR-006a). */
export interface PerformanceJourney {
  /** Content-derived: from the workflow id, or `op:<operationKey>`. */
  id: string;
  source: PerformanceJourneySource;
  steps: PerformanceStep[];
}

export type LoadProfileKind = "smoke" | "load" | "stress" | "spike" | "soak";

export interface LoadStage {
  durationMs: number;
  targetVirtualUsers: number;
}

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * The five named profiles' starting stages (FR-017; data-model.md), shared so the backend's plan and
 * the frontend's profile editor never disagree. Editable starting points, never recommended
 * performance targets (spec Assumptions).
 */
export const LOAD_PROFILE_STARTING_STAGES: Readonly<Record<"smoke" | "load" | "stress" | "spike" | "soak", readonly LoadStage[]>> = {
  smoke: [{ durationMs: MINUTE_MS, targetVirtualUsers: 1 }],
  load: [
    { durationMs: 2 * MINUTE_MS, targetVirtualUsers: 10 },
    { durationMs: 5 * MINUTE_MS, targetVirtualUsers: 10 },
    { durationMs: MINUTE_MS, targetVirtualUsers: 0 },
  ],
  stress: [
    { durationMs: 2 * MINUTE_MS, targetVirtualUsers: 20 },
    { durationMs: 5 * MINUTE_MS, targetVirtualUsers: 20 },
    { durationMs: 2 * MINUTE_MS, targetVirtualUsers: 40 },
    { durationMs: 5 * MINUTE_MS, targetVirtualUsers: 40 },
    { durationMs: 2 * MINUTE_MS, targetVirtualUsers: 0 },
  ],
  spike: [
    { durationMs: MINUTE_MS, targetVirtualUsers: 5 },
    { durationMs: 30 * SECOND_MS, targetVirtualUsers: 50 },
    { durationMs: MINUTE_MS, targetVirtualUsers: 50 },
    { durationMs: 30 * SECOND_MS, targetVirtualUsers: 5 },
    { durationMs: MINUTE_MS, targetVirtualUsers: 5 },
    { durationMs: 30 * SECOND_MS, targetVirtualUsers: 0 },
  ],
  soak: [
    { durationMs: 5 * MINUTE_MS, targetVirtualUsers: 10 },
    { durationMs: 60 * MINUTE_MS, targetVirtualUsers: 10 },
    { durationMs: 5 * MINUTE_MS, targetVirtualUsers: 0 },
  ],
};

/** FR-017, FR-019: editable stages, with no maximum and no warning. */
export interface LoadProfile {
  kind: LoadProfileKind;
  stages: LoadStage[];
  /** Derived: the sum of stage durations. */
  plannedDurationMs: number;
}

export type PerformanceThresholdMetric = "p50" | "p90" | "p95" | "p99" | "error-rate";

export type PerformanceThresholdScope = { kind: "run" } | { kind: "step"; stepId: string };

/** A user-set pass/fail limit (FR-018). Latency limits are in ms, error-rate limits in percent. */
export interface PerformanceThreshold {
  /** Content-derived. */
  id: string;
  scope: PerformanceThresholdScope;
  metric: PerformanceThresholdMetric;
  comparator: "<=";
  limit: number;
}

export type UserSuppliedValueSource = "path-parameter" | "credential" | "oauth2-client" | "base-url";

/** A value the specification cannot produce (FR-013). The value itself lives in an environment. */
export interface UserSuppliedValueRequirement {
  name: string;
  secret: boolean;
  neededBySteps: string[];
  source: UserSuppliedValueSource;
}

/** A requirement judged against one environment. Presence only, never the value (FR-013). */
export interface UserSuppliedValueStatus extends UserSuppliedValueRequirement {
  present: boolean;
}

/** A body field made unique per virtual user and iteration (FR-016, D13). */
export interface UniqueValueField {
  stepId: string;
  location: "body";
  fieldPath: string;
  format: "email" | "uuid";
}

/** What will be tested and how (data-model.md `PerformancePlan`). Holds no values. */
export interface PerformancePlan {
  /** AP-032: where the plan was built. Fingerprinted. Absent on snapshots recorded before AP-032, read as `guided`. */
  source: PerformancePlanSourceKind;
  excludedOperationKeys: string[];
  omitted: OmittedOperation[];
  journeys: PerformanceJourney[];
  thinkTimeMs: number;
  loadProfile: LoadProfile;
  thresholds: PerformanceThreshold[];
  userSuppliedValues: UserSuppliedValueRequirement[];
  uniqueValueFields: UniqueValueField[];
  /** The out-of-date check (FR-023). Covers every field above. */
  fingerprint: string;
  /** Over the approvals the plan was built from; a mismatch rebuilds the plan (D1). */
  upstreamFingerprint: string;
  /** Derived, not fingerprinted: step ids with no expected status, in plan order (FR-012a). */
  stepsNeedingExpectedStatus: string[];
  /**
   * Derived, not fingerprinted (AP-032 FR-003a): the login operations the plan's chained-login
   * token sources call, sorted. A quick plan starts with them removed; a removed operation listed
   * here is shown as "used to acquire the run's credentials".
   */
  credentialProducerOperationKeys: string[];
}

/**
 * AP-032 FR-008 (specs/032-quick-performance-test data-model "StepRequestPreview"): one `{{name}}`
 * a step's request uses, by where its value comes from at run time. Never carries a value.
 */
export type PreviewReference =
  | { kind: "environment"; name: string; secret: boolean }
  | { kind: "workflow-variable"; name: string; variable: string; producerStepId: string | null }
  | { kind: "unique-per-iteration"; name: string; format: UniqueValueField["format"] }
  | { kind: "credential"; name: string; schemeName: string };

/** A parameter or header value: generated text, one reference, or text that mixes both. */
export type PreviewValue =
  | { kind: "generated"; text: string }
  | { kind: "template"; text: string; references: PreviewReference[] }
  | PreviewReference;

export interface PreviewParameter {
  location: "path" | "query" | "header";
  name: string;
  value: PreviewValue;
}

export interface PreviewAuth {
  kind: StepAuthKind;
  schemeName: string | null;
  location: "header" | "query" | null;
  references: PreviewReference[];
}

/** The view-only request of one step, derived from the request the script sends (FR-008). */
export interface StepRequestPreview {
  stepId: string;
  operationKey: string;
  method: string;
  pathTemplate: string;
  /** Path, then query, then header parameters, each in request order. */
  parameters: PreviewParameter[];
  auth: PreviewAuth;
  /** `text` is the body as sent, with each reference left as `{{name}}`. */
  body: { contentType: "json" | "text"; text: string; references: PreviewReference[] } | null;
}

/** What the frontend knows about a generated script. Never the script text. */
export interface ScriptStatus {
  planFingerprint: string;
  scriptSha256: string;
  stepCount: number;
  outOfDate: boolean;
}

/**
 * AP-032 contracts/quick-performance-api.md: the session's quick performance test as the client sees
 * it. No script text, no scenario body outside the step preview, no environment value.
 */
export interface QuickPerformanceTestView {
  specification: { filename: string; info?: { title: string; version: string }; operationCount: number };
  plan: PerformancePlan;
  script: ScriptStatus | null;
}

export type K6UnavailableReason =
  | "not-found"
  | "not-executable"
  | "version-unreadable"
  | "unsupported-version";

/** FR-027. `detail` never carries the binary's path. */
export type K6Readiness =
  | { state: "ready"; version: string; checkedAt: string }
  | { state: "unavailable"; reason: K6UnavailableReason; detail?: string; checkedAt: string };

export type PerformanceRunStatus = "in-progress" | "completed" | "cancelled" | "failed";

export type PerformanceRunCancelReason = "user-requested" | "backend-restart";

export type PerformanceRunFailureCategory =
  | "k6-unavailable"
  | "script-integrity-failed"
  | "k6-exited-with-error"
  | "metrics-unreadable";

/** A snapshot of the target environment. Never its `variableValues` (FR-025, FR-039). */
export interface PerformanceRunEnvironment {
  id: string;
  name: string;
  tier: "local" | "dev" | "qa" | "staging" | "production";
  baseUrl: string;
}

export interface StepProgress {
  stepId: string;
  requests: number;
  failures: number;
  notSent: { missingData: number; dependencyNotAttempted: number };
}

/** Running figures while a run is in progress (FR-030, amended 2026-09-27). */
export interface RunProgress {
  elapsedMs: number;
  currentVirtualUsers: number;
  requestsSoFar: number;
  failuresSoFar: number;
  journeysCutShortSoFar: number;
  tokenRefreshesSoFar: number;
  steps: StepProgress[];
}

export interface LatencyPercentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Each failure gets exactly one category (D14). A response whose status is among the step's
 * expected codes is never categorized, including 401, 403 or 429.
 */
export type PerformanceFailureCategory =
  | "unexpected-status"
  | "connection-error"
  | "timeout"
  | "extraction-failed"
  | "missing-data"
  | "dependency-not-attempted"
  | "authentication"
  | "rate-limited";

export interface StepResult {
  stepId: string;
  operationKey: string;
  method: string;
  expectedStatuses: ExpectedStatus[];
  requests: number;
  /** `null` when the step sent no request. */
  latencyMs: LatencyPercentiles | null;
  throughputPerSecond: number;
  errorRatePercent: number;
  /**
   * Failures only: statuses outside `expectedStatuses`, with `"0"` for no response. Failed
   * extractions appear in `errorsByCategory` as `extraction-failed` but are not request failures,
   * so they are not in `errorRatePercent`.
   */
  errorsByStatus: { status: string; count: number }[];
  errorsByCategory: { category: PerformanceFailureCategory; count: number }[];
  /** `null` when no check ran. */
  checkPassRatePercent: number | null;
  notAttempted: { missingData: number; dependencyNotAttempted: number };
  missingVariables: string[];
}

export interface JourneyResult {
  journeyId: string;
  requests: number;
  latencyMs: LatencyPercentiles | null;
  throughputPerSecond: number;
  errorRatePercent: number;
  checkPassRatePercent: number | null;
  runsCutShort: number;
  /** The step whose failed extraction cut this journey short most often (research D16 rule 4). */
  cutShortAtStepId?: string;
}

export interface TimelinePoint {
  offsetMs: number;
  virtualUsers: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
}

export type PerformanceFindingRuleId =
  | "threshold-failed"
  | "slowest-step"
  | "failures-start"
  | "cut-short-journeys"
  | "missing-data"
  | "rate-limited"
  | "authentication-after-expiry"
  | "connection-errors"
  | "refreshes";

/** A fixed-rule finding (FR-038). `message` is fixed text built from `values`. */
export interface PerformanceFinding {
  ruleId: PerformanceFindingRuleId;
  stepIds: string[];
  message: string;
  values: Record<string, number | string>;
}

export const PERFORMANCE_FINDINGS_RULESET_VERSION = 1;

export interface ThresholdOutcome {
  thresholdId: string;
  /** `null` when the run produced no measurement for it (for example, a step that sent nothing); such a threshold is not passed. */
  measured: number | null;
  passed: boolean;
}

/** The aggregated measurements of a run (data-model.md `PerformanceResult`). */
export interface PerformanceResult {
  totals: {
    requests: number;
    errors: number;
    errorRatePercent: number;
    iterations: number;
    journeysCutShort: number;
    throughputPerSecond: number;
    latencyMs: LatencyPercentiles | null;
  };
  journeys: JourneyResult[];
  steps: StepResult[];
  timeline: { bucketMs: number; points: TimelinePoint[] };
  writeRequests: { operationKey: string; method: string; sent: number; succeeded: number }[];
  tokenRefreshes: { count: number; failed: number; lifetimeStated: boolean; bucketOffsetsMs: number[] };
  /** The earliest timeline bucket with a failure, and the step with the most failures in it (research D16 rule 3). */
  firstFailure?: { offsetMs: number; stepId: string };
  /** The earliest timeline bucket with an unexpected 429 (research D16 rule 6). */
  firstRateLimitedOffsetMs?: number;
  thresholdOutcomes: ThresholdOutcome[];
  findings: PerformanceFinding[];
  findingsRulesetVersion: number;
  latencyPrecision: "within-1-percent";
}

/** One execution of a generated script against one environment (data-model.md). */
export interface PerformanceRun {
  id: string;
  status: PerformanceRunStatus;
  cancelReason?: PerformanceRunCancelReason;
  failure?: { category: PerformanceRunFailureCategory };
  environment: PerformanceRunEnvironment;
  planSnapshot: PerformancePlan;
  /** AP-032: copied from `planSnapshot.source`; `guided` for every run recorded before AP-032. */
  planSource: PerformancePlanSourceKind;
  scriptSha256: string;
  k6Version: string;
  plannedDurationMs: number;
  startedAt: string;
  endedAt?: string;
  cancelRequested: boolean;
  progress?: RunProgress;
  result?: PerformanceResult;
}

/** `GET /runs` rows: no plan snapshot, progress or result. */
export type PerformanceRunSummary = Omit<PerformanceRun, "planSnapshot" | "progress" | "result">;

/** AP-032 FR-009, FR-010: the write methods, in the fixed summary order. */
export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export type WriteEffect = "creates" | "replaces" | "updates" | "deletes";

const WRITE_METHODS: readonly WriteMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

const WRITE_EFFECTS: Readonly<Record<WriteMethod, WriteEffect>> = { POST: "creates", PUT: "replaces", PATCH: "updates", DELETE: "deletes" };

/** The text marker each write step carries beside its method badge (FR-010): never colour alone. */
export const WRITE_EFFECT_LABELS: Readonly<Record<WriteMethod, string>> = { POST: "Creates", PUT: "Replaces", PATCH: "Updates", DELETE: "Deletes" };

/** Exact, upper-case match; callers normalize first. */
export function isWriteMethod(method: string): method is WriteMethod {
  return (WRITE_METHODS as readonly string[]).includes(method);
}

/** The effect of a request with this method, or `null` for a read. */
export function writeEffectOf(method: string): WriteEffect | null {
  const normalized = method.toUpperCase();
  return isWriteMethod(normalized) ? WRITE_EFFECTS[normalized] : null;
}

/** The FR-010 text marker for this method ("Creates", …), or `null` for a read. */
export function writeEffectLabelOf(method: string): string | null {
  const normalized = method.toUpperCase();
  return isWriteMethod(normalized) ? WRITE_EFFECT_LABELS[normalized] : null;
}

export interface WriteOperationEntry {
  operationKey: string;
  method: WriteMethod;
  path: string;
  effect: WriteEffect;
  /** More than one only when an operation appears in several guided workflow journeys. */
  stepIds: string[];
}

/** Derived from a plan's steps on every change; never stored (specs/032 data-model.md). */
export interface WriteOperationSummary {
  /** Distinct write operations, not steps. */
  total: number;
  /** Methods with a count over 0, in the order POST, PUT, PATCH, DELETE. */
  byMethod: { method: WriteMethod; count: number }[];
  /** In plan order, by first appearance. */
  operations: WriteOperationEntry[];
}

/** AP-032 FR-009 to FR-012: what the plan's write operations are, for the plan screen and the run trigger. */
export function summarizeWriteOperations(journeys: readonly PerformanceJourney[]): WriteOperationSummary {
  const entries = new Map<string, WriteOperationEntry>();
  for (const journey of journeys) {
    for (const step of journey.steps) {
      const method = step.method.toUpperCase();
      if (!isWriteMethod(method)) continue;
      const existing = entries.get(step.operationKey);
      if (existing) existing.stepIds.push(step.id);
      else entries.set(step.operationKey, { operationKey: step.operationKey, method, path: step.path, effect: WRITE_EFFECTS[method], stepIds: [step.id] });
    }
  }
  const operations = [...entries.values()];
  const byMethod = WRITE_METHODS.map((method) => ({ method, count: operations.filter((entry) => entry.method === method).length })).filter(
    (entry) => entry.count > 0,
  );
  return { total: operations.length, byMethod, operations };
}
