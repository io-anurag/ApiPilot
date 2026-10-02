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
 *
 * AP-036 (specs/036-collection-performance-test research R1): `collection` is a plan built from a
 * Postman collection stored in Import & Run Collection, whose requests and scripts were authored
 * outside ApiPilot.
 */
export type PerformancePlanSourceKind = "guided" | "quick" | "collection";

/** An operation in scope that contributes no step (FR-005). */
export interface OmittedOperation {
  operationKey: string;
  reason: "no-positive-scenario";
}

/** Why a step uses the scenario it uses (FR-003, research D4). */
export type ScenarioChoiceReason =
  | "rule-generated"
  | "only-positive"
  | "ai-enhanced-no-rule-alternative"
  /** AP-036 (research R15): the step is one request of a stored collection. */
  | "collection-request";

/**
 * Where one expected status code came from (FR-012, FR-039). AP-036 (research R7): `collection` is a
 * code the collection's own status assertions set, labelled "from the collection's test".
 */
export type ExpectedStatusSource = "specification" | "user" | "collection";

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
  | "none"
  /**
   * AP-036 (research R15): a collection step's own auth, or the auth it inherits from its folders or
   * the collection. `schemeName` is the Postman auth type (`bearer`, `basic`, `apikey`, `noauth`).
   */
  | "collection-auth";

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
  /**
   * AP-033 FR-008, FR-014: present, and `true`, only when the step sends a body the engineer
   * edited. Kept in run snapshots, which carry no body content (specs/033 research R11).
   */
  bodyEdited?: true;
  /**
   * AP-033 FR-022 (amended 2026-09-30): present, and `true`, only when the step sends parameters
   * the engineer edited. Kept in run snapshots, which carry no parameter values.
   */
  parametersEdited?: true;
  /** AP-035 FR-007: the values this step captures from its response. Present only when not empty. */
  captures?: Capture[];
  /** AP-035 FR-011: the request targets this step fills from earlier captures. Present only when not empty. */
  bindings?: ValueBinding[];
  /** AP-035 FR-022: present, and `true`, only on a step of a user-defined journey. */
  userDefined?: true;
  /** AP-036 (research R15): the collection request this step was built from. Present only on collection plans. */
  collectionRequest?: CollectionRequestRef;
}

/**
 * AP-035 (specs/035-user-defined-journeys data-model.md): one segment of a response body field
 * path, an object field name or an array position. Parsed on the server from text such as
 * `data.items[0].id`; never an expression (FR-008).
 */
export type BodyPathSegment = { field: string } | { index: number };

/** AP-035 FR-007: where a capture takes its value from. `path` is the canonical text of `segments`. */
export type CaptureSource =
  | { kind: "body"; path: string; segments: BodyPathSegment[] }
  | { kind: "header"; name: string };

/**
 * AP-035 FR-007: a named value a step takes from its response. Holds no value (FR-020): the value
 * exists only in one virtual user's memory during one journey run.
 */
export interface Capture {
  /** `^[A-Za-z_][A-Za-z0-9_]{0,63}$`, unique within its journey (FR-026). */
  name: string;
  source: CaptureSource;
  /**
   * Derived on assembly (FR-009): `false` adds the "Not documented in the specification" warning,
   * which never blocks. `null` for header captures, which the analysis cannot list (research R9).
   */
  documented: boolean | null;
  /** Present only on a capture converted from a workflow variable (FR-024). */
  relationshipId?: string;
  /**
   * AP-036 (data-model `CaptureOrigin`): where a collection plan's capture came from, a recognised
   * script statement or the engineer (FR-019). Absent on AP-035 captures. A `collection-script`
   * capture's name is the Postman variable's name: 1 to 200 characters, without `{`, `}` or control
   * characters.
   */
  origin?: CaptureOrigin;
}

/** AP-036 (research R6): where a collection request uses a `{{name}}`. */
export type CollectionReferenceLocation = "url" | "header" | "body" | "auth";

/**
 * AP-035 FR-011: a request target of a step that a capture of an earlier step fills. AP-036
 * (research R6): `reference` is every `{{name}}` of a collection step, wherever it occurs.
 */
