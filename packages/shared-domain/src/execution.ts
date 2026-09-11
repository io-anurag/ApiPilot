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
 * A named target an approved collection can be executed against (FR-001, FR-002). Session-scoped
 * and retained only for the session's lifetime — no durable persistence (research.md D3),
 * matching specs/017-session-workflow-isolation's existing model.
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
   * credential-like values (FR-005), retained in memory for the session per the resolved
   * clarification.
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
