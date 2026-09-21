# API Contract: External Collection Import & Execution

Standalone route family, mounted independently of `/api/test-generation-workflow/*`
(FR-011 — no active `TestGenerationWorkflow` is required for any endpoint below). Session-scoped
exactly like `/api/test-generation-workflow/environments` (specs/017).

## `POST /api/external-collections`

Uploads one collection + environment pair (FR-001, `multipart/form-data`, mirrors the existing
OpenAPI-upload route's use of `multer`).

**Request** (`multipart/form-data`):
- `name` (string, required) — must be unique within the session.
- `tier` (string, required) — one of `local | dev | qa | staging | production`.
- `collection` (file, required) — Postman Collection v2.1 JSON, ≤ `MAX_UPLOAD_BYTES` (10 MB).
- `environment` (file, required) — Postman Environment JSON, ≤ `MAX_UPLOAD_BYTES`.
- `requestDelayMs` (number, optional, default `0`).

**201 Created** — `{ "uploadedCollection": { "id": "...", "name": "...", "tier": "local", "requestDelayMs": 0, "createdAt": "..." } }` (never includes `variableValues` or the raw collection body in the response — mirrors `Environment`'s own create response never echoing `variableValues` back either).

**400 `invalid_collection`** — malformed/empty Postman Collection JSON (FR-002).

**400 `invalid_environment`** — malformed Postman Environment JSON (FR-003).

**409 `duplicate_name`** — `name` already used by another `UploadedCollectionSet` in this session (FR-016).

**413 `file_too_large`** — either file exceeds `MAX_UPLOAD_BYTES` (FR-012).

## `GET /api/external-collections`

Lists the session's uploaded collections (FR-016), newest first, never including
`variableValues` or the raw collection body.

**200 OK** — `{ "uploadedCollections": [ { "id": "...", "name": "...", "tier": "staging", "requestDelayMs": 0, "createdAt": "..." } ] }`

## `DELETE /api/external-collections/:id`

Removes an uploaded collection/environment pair (FR-017). Past runs recorded against it are
unaffected — they retain their own `uploadedCollectionSnapshot`.

**204 No Content**

**404 `uploaded_collection_not_found`**

## `POST /api/external-collections/:id/execution/start`

Starts a run (FR-005). Two independent confirmation gates apply, checked in this order, each
requiring its own `confirmed: true` resubmission — mirrors `execution/start`'s existing
`confirmation_required` pattern but adds the FR-007 gate ahead of it:

1. **Unverified-content gate (FR-007)** — applies only while `UploadedCollectionSet.confirmedAt`
   is unset (i.e., this collection has never been run before). Accepting it sets `confirmedAt`
   permanently for this artifact (spec.md Assumptions: required once per upload, not once per
   run).
2. **Risk-tier gate (FR-013)** — the same staging/production/destructive-operation gate
   `execution/start` already has, evaluated against this request's own POST/PUT/PATCH/DELETE
   items (research.md D3) instead of `ApiModel` operations. Evaluated every run start, exactly
   like the existing generated-collection behavior.

**Request**: `{ "confirmed": boolean, "selectedRequestIds"?: string[] }`

`selectedRequestIds` is optional (AP-028 follow-up, Postman-Runner-style selective run). Omitting
it runs every request in the collection, exactly as before this field existed. When present, only
items whose id is in the array actually dispatch — everything else is skipped entirely (it never
appears in `results`, not even as `"not-attempted"`), and both confirmation gates plus the
`missing_variable_values` check are evaluated against only the selected subset.

**200 OK** — `{ "run": { "...": "...", "source": "uploaded", "results": [] } }`

**400 `no_requests_selected`** — `selectedRequestIds` was provided but matched none of the
collection's current items.

**409 `execution_in_progress`** — a run of *either* kind (generated or uploaded) is already in
progress in this session (FR-015, research.md D7). Carries `runId` exactly like the existing
error shape.

**409 `unverified_content_confirmation_required`** — gate 1 above is unmet.
`{ "error": "unverified_content_confirmation_required", "message": "..." }`

**409 `confirmation_required`** — gate 2 above is unmet (identical shape to
`contracts/execution-api.md`'s existing entry: `environmentTier`, `destructiveOperations`, but
`destructiveOperations` here is derived from the collection's own requests).

**400 `missing_variable_values`** — identical shape to the existing entry, naming which
variable(s) the uploaded environment does not supply (FR-004).

**404 `uploaded_collection_not_found`**

## `POST /api/external-collections/:id/execution/cancel`

Identical semantics to `execution/cancel` (FR-014): already-attempted results are kept, remaining
requests are marked `not-attempted`/`"cancelled"`.

**202 Accepted** — `{ "run": { "...": "..." } }`

**409 `no_run_in_progress`**

## `GET /api/external-collections/:id/execution/runs`

Lists this uploaded collection's run history (summaries only, no `results`), newest first.

**200 OK** — `{ "runs": [ { "id": "...", "source": "uploaded", "uploadedCollectionSnapshot": { "name": "...", "tier": "..." }, "status": "completed", "summary": { "total": 5, "passed": 5, "failed": 0, "notAttempted": 0, "durationMs": 812 } } ] }`

## `GET /api/external-collections/:id/execution/runs/:runId`

Full run detail, including every `UploadedRequestResult` (FR-006).

**200 OK** — `{ "run": { "...": "...", "results": [ { "requestName": "...", "requestMethod": "GET", "outcome": "failed", "failureCategory": "assertion-failed", "durationMs": 214, "responseStatusCode": 500, "testOutcomes": [ { "name": "Status code is 200", "outcome": "failed", "detail": "expected 200, got 500" } ] } ] } }`

**404 `run_not_found`**
