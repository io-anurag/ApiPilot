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
  /**
   * `true` only when the executed item carried the `_apipilotEdited` marker (AP-028 research.md
   * D6) — absent, not `false`, for a never-edited item, so a pre-AP-028 stored run's serialized
   * shape is unaffected.
   */
  wasEdited?: boolean;
  /**
   * The executed Postman item's own `id` (AP-031, specs/030-ai-failure-analysis FR-017). Links a
   * result back to the item that produced it, including a generated item's content-derived id.
   * Absent on results stored before AP-031, which remain valid.
   */
  itemId?: string;
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

/**
 * AP-028 (specs/028-collection-editor-ui) — the Postman-style collection browser/editor's read
 * model, computed on demand from a stored `UploadedCollectionSet` (data-model.md), never itself
 * persisted.
 */

/** One request's method/URL/headers/body, either exactly as stored or with variables substituted. */
export interface CollectionRequestFields {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
}

/**
 * A header this request's (or an inherited folder/collection-level) `auth` block adds
 * automatically at execution time — computed for display only, never merged into `raw`/`resolved`
 * headers, since it is not a literal, editable header entry (contradicting it would misrepresent
 * what an edit actually changes). Present only for the auth types whose header value is a plain,
 * lossless key/value pair (`bearer`, `apikey` located in a header) — every other type (`basic`,
 * `digest`, `oauth1`/`oauth2`, `awsv4`, `hawk`, `ntlm`, `edgegrid`) either transforms its
 * parameters (e.g. base64 encoding) in a way that would obscure unresolved `{{variable}}`
 * placeholders in `raw`, or is dynamic/signed and cannot be represented as a fixed value ahead of
 * time without fabricating it (CLAUDE.md §13).
 */
export interface ImpliedAuthHeader {
  key: string;
  /** Exactly as stored — `{{variable}}` placeholders intact, mirroring `raw`. */
  rawValue: string;
  /** `rawValue` with every resolvable `{{variable}}` substituted, mirroring `resolved`. */
  resolvedValue: string;
}

/** One request within a `CollectionView` (research.md D2, D9; data-model.md). */
export interface CollectionRequestView {
  /** Stable across reads of the same `UploadedCollectionSet` (research.md D2). */
  id: string;
  name: string;
  /** `true` only when this request carries the `_apipilotEdited` marker (research.md D4). */
  wasEdited: boolean;
  /** Exactly as stored — `{{variable}}` placeholders intact (FR-002). */
  raw: CollectionRequestFields;
  /** `raw` with every resolvable `{{variable}}` substituted (FR-002, research.md D3). */
  resolved: CollectionRequestFields;
  /** Variable names referenced by this specific request that remain unresolved. */
  unresolvedVariables: string[];
  /** See `ImpliedAuthHeader`. `undefined` when no auth applies to this request, or when its
   * applicable type's header cannot be represented here. */
  impliedAuthHeader?: ImpliedAuthHeader;
  /**
   * The request's own Postman "test" event script, exactly as stored (its `pm.test(...)` calls
   * are what `UploadedTestOutcome.name` in a run result is named after). Undefined/empty when the
   * item carries no test event. Editable like every other raw field (FR-007) — there is no
   * "resolved" counterpart, since the script runs against the live response at execution time
   * rather than being substituted for display.
   */
  testScript?: string;
  /** The request's effective auth and where it comes from (FR-002a). `undefined` when no auth
   * applies anywhere in its chain. */
  auth?: RequestAuthView;
  /** Every variable this request uses in its URL, headers, body or effective auth, by name (FR-002b). */
  variableReferences: RequestVariableReference[];
  /** Folders whose scripts this request carries a copy of from an earlier move (FR-015b). */
  copiedScriptFolderIds: string[];
}

/** Where a request's effective auth is defined (FR-002a). */
export type RequestAuthSource =
  | { kind: "request" }
  | { kind: "folder"; folderId: string; folderName: string }
  | { kind: "collection" };

/**
 * A request's effective auth for display (FR-002a, read-only). `fields` are as stored, with
 * `{{variable}}` references intact. A secret field holding a literal is never sent to the browser:
 * its `value` is empty and `hiddenLiteral` is `true` (data-model.md lists the secret field keys).
 */
export interface RequestAuthView {
  /** The Postman auth type as stored, e.g. `bearer`, `basic`, `oauth2`, `noauth`. */
  type: string;
  source: RequestAuthSource;
  fields: Array<{ key: string; value: string; hiddenLiteral: boolean }>;
}

/** One variable a request uses (FR-002b). `resolved` and `source` follow the collection's `VariableBinding`. */
export interface RequestVariableReference {
  name: string;
  usedIn: Array<"url" | "headers" | "body" | "auth">;
  resolved: boolean;
  /** The binding that provides the value; absent when the variable is missing. */
  source?: VariableBinding["source"];
}

/** What a move carried onto the moved item (FR-015b); the move route's `carried` field. */
export interface MoveCarried {
  /** `null` when no auth was written onto the item. `fromFolderName` is `null` for collection-level
   * auth, and `type` is `noauth` when the item had none before the move. */
  auth: { type: string; fromFolderName: string | null } | null;
  scriptsFromFolders: Array<{ id: string; name: string; events: Array<"prerequest" | "test"> }>;
}

/** One folder within a `CollectionView` (research.md D9) — arbitrary nesting depth. */
export interface CollectionFolderView {
  /** Stable across reads of the same `UploadedCollectionSet` (research.md D2, D9). */
  id: string;
  name: string;
  items: CollectionRequestView[];
  folders: CollectionFolderView[];
  /** Script kinds this folder itself defines, which run for everything inside it (FR-015b). */
  scriptEvents: Array<"prerequest" | "test">;
  /** Folders whose scripts this folder carries a copy of from an earlier move (FR-015b). */
  copiedScriptFolderIds: string[];
}

/**
 * A variable available to a loaded collection — either discovered by reference or user-defined
 * ahead of use (FR-018). `source` has exactly two persisted tiers (research.md D8); a
 * client-side-only "override" label is derived by the frontend, not carried here.
 */
export interface VariableBinding {
  name: string;
  value?: string;
  source: "collection-default" | "environment";
  resolved: boolean;
  /** `false` for a user-defined variable (FR-018) no request currently references. */
  referenced: boolean;
}

/**
 * The full read model for one loaded collection (data-model.md `CollectionView`). `items`/
 * `folders` mirror `CollectionFolderView`'s own shape at the collection root — the root itself is
 * never a folder with its own `id` (it has none in the Postman format), matching the API
 * contract's `containerId: "root"` literal rather than a synthesized folder id.
 */
export interface CollectionView {
  id: string;
  items: CollectionRequestView[];
  folders: CollectionFolderView[];
  variables: VariableBinding[];
}
