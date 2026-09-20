import type {
  EnvironmentTier,
  ExecutionRunStatus,
  ExecutionRunSummary,
  NotAttemptedReason,
  RawRequestCapture,
} from "./execution";

/**
 * External Postman collection import & execution domain contracts (AP-026,
 * specs/026-external-collection-execution).
 *
 * Framework-agnostic per constitution VIII/X. These types are deliberately siblings of, not
 * extensions to, AP-017's `ExecutionRun`/`RequestResult` (research.md D6/D8): an uploaded
 * collection has no `TestScenario` to interpret its assertions against, so forcing its arbitrary,
 * author-named tests into that closed vocabulary would fabricate a classification the collection
 * never declared (constitution I/XIV). `ExecutionRun`/`RequestResult` remain exactly as shipped.
 */

/**
 * A validated, session-scoped Postman collection + environment pair supplied directly by the
 * user (FR-001, FR-016, FR-017) — merged into one entity rather than two, since the pair is
 * always uploaded, named, selected, and removed together (research.md D4).
 */
export interface UploadedCollectionSet {
  id: string;
  /** Unique within the session (FR-016), mirroring `Environment.name`. */
  name: string;
  tier: EnvironmentTier;
  /** The uploaded Postman Collection v2.1 document, stored verbatim (research.md D4). */
  collection: string;
  /** From the uploaded environment's `values` array. Encrypted at rest (FR-009). */
  variableValues: Record<string, string>;
  /** Mirrors `Environment.requestDelayMs`; `0` (no pause) by default. */
  requestDelayMs: number;
  /** Set once the FR-007 "unverified content" confirmation has been accepted for this artifact. */
  confirmedAt?: string;
  createdAt: string;
}

/**
 * A **smaller** set than `RequestResult`'s `FailureCategory` — `"unexpected-status"` and
 * `"could-not-evaluate"` do not apply: those distinctions require knowing an assertion's *type*
 * (`"status-code"` vs. `"schema-conformance"`), which an uploaded collection's arbitrary named
 * test never declares (research.md D6). Every assertion failure is reported as
 * `"assertion-failed"`, naming which test(s) failed in `testOutcomes` below.
 */
export type UploadedFailureCategory = "connectivity-failure" | "timeout" | "assertion-failed";

/** One test Newman actually ran for a request, named exactly as the collection's own script named it. */
export interface UploadedTestOutcome {
  name: string;
  outcome: "passed" | "failed";
  /** The test's failure message, redacted via the same `redactIfSensitive()` helper `mapNewmanResult.ts` uses. */
  detail?: string;
}

/**
 * One executed (or not-attempted) request within an `UploadedCollectionExecutionRun` —
 * structurally parallel to `RequestResult` (FR-016) but without a `TestScenario` to report
 * against (research.md D6/D8).
 */
export interface UploadedRequestResult {
  /** The Postman item's own `name` — there is no `operationPath`/`operationMethod` to report instead. */
  requestName: string;
  requestMethod: string;
  outcome: "passed" | "failed" | "not-attempted";
  /** Present only when `outcome === "failed"`. */
  failureCategory?: UploadedFailureCategory;
  /** Only `"cancelled"` and `"run-ended-before-reached"` are reachable — no dependency chaining exists here. */
  notAttemptedReason?: NotAttemptedReason;
  startedAt: string;
  /** `0` for `not-attempted`. */
  durationMs: number;
  responseStatusCode?: number;
  /** One entry per test Newman actually ran for this request. Empty for `not-attempted`. */
  testOutcomes: UploadedTestOutcome[];
  /** Present only when the run's `uploadedCollectionSnapshot.tier === "local"` (FR-017a parity). */
  rawCapture?: RawRequestCapture;
}

/**
 * One execution of an `UploadedCollectionSet` (FR-005 onward) — structurally parallel to
 * `ExecutionRun`, stored and gated separately (research.md D7), never merged into the same table.
 */
export interface UploadedCollectionExecutionRun {
  id: string;
  /** Discriminant (research.md D8) — always `"uploaded"` for this type. */
  source: "uploaded";
  /** The originating `UploadedCollectionSet.id` — not a live reference. */
  uploadedCollectionSetId: string;
  /** Captured at start time; must remain meaningful even if the source is later removed (FR-017). */
  uploadedCollectionSnapshot: { name: string; tier: EnvironmentTier };
  status: ExecutionRunStatus;
  startedAt: string;
  /** Absent while `status === "in-progress"`. */
  completedAt?: string;
  summary: ExecutionRunSummary;
  /** Appended in execution order as each item settles — same growing-prefix semantics as `ExecutionRun.results`. */
  results: UploadedRequestResult[];
  cancelRequested: boolean;
  cancelReason?: "user-requested" | "backend-restart";
}

/**
 * One Postman event handler, read directly off `postman-collection`'s own `item.toJSON()` output
 * (research.md D6). Unlike `postmanArtifact.ts`'s generator-only `PostmanEvent`, `listen` allows
 * both values Postman itself supports — `postmanArtifact.ts`'s narrower type only ever needs
 * `"test"` because ApiPilot's own generator never emits a `"prerequest"` script.
 */
export interface PostmanRawEvent {
  listen: "prerequest" | "test";
  script: { type: string; exec: string[] };
}

/**
 * One Postman request, read directly off `postman-collection`'s own `item.toJSON().request`
 * (research.md D6). `body`/`auth`/`url`/`header` are carried as the SDK's own already-validated
 * JSON rather than re-typed into a second, narrower shape — `postman-collection`'s `Collection`
 * constructor (FR-002) is what validated this content at upload time, not this type.
 */
export interface PostmanRawRequest {
  method: string;
  url: unknown;
  header?: unknown;
  body?: unknown;
  auth?: unknown;
}

/**
 * One runnable request item from an *uploaded* collection, read directly off
 * `postman-collection`'s own `Item.toJSON()` (research.md D6) after `Collection.forEachItem()`
 * flattens arbitrary folder nesting into document order. Deliberately separate from
 * `postmanArtifact.ts`'s generator-only `PostmanRequestItem`, which is documented as "the subset
 * of the collection format ApiPilot emits" and cannot represent a `"prerequest"` event, a non-
 * `"raw"` body mode, or an auth scheme outside the four the generator itself configures — all of
 * which an arbitrary uploaded collection may legitimately use.
 */
export interface PostmanRawItem {
  id?: string;
  name: string;
  request: PostmanRawRequest;
  event?: PostmanRawEvent[];
}