export type BindingTarget =
  | { kind: "path" | "query" | "header"; name: string }
  | { kind: "body"; fieldPath: string }
  | { kind: "reference"; name: string; locations: CollectionReferenceLocation[] };

export interface ValueBinding {
  target: BindingTarget;
  /** A step before this one in the same journey (FR-011, FR-015). */
  captureStepId: string;
  captureName: string;
  /** Derived on assembly (FR-016): `target-missing` blocks script generation. */
  state: "active" | "target-missing";
  /** Present only when converted from a workflow (FR-024). */
  confidence?: "CONFIRMED" | "LIKELY";
  relationshipId?: string;
}

export interface UserJourneyStepDefinition {
  id: string;
  operationKey: string;
  /** Server-set on conversion from a proposed workflow journey (FR-024); used on revert. */
  fromProposedStepId?: string;
  /** At most 10 (FR-007). */
  captures: Capture[];
  /** Sorted by target kind, then name or field path. */
  bindings: ValueBinding[];
}

export type UserJourneyOrigin = { kind: "defined" } | { kind: "based-on-workflow"; workflowId: string };

/** AP-035 FR-001: a journey the engineer composed. Holds no values (FR-020). */
export interface UserJourneyDefinition {
  id: string;
  /** Trimmed, 1 to 100 characters, no control characters. */
  name: string;
  origin: UserJourneyOrigin;
  /** 1 to 20 (FR-002). */
  steps: UserJourneyStepDefinition[];
  /** Server-maintained sequence for new step ids (research R2). */
  nextStepNumber: number;
}

export type PerformanceJourneySource =
  | { kind: "workflow"; workflowId: string }
  | { kind: "operation" }
  /** AP-035 FR-022, FR-027: a user-defined journey, or one based on a workflow. */
  | { kind: "user"; userJourneyId: string; name: string; basedOnWorkflowId?: string }
  /** AP-036 (research R15): the one journey of a collection plan. */
  | { kind: "collection"; collectionId: string; collectionName: string };

/** An ordered sequence of steps run by every virtual user on each iteration (FR-006a). */
export interface PerformanceJourney {
  /** Content-derived: from the workflow id, or `op:<operationKey>`. */
  id: string;
  source: PerformanceJourneySource;
  steps: PerformanceStep[];
  /**
   * AP-035 FR-025: present only on a user-defined journey with a step whose operation is removed,
   * out of scope or without a positive scenario. Such a journey is not run.
   */
  incompleteReason?: { missingOperationKeys: string[] };
}

