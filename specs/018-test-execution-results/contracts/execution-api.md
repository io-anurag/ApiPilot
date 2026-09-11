# Contract: Test Execution & Results API

An additive extension of `specs/009-e2e-test-generation-workflow/contracts/test-generation-
workflow-api.md`, hung off the same session (`specs/017-session-workflow-isolation`) and the
same router (`backend/src/api/testGenerationWorkflow.ts`), following its existing conventions
(structured `{ error, message }` bodies on failure; `workflow`-shaped success bodies where the
route already returns the workflow). Every endpoint below requires the calling session's
`postmanGeneration` stage to be `complete`; otherwise every one of them responds identically to
the existing pattern: `409 { error: "stage_not_active", message: "..." }`.

## Environments

### `GET /api/test-generation-workflow/environments`

Lists the calling session's defined environments (research.md D3's sibling store — not part of
the `workflow` response body).

**200 OK**

```json
{ "environments": [ { "id": "...", "name": "Local", "tier": "local", "baseUrl": "...", "variableValues": { "token": "..." }, "requestDelayMs": 0 } ] }
```

### `POST /api/test-generation-workflow/environments`

Defines a new environment (FR-001, FR-002).

**Request**

```json
{ "name": "Staging", "tier": "staging", "baseUrl": "https://staging.example.com", "variableValues": { "token": "..." }, "requestDelayMs": 250 }
```

**200 OK** — `{ "environment": { "id": "...", ... } }`

**400 `invalid_request`** — missing/invalid `name`, `tier`, or `baseUrl`.

**409 `duplicate_environment_name`** — `name` collides with an existing environment in this
session (FR-003 depends on names being distinguishable).

### `PUT /api/test-generation-workflow/environments/:environmentId`

Updates an existing environment's fields (full replacement of `baseUrl`/`variableValues`/
`requestDelayMs`/`tier`; `name` may also change, subject to the same uniqueness check).

**200 OK** — `{ "environment": { ... } }`

**404 `environment_not_found`**

## Execution

### `POST /api/test-generation-workflow/execution/start`

Starts a new execution run against a selected environment (FR-006). Returns as soon as the run
is registered — it does not wait for the run to finish (research.md D4); poll `GET .../execution/
runs/:runId` for progress and the eventual terminal state.

**Request**

```json
{ "environmentId": "...", "confirmed": false }
```

`confirmed` is optional and defaults to `false`; it only has any effect when the confirmation
requirement below applies.

**200 OK**

```json
{ "run": { "id": "...", "workflowId": "...", "environmentId": "...", "environmentSnapshot": { "name": "Staging", "tier": "staging", "baseUrl": "..." }, "status": "in-progress", "startedAt": "...", "summary": { "total": 42, "passed": 0, "failed": 0, "notAttempted": 0, "durationMs": 0 }, "results": [] } }
```

**400 `environment_not_found`**

**400 `missing_variable_values`** (FR-004)

```json
{ "error": "missing_variable_values", "message": "...", "missing": ["apiKey", "tenantId"] }
```

**409 `confirmation_required`** (FR-007) — returned when the selected environment's tier is
`staging`/`production`, or the approved collection contains at least one destructive
(`POST`/`PUT`/`PATCH`/`DELETE`) request, and the request body did not carry `"confirmed": true`:

```json
{
  "error": "confirmation_required",
  "message": "...",
  "environmentTier": "staging",
  "destructiveOperations": [{ "operationPath": "/widgets/{id}", "operationMethod": "DELETE" }]
}
```

The client resubmits the same request with `"confirmed": true` once the user completes the
confirmation step; the run then starts exactly as the plain success case above.

**409 `execution_in_progress`** (FR-008) — a run is already in progress for this session:

```json
{ "error": "execution_in_progress", "message": "...", "runId": "..." }
```

**409 `empty_approved_test_model`** — mirrors the existing Postman-generation refusal; there is
nothing to execute.

### `POST /api/test-generation-workflow/execution/cancel`

Cancels the session's in-progress run (FR-015). Mirrors the existing `ai-enhancement/cancel`
convention: `202` because cancellation is accepted, not completed instantly — the in-flight
request (research.md D6) finishes, then the run settles as `cancelled`, observable via the
existing poll.

**202 Accepted** — `{ "run": { "...": "...", "status": "in-progress" } }` (still in-progress at
the moment of response; poll for the eventual `"cancelled"` terminal state)

**409 `no_run_in_progress`**

### `GET /api/test-generation-workflow/execution/runs`

Lists the session's execution run history (FR-019/FR-020), summaries only (no `results`), newest
first.

**200 OK**

```json
{ "runs": [ { "id": "...", "environmentSnapshot": { "name": "Local", "tier": "local", "baseUrl": "..." }, "status": "completed", "startedAt": "...", "completedAt": "...", "summary": { "total": 42, "passed": 40, "failed": 2, "notAttempted": 0, "durationMs": 8123 } } ] }
```

### `GET /api/test-generation-workflow/execution/runs/:runId`

Full detail for one run, including every `RequestResult` (FR-014/FR-016). Filtering to failures
(FR-021) is a client-side concern over this same full list — there is no server-side filter
parameter.

**200 OK** — `{ "run": { "...": "...", "results": [ { "scenarioId": "...", "operationPath": "...", "operationMethod": "...", "outcome": "failed", "failureCategory": "assertion-failed", "durationMs": 214, "responseStatusCode": 500, "assertionOutcomes": [ { "assertionIndex": 0, "type": "status-code", "outcome": "failed", "detail": "expected 201, got 500" } ] } ] } }`

**404 `run_not_found`**
