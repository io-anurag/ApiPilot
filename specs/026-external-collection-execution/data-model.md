# Phase 1 Data Model: External Postman Collection Import & Execution

All new types are added to a new shared-domain file, `packages/shared-domain/src/
externalCollections.ts`, framework-agnostic per constitution X. Nothing here modifies an
existing AP-017 (specs/018) type — `Environment`, `ExecutionRun`, `RequestResult`,
`AssertionOutcome`, and `RawRequestCapture` remain exactly as shipped (research.md D7/D8).

## `UploadedCollectionSet`

The stored, session-scoped representation of one uploaded collection + environment pair
(FR-001, FR-016, FR-017).

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `crypto.randomUUID()`. |
| `name` | `string` | User-supplied, unique within the session (FR-016) — mirrors `Environment.name`'s own uniqueness rule; enforced the same way (`UNIQUE (session_id, name)`). |
| `tier` | `EnvironmentTier` (reused from execution.ts) | User-declared (FR-013) — same `local \| dev \| qa \| staging \| production` vocabulary. |
| `collection` | `string` (raw JSON, as uploaded) | The uploaded Postman Collection v2.1 document, stored verbatim. Parsed into a `postman-collection` `Collection` instance and walked via `forEachItem()` into `PostmanRawItem[]` (`externalCollections.ts`, research.md D6) at read/run time by `uploadedCollectionParsing.ts`/`runUploadedCollectionExecution.ts` rather than pre-normalized and persisted — the artifact of record is what the user actually uploaded. |
| `variableValues` | `Record<string, string>` | From the uploaded environment file's `values` array. Encrypted at rest (FR-009), same mechanism as `Environment.variableValues` (research.md D4). |
| `requestDelayMs` | `number` | Mirrors `Environment.requestDelayMs`; `0` (no pause) by default. |
| `confirmedAt` | `string?` (ISO 8601) | Set once the FR-007 "unverified content" confirmation has been accepted for this artifact. Absent means the next run-start request must re-surface that confirmation (spec.md Assumptions: required once per upload, not once per run). |
| `createdAt` | `string` (ISO 8601) | |

Session-scoped exactly like `Environment` (specs/017/025): removed when the owning session is
idle-evicted, durably persisted (encrypted `variableValues`) for as long as the session remains
active.

## `UploadedRequestResult`

One executed (or not-attempted) request within an `UploadedCollectionExecutionRun` — structurally
parallel to `RequestResult` (FR-016) but without a `TestScenario` to report against (research.md
D6/D8).