/** AP-035 FR-025: the journeys a script runs. An incomplete user-defined journey is left out. */
export function runnableJourneys<T extends Pick<PerformanceJourney, "incompleteReason">>(journeys: readonly T[]): T[] {
  return journeys.filter((journey) => journey.incompleteReason === undefined);
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

/**
 * `body-reference` (AP-033, specs/033 research R4): named only by a `{{name}}` the engineer wrote in
 * an edited body. Secret only when that reference fills a `format: password` field, or when the name
 * is secret elsewhere in the plan.
 */
export type UserSuppliedValueSource =
  | "path-parameter"
  | "credential"
  | "oauth2-client"
  | "base-url"
  | "body-reference"
  | "parameter-reference"
  /** AP-036 (research R12): a collection `{{name}}` no earlier step captures. */
  | "collection-variable"
  /** AP-036 FR-015: a literal from a collection auth field or credential header, kept out of the script. */
  | "collection-literal";

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

/**
 * AP-033 (specs/033-edit-step-request-body data-model `BodyEdit`, research R1, R2): the engineer's
 * replacement for one step's base body, the body before ApiPilot's substitutions. A JSON edit holds
 * the parsed value, so formatting never changes the script; a text edit holds the string.
 */
export type BodyEdit = {
  stepId: string;
  /** Keeps the edit while the operation is removed (FR-018). */
  operationKey: string;
  /** The step's scenario when the edit was saved; a rebuild that changes it discards the edit. */
  scenarioId: string;
} & ({ kind: "json"; json: unknown } | { kind: "text"; text: string });

/** What `PUT /plan` accepts per step in `bodyEdits`; `null` resets the step (FR-017). */
export interface BodyEditInput {
  kind: "json" | "text";
  text: string;
}

export type EditableParameterLocation = "path" | "query" | "header";

/**
 * AP-033 FR-020 (amended 2026-09-30): one documented parameter the engineer changed. `set` sends
 * `value` (text, which may hold `{{name}}` references to environment values); `omit` leaves an
 * optional parameter out of the request.
 */
export type ParameterEditEntry = { location: EditableParameterLocation; name: string } & ({ action: "set"; value: string } | { action: "omit" });

/**
 * AP-033 FR-020: the engineer's parameter changes for one step, kept and discarded exactly as a
 * `BodyEdit` is. `parameters` is sorted by location (path, query, header), then name.
 */
export interface ParameterEdit {
  stepId: string;
  operationKey: string;
  scenarioId: string;
  parameters: ParameterEditEntry[];
}

/** What `PUT /plan` accepts per step in `parameterEdits`: the step's full set of changes; `null` resets it. */
export interface ParameterEditInput {
  parameters: ParameterEditEntry[];
}

/** Why a documented parameter cannot be edited in the plan (AP-033 FR-021). */
export type ParameterNotEditableReason = "filled-at-run-time" | "structured-value";

/** One documented parameter in the step's parameter editor (AP-033 FR-020). */
export interface StepParameterEditRow {
  location: EditableParameterLocation;
  name: string;
  required: boolean;
  /** The schema's type, format and enum, for display only; `null` when the schema states none. */
  type: string | null;
  format: string | null;
  enum: string[] | null;
  /** The value the generated scenario sends, as text; `null` when it does not send this parameter. */
  generated: string | null;
  /** The engineer's change, or `null` when the parameter is as generated. */
  edit: { action: "set"; value: string } | { action: "omit" } | null;
  /** `null` when the parameter can be edited. */
  notEditable: ParameterNotEditableReason | null;
  /** A literal typed here is refused: the schema declares it `format: password` (FR-021). */
  secret: boolean;
}

export interface StepParameterEditModel {
  rows: StepParameterEditRow[];
  edited: boolean;
}

/** AP-033 FR-010: a reference ApiPilot applies that an edited body no longer carries. */
export interface BodyEditNotice {
  stepId: string;
  kind: "workflow-variable-dropped" | "unique-field-dropped" | "capture-binding-dropped";
  /** The workflow variable's name, or the unique field's path. */
  name: string;
}

export type BodyMismatchRule =
  | "required"
  | "type"
  | "enum"
  | "format"
  | "minimum"
  | "maximum"
  | "minLength"
  | "maxLength"
  | "minItems"
  | "maxItems";

/** AP-033 FR-005: one difference between an edited JSON body and the request schema. Never blocks. */
export interface BodyMismatch {
  /** Dotted, with `[n]` for array items; `""` for the body itself. */
  fieldPath: string;
  rule: BodyMismatchRule;
  message: string;
}

/** What body a step sends (AP-033 FR-001). */
export type StepBodyStatus = "sent" | "not-documented" | "documented-not-sent" | "unsupported-content-type";

/** The editor's model for one step (AP-033 data-model `StepBodyEditModel`). */
export interface StepBodyEditModel {
  kind: "json" | "text";
  /** The base body to edit: the edit, or the generated body; `""` when the step sends none. */
  text: string;
  edited: boolean;
  /** Empty unless the step has a JSON edit. */
  mismatches: BodyMismatch[];
  /**
   * AP-033 FR-009: the JSON body fields ApiPilot fills at run time (workflow variables, unique
   * values, credentials), found by comparing the body as sent with the base body. The engineer's
   * own `{{name}}` references are not listed. Empty for text bodies.
   */
  replacements: { fieldPath: string; reference: PreviewReference }[];
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
  /**
   * AP-033: the engineer's body edits, sorted by `stepId`. Fingerprinted only when not empty, so a
   * plan without edits keeps its fingerprint (specs/033 research R10). Emptied in run snapshots.
   */
  bodyEdits: BodyEdit[];
  /** Derived, not fingerprinted (AP-033 FR-010). */
  bodyEditNotices: BodyEditNotice[];
  /**
   * Not fingerprinted (AP-033 FR-018): operations whose edit the last rebuild discarded because the
   * step's scenario changed. Cleared by the next plan edit or rebuild.
   */
  discardedBodyEdits: string[];
  /**
   * AP-033 FR-020 (amended 2026-09-30): the engineer's parameter edits, sorted by `stepId`.
   * Fingerprinted only when not empty. Emptied in run snapshots.
   */
  parameterEdits: ParameterEdit[];
  /** Not fingerprinted: operations whose parameter edit the last rebuild discarded (as `discardedBodyEdits`). */
  discardedParameterEdits: string[];
  /**
   * AP-035 (research R1): the engineer's journeys. Fingerprinted, with `alsoStandalone` and
   * `nextUserJourneyNumber`, only when this or `alsoStandalone` is not empty (research R17).
   * Absent on plans and snapshots from before AP-035, read as empty.
   */
  userJourneys?: UserJourneyDefinition[];
  /** AP-035 FR-003: operations in a user journey that also keep their single-step journey. */
  alsoStandalone?: string[];
  /** AP-035 research R2: the sequence number of the next user journey's id. */
  nextUserJourneyNumber?: number;
  /** Derived, not fingerprinted (FR-016): step ids with a `target-missing` binding. Blocks the script. */
  bindingsNeedingAttention?: string[];
  /** AP-036 (data-model `CollectionPlanInfo`): present only on a plan built from a stored collection. */
  collection?: CollectionPlanInfo;
}

/**
 * AP-032 FR-008 (specs/032-quick-performance-test data-model "StepRequestPreview"): one `{{name}}`
 * a step's request uses, by where its value comes from at run time. Never carries a value.
 */
export type PreviewReference =
  | { kind: "environment"; name: string; secret: boolean }
  | { kind: "workflow-variable"; name: string; variable: string; producerStepId: string | null }
  | { kind: "unique-per-iteration"; name: string; format: UniqueValueField["format"] }
  | { kind: "credential"; name: string; schemeName: string }
  /** AP-035 FR-012: a value captured by an earlier step of the same journey. Never the value. */
  | { kind: "capture"; name: string; captureName: string; producerStepId: string; source: CaptureSource; secret: boolean }
  /** AP-036 FR-013 (research R9): a Postman dynamic variable generated at run time; `variable` is the `$name`. */
  | { kind: "generated-value"; name: string; variable: string };

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
  /** AP-033 FR-001. */
  bodyStatus: StepBodyStatus;
  /** AP-033: `null` when the body cannot be edited (`not-documented`, `unsupported-content-type`). */
  bodyEdit: StepBodyEditModel | null;
  /** AP-033 FR-020: `null` when the operation documents no path, query or header parameter. */
  parameterEdit: StepParameterEditModel | null;
}

