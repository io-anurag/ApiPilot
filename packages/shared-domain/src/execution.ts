import type { Assertion } from "./testModel";

/**
 * Execution & Results domain contracts (AP-017, specs/018-test-execution-results).
 *
 * Framework-agnostic per constitution VIII/X: nothing here depends on Newman, Postman, or
 * Express. `TestGenerationWorkflow`'s existing shape is unchanged — an `ExecutionRun`
 * references its originating workflow by id rather than being embedded in it (data-model.md,
 * research.md D3).
 */

/** `"staging"` and `"production"` are the two tiers FR-007's confirmation step applies to. */
export type EnvironmentTier = "local" | "dev" | "qa" | "staging" | "production";

/**
 * A named target an approved collection can be executed against (FR-001, FR-002). Session-scoped:
 * still removed when its session is idle-evicted, matching specs/017-session-workflow-isolation's
 * existing model, but as of specs/025-local-persistence-layer it is durably persisted (encrypted
 * at rest) so it survives a backend restart for as long as its owning session remains active
 * (specs/018-test-execution-results FR-005, as amended).
 */
export interface Environment {
  id: string;
  /** Unique within the session (FR-001, FR-003). */
  name: string;
  tier: EnvironmentTier;
  /** Substituted for the collection's `{{baseUrl}}` variable. */
  baseUrl: string;
  /**
   * Every other value the collection's declared variables need, keyed by the same variable
   * names `generateCollection()`'s `options.variableValues` already accepts — including
   * credential-like values (FR-005), persisted encrypted at rest for the session's lifetime
   * (specs/025-local-persistence-layer research.md D7).
   */
  variableValues: Record<string, string>;
  /** FR-011; `0` (no pause) by default. Applies to every run started against this environment. */
  requestDelayMs: number;
}

/**
 * There is no stored `"not-started"` value: a run record is only created once execution actually
 * starts (FR-006). "Not yet started" is the absence of a current run, observable at the workflow
 * level without a dedicated status value.
 */
export type ExecutionRunStatus = "in-progress" | "completed" | "cancelled";

/**
 * A request that was never sent. Kept separate from `FailureCategory`: no failure occurred to
 * categorize. `"run-ended-before-reached"` is the defensive fallback for any request the loop
 * never reaches for a reason other than an explicit cancellation (constitution XIX — Fail
 * Safely: every request gets an explicit, named outcome, never an unlabeled gap).
 */
export type NotAttemptedReason = "cancelled" | "dependency-not-met" | "run-ended-before-reached";

/** A request that *was* sent and did not pass (FR-012). */
export type FailureCategory =
  | "assertion-failed"
  | "unexpected-status"
  | "connectivity-failure"
  | "timeout"
  | "could-not-evaluate";

/** One assertion's outcome for one executed request (research.md D5). */
export interface AssertionOutcome {
  /** Position within the originating `TestScenario.assertions` array. */
  assertionIndex: number;
  /** Reused from `testModel.ts` — no new assertion vocabulary. */
  type: Assertion["type"];
  outcome: "passed" | "failed" | "could-not-evaluate";
  /**
   * Non-sensitive summary only (e.g. "expected status 201, got 500"; "response was not valid
   * JSON") — never a raw response body (FR-017, constitution XX).
   */
  detail?: string;
}

/** One raw header exactly as sent or received on the wire. */
export interface RawHeader {
  key: string;
  value: string;
}

/**
 * Full raw request/response detail for one executed request — the resolved request URL, its
 * headers and body, and the response's headers and body, exactly as sent/received. Deliberately
 * separate from `AssertionOutcome.detail` (which stays a non-sensitive summary for every tier,
 * FR-017): this shape is the explicit, separately-gated opt-in `RequestResult` originally
 * reserved for a future diagnostics enhancement rather than defaulting to include (data-model.md,
 * FR-017 amendment, Clarifications 2026-09-20). Never populated for any tier other than `"local"`
 * — a local run is assumed to target the developer's own non-production service, so nothing here
 * is redacted, unlike the credential-safety behavior that remains in force for every other tier.
 * Persisted encrypted at rest via the same mechanism `Environment.variableValues` already uses
 * (specs/025-local-persistence-layer research.md D7), kept in a column separate from the rest of
 * `RequestResult` so a non-local run's stored row can never carry this data even by accident.
 */
export interface RawRequestCapture {
  requestUrl: string;
  requestHeaders: RawHeader[];
  requestBody?: string;
  responseHeaders: RawHeader[];
  responseBody?: string;
}