| Field | Type | Notes |
|---|---|---|
| `requestName` | `string` | The Postman item's own `name` — there is no `operationPath`/`operationMethod` derived from an OpenAPI operation to report instead. |
| `requestMethod` | `string` | The request's own HTTP method, read directly off the collection item (always present in Postman Collection JSON, unlike `operationMethod` which AP-017 derives from `ApiModel`). |
| `outcome` | `"passed" \| "failed" \| "not-attempted"` | Same three values as `RequestResult.outcome`. |
| `failureCategory` | `"connectivity-failure" \| "timeout" \| "assertion-failed"?` | A **smaller** set than `RequestResult`'s `FailureCategory` — `"unexpected-status"` and `"could-not-evaluate"` do not apply: those distinctions require knowing an assertion's *type* (`"status-code"` vs. `"schema-conformance"`), which an uploaded collection's arbitrary named test never declares (research.md D6). Every assertion failure an uploaded run produces is reported as `"assertion-failed"`, naming which test(s) failed in `testOutcomes` below — never guessed into a more specific category the collection didn't declare (constitution I, XIV). |
| `notAttemptedReason` | `NotAttemptedReason?` (reused) | Only `"cancelled"` and `"run-ended-before-reached"` are reachable — `"dependency-not-met"` does not apply (no dependency/workflow chaining exists for uploaded collections; out of this feature's scope). |
| `startedAt` | `string` (ISO 8601) | |
| `durationMs` | `number` | `0` for `not-attempted`. |
| `responseStatusCode` | `number?` | Same semantics as `RequestResult.responseStatusCode`. |
| `testOutcomes` | `Array<{ name: string; outcome: "passed" \| "failed"; detail?: string }>` | One entry per test Newman actually ran for this request, named exactly as the collection's own script named it. `detail` is the test's failure message, redacted by the same `redactIfSensitive()` helper `mapNewmanResult.ts` already uses (research.md D6) — never a raw response body. Empty for `not-attempted`. |
| `rawCapture` | `RawRequestCapture?` (reused, unchanged) | Same FR-017a gating: present only when the run's tier is `"local"`. Uploaded runs get identical treatment to generated ones — no special-casing needed since the type and its encryption-at-rest handling are source-agnostic. |

## `UploadedCollectionExecutionRun`

One execution of an `UploadedCollectionSet` (FR-005 onward) — structurally parallel to
`ExecutionRun`, stored and gated separately (research.md D7), never merged into the same table.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `source` | `"uploaded"` (literal) | Discriminant (research.md D8) — lets a future unified run-history view (FR-010, US3) tell this apart from a `source: "generated"`-tagged `ExecutionRun` (a same-shaped literal added to `ExecutionRun` alongside this feature, additive, non-breaking). |
| `uploadedCollectionSetId` | `string` | The originating `UploadedCollectionSet.id` — not a live reference (mirrors `ExecutionRun.workflowId`'s own "traceability, not live reference" rule). |
| `uploadedCollectionSnapshot` | `{ name: string; tier: EnvironmentTier }` | Captured at start time — mirrors `ExecutionRun.environmentSnapshot`'s "must remain meaningful even if the source is later edited/removed" rule (FR-017). Excludes `variableValues` — never persisted into a run record, same as `environmentSnapshot`. |
| `status` | `ExecutionRunStatus` (reused) | |
| `startedAt` / `completedAt` | `string` (ISO 8601) | Same semantics as `ExecutionRun`. |
| `summary` | `ExecutionRunSummary` (reused, unchanged shape) | Recomputed from `results` exactly as `ExecutionRun.summary` is. |
| `results` | `UploadedRequestResult[]` | Appended in execution order as each item settles — same growing-prefix semantics as `ExecutionRun.results`. |
| `cancelRequested` | `boolean` | |
| `cancelReason` | `"user-requested" \| "backend-restart"?` | Same semantics as `ExecutionRun.cancelReason`. |

## Validation rules (FR-002, FR-003, FR-004)

- **Collection well-formedness (FR-002)**: the uploaded JSON must construct a valid
  `postman-collection` `Collection` and contain at least one request item (directly or nested in
  folders) — an empty collection is refused with a specific error rather than accepted as a
  trivial success.
- **Environment well-formedness (FR-003)**: the uploaded JSON must have a `values` array whose
  entries each have a string `key` and `value` (an absent/non-string `value` for an `enabled`
  entry is refused).
- **Variable completeness (FR-004)**: `uploadedCollectionParsing.ts` recursively scans every
  request's URL, headers, and body for `{{variableName}}` references (the same token syntax
  ApiPilot's own generated collections already use) to build the referenced-variable list, then
  reuses `execution/variableCompleteness.ts`'s existing `missingVariableValues()` against the
  uploaded environment's `values` — no new "which variables does this need" logic is invented
  beyond the extraction step itself, which the uploaded case needs and the generated case does
  not (a generated collection already carries its own declared-variables list from
  `generateCollection()`'s output).

## Selective run (spec.md FR-018, post-implementation addendum)

`POST /:id/execution/start`'s request body gains one optional field, additive to the existing
`{ confirmed: boolean }` shape:

```ts
interface ExecutionStartRequest {
  confirmed: boolean;
  selectedRequestIds?: string[]; // omitted = every request runs, unchanged from before this field existed
}
```

Three functions gain an optional `selectedItemIds?: Set<string>` parameter, each filtering to only
the given item ids when it's provided (undefined behaves exactly as before):

- `extractReferencedVariables(collection, selectedItemIds?)` (`uploadedCollectionParsing.ts`) — the
  FR-004 missing-variable-values check.
- `findDestructiveRequests(collection, selectedItemIds?)` (`destructiveRequests.ts`) — feeds the
  FR-013 risk-tier confirmation gate.
- `runUploadedCollectionExecution({ runId, uploadedCollection, selectedItemIds? })` — an item not
  in the set is skipped inside the `Collection.forEachItem()` walk (FR-005's original document-order
  walk is otherwise unchanged) and never produces a `UploadedRequestResult`, not even
  `"not-attempted"`.

**Validation**: when `selectedRequestIds` is provided but matches none of the collection's current
item ids, the route returns `400 no_requests_selected` before either confirmation gate or the
missing-variable check runs.

## Persistence

One new table, `uploaded_collections`, added to `backend/src/persistence/connection.ts`'s schema
(and via the same `ensureColumn`-style migration guard used for FR-017a's columns, for an
existing on-disk database):

```sql
CREATE TABLE IF NOT EXISTS uploaded_collections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  collection TEXT NOT NULL,
  variable_values_encrypted BLOB NOT NULL,
  variable_values_iv BLOB NOT NULL,
  request_delay_ms INTEGER NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, name)
);

CREATE TABLE IF NOT EXISTS uploaded_collection_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  uploaded_collection_set_id TEXT NOT NULL,
  uploaded_collection_snapshot TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  results TEXT NOT NULL,
  raw_captures_encrypted BLOB,
  raw_captures_iv BLOB,
  cancel_requested INTEGER NOT NULL,
  cancel_reason TEXT
);
```

`uploaded_collection_runs` mirrors `execution_runs`' own shape (including the FR-017a raw-capture
columns) exactly, kept as a separate table per research.md D7 rather than merged with
`execution_runs`.