/**
 * A removed operation as it would be if restored (AP-032 FR-024a): the step the plan would build
 * for it and that step's request. Computed on request and never stored; the plan is unchanged.
 */
export interface RemovedOperationPreview {
  step: PerformanceStep;
  request: StepRequestPreview;
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

/** Exact extremes and arithmetic mean of a set of latencies, rounded to 0.01 ms (FR-036, amended 2026-09-30). */
export interface LatencySummary {
  min: number;
  mean: number;
  max: number;
}

/**
 * The phases k6 times for every request (FR-036, amended 2026-09-30). `waiting` is time to first byte. The phases do not
 * add up to the duration: `blocked`, `connecting` and `tls-handshaking` happen before it starts.
 */
export type RequestPhase = "blocked" | "connecting" | "tls-handshaking" | "sending" | "waiting" | "receiving";

export const REQUEST_PHASES: readonly RequestPhase[] = ["blocked", "connecting", "tls-handshaking", "sending", "waiting", "receiving"];

export interface RequestPhaseTiming {
  phase: RequestPhase;
  meanMs: number;
  p95Ms: number;
}

/** One step's figures in one timeline bucket; only buckets in which the step sent a request (FR-036, amended 2026-09-30). */
export interface StepTimelinePoint {
  offsetMs: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
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
  /**
   * FR-036 (2026-09-30): every response by status, expected or not, with `"0"` for no response, ordered by
   * status. Absent on runs recorded before the FR-036 amendment of 2026-09-30, whose reports show failure statuses only.
   */
  statusesReceived?: { status: string; count: number; expected: boolean }[];
  /** FR-036 (2026-09-30): `null` when the step sent no request; absent on older runs. */
  latencySummaryMs?: LatencySummary | null;
  /** FR-036 (2026-09-30): the timed phases of the step's requests, in `REQUEST_PHASES` order; absent on older runs. */
  phaseTimings?: RequestPhaseTiming[];
  /** FR-036 (2026-09-30): the step's own timeline, on the run timeline's buckets; absent on older runs. */
  timeline?: StepTimelinePoint[];
  /** AP-035 FR-029: each capture's outcomes, in the step's capture order; absent on older runs. */
  captures?: { name: string; succeeded: number; failed: number }[];
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
  /** AP-035 FR-029: journeys cut short per failed capture name; absent on older runs. */
  cutShortByCapture?: Record<string, number>;
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

/** 2 since AP-035: the cut-short finding names the capture (FR-029). */
export const PERFORMANCE_FINDINGS_RULESET_VERSION = 2;

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
    /** FR-036 (2026-09-30); absent on older runs. */
    latencySummaryMs?: LatencySummary | null;
    /** FR-036 (2026-09-30): one iteration of every journey by one virtual user, think time included; absent on older runs. */
    iterationDurationMs?: LatencyPercentiles | null;
    /** FR-036 (2026-09-30): bytes k6 counted on the wire for the whole run, token requests included; absent on older runs. */
    dataSentBytes?: number;
    dataReceivedBytes?: number;
  };
  journeys: JourneyResult[];
  steps: StepResult[];
  timeline: { bucketMs: number; points: TimelinePoint[] };
  writeRequests: { operationKey: string; method: string; sent: number; succeeded: number }[];
  tokenRefreshes: {
    count: number;
    failed: number;
    lifetimeStated: boolean;
    bucketOffsetsMs: number[];
    /**
     * AP-036 FR-029 (research R8): token requests sent before the load that did not receive an
     * expected status (`capture` is `""`), or whose capture failed. Absent on older runs.
     */
    setupFailed?: { scheme: string; capture: string }[];
    /** AP-036 FR-028: refreshes by token source, sorted by scheme. Absent on older runs. */
    byScheme?: { scheme: string; refreshed: number; failed: number }[];
  };
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
  /** More than one when an operation appears in several journeys, or more than once in one. */
  stepIds: string[];
  /** AP-035 FR-023: each step that sends this operation, with the journey it belongs to. */
  steps: { stepId: string; journeyId: string; journeyLabel: string }[];
}

