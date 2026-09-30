# Contract: Quick Performance Test API (AP-032)

**Base path**: `/api/quick-performance`. Every route is scoped to the calling session through the
existing `sessionId` cookie. Routes never read or change the session's guided workflow (FR-021).

**Conventions**, the same as AP-029's
[performance-api.md](../../031-k6-performance-testing/contracts/performance-api.md):
- Errors are `{error: "<snake_code>", message: "<plain text>"}`.
- An unexpected error is `500 {error: "internal_server_error"}`, with no message or stack.
- No response contains an environment value, token, resolved URL, the script text (outside the
  download), or the k6 binary path.

Types are defined in [data-model.md](../data-model.md) and AP-029's data model.

**Gating**: every route below except `POST /`, `GET /readiness`, `GET /runs/:runId`,
`POST /runs/:runId/cancel` and `GET /runs/:runId/report` returns `404 quick_test_not_found` when
the session has no quick test. A run already started stays visible, cancellable and reportable
after its quick test is replaced or lost.

## Quick test

### `POST /`

Multipart form with the specification under `file`, as `POST /api/test-generation-workflow`.
Query: `replaceExisting=true` to replace the session's quick test.

Processing: the existing upload limit, then `parseYaml`, `validateSpec` and `buildApiModel`
unchanged (FR-002); positive scenarios only (FR-004); the plan with `source: "quick"`, every
operation in scope (FR-003), each as a single-step journey (FR-006), and credential producers
initially removed (FR-003a). Nothing is stored unless every step succeeds.

**Success:** `200 {quickTest: QuickPerformanceTestView}` with `script: null`. A specification with
no operation that has a positive scenario still succeeds, with no journeys and every operation in
`plan.omitted` (spec Edge Cases).

**Errors** (the same status and body as the guided upload for the same input):
- `400 invalid_yaml`: no file under `file`, or a document that is not valid YAML.
- `400 unsupported_version`: not OpenAPI 3.x, including Swagger 2.0.
- `413 file_too_large`: over the existing upload limit.
- `409 quick_test_exists`: the session has a quick test and `replaceExisting` is not `true`
  (FR-021). Nothing changes.

Replacing keeps every run and report (FR-021). It does not affect a run in progress.

### `GET /`

**Success:** `200 {quickTest: QuickPerformanceTestView}`. It has no side effect.

**Error:** `404 quick_test_not_found`.

## Plan and script

> **Changed by AP-033 (2026-09-29).** On both paths, `PUT /plan` accepts `bodyEdits`, and the step
> preview (`GET /plan/steps/:stepId/request`, and the removed-operation preview) gains `bodyStatus`
> and `bodyEdit`. The request body is no longer view only. See
> [specs/033-edit-step-request-body/contracts/](../../033-edit-step-request-body/contracts/).

These routes have the same request bodies, validation, errors and responses as AP-029's routes of
the same name, applied to the quick plan. Only the differences are listed.

| Route | Difference from AP-029 |
|---|---|
| `GET /plan` | No stage transition. The plan is never rebuilt from upstream changes, because a quick test's scenarios are fixed at upload. |
| `PUT /plan` | `scope` is rejected with `400 invalid_request`, as on the guided path. |
| `POST /plan/reset` | Rebuilds from the stored scenarios, keeping the load profile, thresholds, exclusions and expected statuses of steps that still exist. |
| `GET /plan/values?environmentId=` | None. |
| `GET /plan/steps/:stepId/request` | New on both paths (below). |
| `GET /plan/removed-operation?operationKey=` | New on both paths (below), 2026-09-28. |
| `POST /script` | No stage transition. |
| `GET /script/download?file=script\|environment-template` | None. Two quick tests from the same specification with the same edits give byte-identical files (FR-007, SC-004). |

`409 postman_generation_incomplete` never occurs on these routes; `404 quick_test_not_found`
takes its place.

### `GET /plan/steps/:stepId/request` (both paths)

Also added at `/api/test-generation-workflow/performance/plan/steps/:stepId/request`, with that
path's gate (FR-012a).

**Success:** `200 {request: StepRequestPreview}`. It is view-only, derived from the same step
request the script sends, and never contains a value from an environment (FR-008).

**Errors:**
- `404 step_not_found`: the step is not in the current plan.
- `404 quick_test_not_found` (quick path) or `409 postman_generation_incomplete` (guided path).

### `GET /plan/removed-operation?operationKey=<key>` (both paths)

Added 2026-09-28 (FR-024a). Also at
`/api/test-generation-workflow/performance/plan/removed-operation`, with that path's gate. The
operation key (`"METHOD /path"`) is a query parameter, URL-encoded, because it holds a space and
a path template.

The server rebuilds the plan with the operation restored, through the same update a Restore sends
(`PUT /plan` with the key left out of `excludedOperationKeys`), reads it, and discards it. The
stored plan, its fingerprint and the script status are unchanged, so the response always matches
what Restore would produce. When the operation would be in more than one journey (guided
workflows), its first step is returned.

**Success:** `200 {step: PerformanceStep, request: StepRequestPreview}` (`RemovedOperationPreview`
in shared-domain). `request` follows the same rules as the step request preview: view-only, never a
value from an environment (FR-008).

**Errors:**
- `400 invalid_request`: no `operationKey`.
- `404 operation_not_removed`: the key is not in the plan's `excludedOperationKeys`.
- `409 no_positive_scenario`: restoring the operation would add no step.
- `404 quick_test_not_found` (quick path) or `409 postman_generation_incomplete` (guided path).

## Readiness and runs

`GET /readiness`, `POST /runs`, `GET /runs`, `GET /runs/:runId`, `POST /runs/:runId/cancel` and
`GET /runs/:runId/report` behave as AP-029 defines them (FR-020), with these differences.

### `POST /runs`

Body: `{"environmentId": "<id>"}`. It is the only way a quick run starts (constitution XVII
exception, extended 2026-09-27).

The checks run in this order, and the first one that fails is returned:

| # | Check | Response |
|---|---|---|
| 1 | The session has a quick test | `404 quick_test_not_found` |
| 2 | A script exists and is current | `409 script_not_generated`, `409 script_out_of_date` |
| 3 | k6 is ready (probed now) | `409 k6_unavailable {readiness}` |
| 4 | The environment exists | `404 environment_not_found` |
| 5 | No execution is in progress in the session: guided functional, uploaded collection, or performance from either path | `409 execution_in_progress {runId}` (FR-020, US3 AS4) |

**Success:** `200 {run: PerformanceRun}` with `status: "in-progress"` and `planSource: "quick"`.
There is no confirmation step on any tier (spec Assumptions).

### `GET /runs`

`200 {runs: PerformanceRunSummary[]}`, newest first, only runs with `planSource: "quick"`.

### `GET /runs/:runId`, `POST /runs/:runId/cancel`, `GET /runs/:runId/report`

Any performance run of the session, whichever path started it. The report of a quick run states
that the plan came from the quick path with generated, unreviewed scenarios (FR-013).