/**
 * How far one request got (specs/018 FR-016, specs/029-execution-gap-closure FR-008/FR-009):
 * `"not-sent"` for every `not-attempted` result; `"no-response"` for a `connectivity-failure`/
 * `timeout`; `"response-received"` for a pass or any other failure category, since assertion
 * evaluation always follows a received response on this path.
 */
export type RequestProcessingStage = "not-sent" | "no-response" | "response-received";

/**
 * One earlier request in the same run whose blocking outcome left a data dependency unmet
 * (specs/029-execution-gap-closure FR-002). The same identifiers that request's own
 * `RequestResult` carries, so the two can be matched — never a value or variable name (FR-017).
 */
export interface UnmetDependency {
  scenarioId: string;
  operationPath: string;
  operationMethod: string;
}

/** One executed (or explicitly not-attempted) request within an `ExecutionRun` (FR-016). */
export interface RequestResult {
  /** Ties back to the originating `TestScenario.id`. */
  scenarioId: string;
  operationPath: string;
  operationMethod: string;
  outcome: "passed" | "failed" | "not-attempted";
  /** Present only when `outcome === "failed"`. */
  failureCategory?: FailureCategory;
  /** Present only when `outcome === "not-attempted"`. */
  notAttemptedReason?: NotAttemptedReason;
  startedAt: string;
  /** `0` for `not-attempted`. */
  durationMs: number;
  /** Absent for `not-attempted` and for `connectivity-failure`/`timeout` (no response was received). */
  responseStatusCode?: number;
  /** Empty for `not-attempted`. */
  assertionOutcomes: AssertionOutcome[];
  /** Present only when the run's `environmentSnapshot.tier === "local"` (see `RawRequestCapture`). */
  rawCapture?: RawRequestCapture;
  /**
   * Set on every result produced since specs/029-execution-gap-closure; absent on results stored
   * before it, which are returned unchanged (FR-015).
   */
  processingStage?: RequestProcessingStage;
  /**
   * Present if and only if `notAttemptedReason === "dependency-not-met"`: every earlier request
   * whose blocking outcome left this request's data dependency unmet, in execution order
   * (specs/029-execution-gap-closure FR-002).
   */
  unmetDependencies?: UnmetDependency[];
}

/** Aggregate counts, recomputed from `ExecutionRun.results` whenever it changes. */
export interface ExecutionRunSummary {
  total: number;
  passed: number;
  failed: number;
  notAttempted: number;
  durationMs: number;
}

/** One execution of an approved collection against one environment (FR-006 onward). */
export interface ExecutionRun {
  id: string;
  /** The originating `TestGenerationWorkflow.id`, for traceability — not a live reference. */
  workflowId: string;
  environmentId: string;
  /**
   * Captured at start time (FR-018/FR-020: a run must remain meaningful even if the `Environment`
   * it targeted is later edited). Excludes `variableValues`/credentials — never persisted into a
   * run record (FR-017).
   */
  environmentSnapshot: Pick<Environment, "name" | "tier" | "baseUrl">;
  status: ExecutionRunStatus;
  startedAt: string;
  /** Absent while `status === "in-progress"`. */
  completedAt?: string;
  summary: ExecutionRunSummary;
  /**
   * Appended to in execution order as each item settles; a client polling mid-run sees a growing
   * prefix (FR-013/FR-014).
   */
  results: RequestResult[];
  /**
   * Set by `POST .../execution/cancel` and read by the orchestration loop between iterations
   * (research.md D6). Not part of the public API response shape's meaning beyond `status`
   * itself, but kept on the record so the store's cancel operation is a plain field write.
   */
  cancelRequested: boolean;
  /**
   * Present only when `status === "cancelled"` (specs/025-local-persistence-layer Clarifications
   * 2026-09-16 Q1): distinguishes a run the user explicitly cancelled (`"user-requested"`) from
   * one left `"in-progress"` by a prior backend process and settled as cancelled on the next
   * startup (`"backend-restart"`), so run history stays diagnostically honest about which
   * happened.
   */
  cancelReason?: "user-requested" | "backend-restart";
}

/**
 * Computed on demand from the selected `Environment.tier` and the approved `TestModel`'s
 * operations (any `POST`/`PUT`/`PATCH`/`DELETE`) — never stored; a response shape, not an entity
 * (FR-007, contracts/execution-api.md).
 */
export interface ExecutionConfirmationRequirement {
  environmentTier: EnvironmentTier;
  destructiveOperations: Array<{ operationPath: string; operationMethod: string }>;
}