/** Derived from a plan's steps on every change; never stored (specs/032 data-model.md). */
export interface WriteOperationSummary {
  /** AP-035 FR-023: steps that send a write operation, so an operation in two journeys counts twice. */
  total: number;
  /** Steps per method over 0, in the order POST, PUT, PATCH, DELETE. */
  byMethod: { method: WriteMethod; count: number }[];
  /** In plan order, by first appearance. */
  operations: WriteOperationEntry[];
}

/** AP-035 FR-023: how a journey is named in the write summary: its own name, or its place in the plan. */
export function journeyLabelOf(journey: Pick<PerformanceJourney, "source">, index: number): string {
  return journey.source.kind === "user" ? `J${index + 1} ${journey.source.name}` : `J${index + 1}`;
}

/**
 * AP-032 FR-009 to FR-012, amended by AP-035 FR-023: what the plan's write operations are, for the
 * plan screen and the run trigger. Counts steps, so an operation sent by two steps counts twice;
 * an incomplete user journey is not run, so its steps are not counted (FR-025).
 */
export function summarizeWriteOperations(journeys: readonly PerformanceJourney[]): WriteOperationSummary {
  const entries = new Map<string, WriteOperationEntry>();
  journeys.forEach((journey, index) => {
    if (journey.incompleteReason) return;
    for (const step of journey.steps) {
      const method = step.method.toUpperCase();
      if (!isWriteMethod(method)) continue;
      const entry = entries.get(step.operationKey) ?? { operationKey: step.operationKey, method, path: step.path, effect: WRITE_EFFECTS[method], stepIds: [], steps: [] };
      entry.stepIds.push(step.id);
      entry.steps.push({ stepId: step.id, journeyId: journey.id, journeyLabel: journeyLabelOf(journey, index) });
      entries.set(step.operationKey, entry);
    }
  });
  const operations = [...entries.values()];
  const byMethod = WRITE_METHODS.map((method) => ({
    method,
    count: operations.filter((entry) => entry.method === method).reduce((total, entry) => total + entry.steps.length, 0),
  })).filter((entry) => entry.count > 0);
  return { total: operations.reduce((total, entry) => total + entry.steps.length, 0), byMethod, operations };
}

/**
 * AP-035 FR-009 (specs/035-user-defined-journeys research R9): whether a documented response field
 * is worth pointing out for a later step of the same journey, because its last field name equals
 * one of that step's parameter names. A presentation hint only: it binds nothing (FR-006).
 */
export function laterStepParameterMatches(fieldPath: string, laterParameterNames: readonly string[]): boolean {
  const last = /([A-Za-z0-9_$-]+)(?:\[\d+\])*$/.exec(fieldPath)?.[1];
  return last !== undefined && laterParameterNames.includes(last);
}

/**
 * AP-036 Performance Test from a Postman Collection (specs/036-collection-performance-test
 * data-model.md). None of these types holds a variable value, a captured value or a literal secret;
 * `ConversionFinding.excerpt` is the only script text, and run snapshots empty it (research R16).
 */

/** AP-036: the collection request a step, a left-out request or a credential request came from. */
export interface CollectionRequestRef {
  /** A stable item id (`ensureStableIds`). */
  itemId: string;
  name: string;
  /** Folder names from the root; empty at the root. */
  folderPath: string[];
}

/** AP-036 FR-004 (research R4): why a selected request is not a step. */
export type LeftOutReason =
  | "unsupported-auth"
  | "unsupported-body"
  | "unsupported-dynamic-variable"
  | "unknown-dynamic-variable"
  | "other-host-variable"
  | "reserved-name";

export interface LeftOutRequest extends CollectionRequestRef {
  method: string;
  path: string;
  reason: LeftOutReason;
  /** The auth type, body mode or variable name. Never a value. */
  detail: string | null;
}

/** AP-036: where a script lives. */
export type FindingOwner = { kind: "request"; itemId: string } | { kind: "folder"; folderId: string; folderName: string } | { kind: "collection" };

/** AP-036 (data-model `FindingKind`): statements not converted (R5), scripts (FR-009) and notes. */
export type FindingKind =
  | "condition"
  | "loop"
  | "function"
  | "try"
  | "computed-name"
  | "computed-value"
  | "send-request"
  | "set-next-request"
  | "skip-request"
  | "iteration-data"
  | "unset"
  | "assertion-not-converted"
  | "no-effect"
  | "unsupported-statement"
  | "unreadable-script"
  | "superseded-setter"
  | "prerequest-not-converted"
  | "scope-precedence"
  | "contradictory-assertions"
  | "url-encoding"
  | "credential-header";

/** AP-036 FR-010, FR-018: one item the engineer reviews before a script can be generated. */
export interface ConversionFinding {
  kind: FindingKind;
  owner: FindingOwner;
  /** `null` for notes that are not about a script. */
  event: "test" | "prerequest" | null;
  /** The steps (or credential requests) the item applies to, in plan order. */
  stepIds: string[];
  /** 1-based; `null` for a whole-script or plan-level finding. */
  line: number | null;
  /** Set for `unreadable-script` only. */
  column: number | null;
  /** At most 160 characters of the statement. Plan view only: emptied in run snapshots. */
  excerpt: string | null;
  /** A capture or variable name, a header-name rule, or the codes of `contradictory-assertions`. */
  detail: string | null;
}

/** AP-036 (data-model `CaptureOrigin`): a recognised script statement, or the engineer (FR-019). */
export type CaptureOrigin =
  | {
      kind: "collection-script";
      scope: "environment" | "collectionVariables" | "globals" | "variables";
      owner: FindingOwner;
      line: number;
    }
  | { kind: "user" };

/** AP-036 FR-027 (research R8): a request sent once before the load, whose values feed later steps' auth. */
export interface CredentialRequestView {
  /** The credential request's id, also its token-source scheme. */
  stepId: string;
  request: CollectionRequestRef & { method: string; path: string };
  /** Empty blocks script generation. */
  expectedStatuses: ExpectedStatus[];
  captures: Capture[];
  /** The steps that use each captured value, in plan order. */
  usedBy: { captureName: string; stepIds: string[] }[];
  /** Environment names it needs. */
  requiredValues: string[];
}

/** AP-036 FR-019: a reference of a step that the engineer bound to an earlier capture. */
export interface CollectionAddedBinding {
  stepId: string;
  /** The `{{name}}` the step uses. */
  name: string;
  captureStepId: string;
  captureName: string;
}

/** AP-036 (data-model `CollectionPlanInfo`): what only a collection plan has, on `PerformancePlan.collection`. */
export interface CollectionPlanInfo {
  collectionId: string;
  collectionName: string;
  collectionTier: "local" | "dev" | "qa" | "staging" | "production";
  /** SHA-256 of the stored collection JSON when built (research R13). */
  collectionDigest: string;
  /** Derived on every read; not fingerprinted. */
  collectionState: "current" | "changed" | "deleted";
  /** The run panel's order at build time, at most 100 (FR-002). */
  orderedRequestIds: string[];
  /** Removed by the engineer, code-unit sorted. */
  excludedRequestIds: string[];
  /** Derived: the removed requests, in run order, for the Removed view. */
  excludedRequests: (CollectionRequestRef & { method: string; path: string })[];
  /** In run order (research R4). */
  leftOut: LeftOutRequest[];
  /** In plan order (research R8). */
  credentialRequests: CredentialRequestView[];
  /** Step order, then owner order, then line (research R5, R19). */
  findings: ConversionFinding[];
  /** Research R12: the variable every step's URL starts with, which maps to the environment's base URL. */
  baseUrlVariable: string | null;
  /** Literal hosts, code-unit sorted (FR-016). */
  hosts: string[];
  /** Dynamic-variable occurrences generated at run time (research R9). */
  generatedValueCount: number;
  /** FR-019: references the engineer bound to an earlier capture, sorted by step, then name. */
  addedBindings: CollectionAddedBinding[];
  /** Research R14; not fingerprinted. */
  review: { reviewed: boolean; conversionDigest: string };
}

/** AP-036 contracts/collection-performance-api.md: the session's collection plan as the client sees it. */
export interface CollectionPerformanceTestView {
  collection: { id: string; name: string; tier: CollectionPlanInfo["collectionTier"]; state: CollectionPlanInfo["collectionState"] };
  plan: PerformancePlan;
  script: ScriptStatus | null;
}

/** AP-036 `POST /collection-performance/rebuild`: the steps whose engineer settings could not be kept. */
export interface CollectionRebuildNotKept {
  stepId: string;
  itemId: string;
  name: string;
  settings: ("expected-statuses" | "captures" | "bindings")[];
}

/** AP-036 (research R16): how a collection step is labelled: `<folder path> / <request name>`. */
export function collectionStepLabel(ref: Pick<CollectionRequestRef, "name" | "folderPath">): string {
  return [...ref.folderPath, ref.name].join(" / ");
}
