# Contract: Performance Testing API (AP-029)

**Base path**: `/api/test-generation-workflow/performance`. Every route is session-scoped through the
existing `sessionId` cookie and operates on that session's guided workflow. There is no workflow
id in any path.

**Conventions**, the same as `/execution/...`:
- Errors are `{error: "<snake_code>", message: "<plain text>"}`.
- An unexpected error is `500 {error: "internal_server_error"}`, with no message or stack.
- No response ever contains a variable value, token, body, resolved URL, or the k6 binary path.

Types are defined in [data-model.md](../data-model.md).

## Readiness

### `GET /readiness`

`200 {readiness: K6Readiness}`. `?recheck=true` re-probes and ignores the cache (research D9).

## Plan

### `GET /plan`

- `200 {plan: PerformancePlan, script: ScriptStatus | null}`. It builds the proposed plan on
  first call (FR-006), from the approved test model and approved workflows.
- `409 workflow_review_incomplete` when `workflowReview` is not `completed`.

`ScriptStatus = {planFingerprint, scriptSha256, stepCount, outOfDate: boolean}`.

### `PUT /plan`

The body holds any subset of the following fields; the fields not sent are unchanged:

```json
{
  "scope": "selection | all",
  "excludedOperationKeys": ["POST /orders"],
  "journeyOrder": ["<journeyId>", "..."],
  "stepOrder": { "<journeyId>": ["<stepId>", "..."] },
  "thinkTimeMs": 2000,
  "loadProfile": { "kind": "load", "stages": [{ "durationMs": 120000, "targetVirtualUsers": 10 }] },
  "thresholds": [{ "scope": { "kind": "run" }, "metric": "p95", "comparator": "<=", "limit": 500 }],
  "expectedStatuses": { "<stepId>": ["200", "201"] }
}
```

`expectedStatuses` replaces the lists of the steps it names. Other steps keep theirs. The client
sends codes only. The server computes each code's `source` (FR-012, FR-039, research D26).

**Success:** `200 {plan, script}`. When the fingerprint changed, `script.outOfDate` is `true`.
`plan.stepsNeedingExpectedStatus` lists the steps that still need an expected status (FR-012a).

**Errors:**
- `400 dependency_order_violation {variable, producerStepId, consumerStepId}`. The plan is
  unchanged (FR-007).
- `400 invalid_order`
- `400 invalid_load_profile`
- `400 invalid_threshold`
- `400 invalid_expected_status {stepId}`: an unknown step, an empty list, or a code that is not
  `^[1-5]\d\d$` or `^[1-5]XX$`. The plan is unchanged.
- `400 unknown_operation`
- `409 workflow_review_incomplete`

### `POST /plan/reset`

`200 {plan, script}`. It rebuilds the proposed plan from the current approvals, keeping the load
profile, the thresholds, and the expected statuses of steps that still exist (research D26).

### `GET /plan/values?environmentId=<id>`

**Success:** `200 {environment: {id, name, tier, baseUrl}, values: UserSuppliedValueStatus[]}`.
Presence is only ever a boolean (FR-013).

**Errors:**
- `404 environment_not_found`
- `409 workflow_review_incomplete`

The values themselves are edited through the existing `PUT
/api/test-generation-workflow/environments/:environmentId`. This feature adds no value-writing
route.

## Script

### `POST /script`

Generates the script and environment template from the current plan (FR-020).

**Success:** `200 {script: ScriptStatus}`. Generating twice from the same plan gives the same
`scriptSha256` (SC-001).

**Errors:**
- `409 workflow_review_incomplete`
- `422 nothing_to_test`, when the plan has no steps.
- `422 expected_status_missing {stepIds}`, when any step has no expected status. `stepIds` is in
  plan order. Nothing is generated (FR-012a). A missing user-supplied value does not cause this
  error (FR-014).

### `GET /script/download?file=script|environment-template`

**Success:** `200` with the file.
- `file=script` is `text/javascript; charset=utf-8`, sent with `Content-Disposition: attachment;
  filename="apipilot-performance.js"`.
- `file=environment-template` is `application/json`: variable names with empty values, and the
  base URL key.

**Errors:**
- `404 script_not_generated`
- `409 script_out_of_date`

Neither file contains a value (FR-021).

## Runs

### `POST /runs`

Body: `{"environmentId": "<id>"}`. This route is the only way a run starts (FR-024, constitution
XVII exception of 2026-09-24).

The checks run in this order, and the first one that fails is returned:

| # | Check | Response |
|---|---|---|
| 1 | The workflow review is complete | `409 workflow_review_incomplete` |
| 2 | A script exists and is current | `409 script_not_generated`, `409 script_out_of_date` (FR-023) |
| 3 | k6 is ready (probed now) | `409 k6_unavailable {readiness}` (FR-027) |
| 4 | The environment exists | `404 environment_not_found` |
| 5 | No execution is in progress in the session, whether guided, uploaded or performance | `409 execution_in_progress {runId}` (FR-029) |

**Success:** `200 {run: PerformanceRun}` with `status: "in-progress"`. The run proceeds in the
background (fire-and-poll).

There is no confirmation step for any tier (FR-025). A missing user-supplied value does not block
the run (FR-014). If the script file on disk does not match `scriptSha256`, the run settles
`failed` with `script-integrity-failed`, and k6 is never spawned (research D8).

### `GET /runs`

`200 {runs: PerformanceRunSummary[]}`, newest first. A summary has no `result` and no
`planSnapshot`.

### `GET /runs/:runId`

**Success:** `200 {run: PerformanceRun}`. It includes `progress` while in progress (FR-030) and
`result` once the run has settled. Poll every 2 seconds; SC-007 requires a refresh at least every
5 seconds.

**Error:** `404 run_not_found`.

### `POST /runs/:runId/cancel`

**Success:** `202 {run}` with `cancelRequested: true`. Load generation stops within 10 seconds
(SC-008), and the run settles `cancelled`, keeping its partial results (FR-031).

**Errors:**
- `404 run_not_found`
- `409 run_not_in_progress`

### `GET /runs/:runId/report`

**Success:** `200 text/html; charset=utf-8`, the self-contained report (FR-035, research D17).
`?download=true` adds `Content-Disposition: attachment; filename="apipilot-performance-<runId>.html"`.

**Errors:**
- `404 run_not_found`
- `409 run_in_progress`

## Changes to existing routes

- `POST /api/test-generation-workflow/execution/start` and the uploaded-collection execution
  start route: the in-progress check also considers a performance run in progress, with the same
  `409 execution_in_progress` shape (FR-029). This is additive.
- `GET /api/test-generation-workflow`: `workflow.stages` gains `performanceTesting`, and
  `workflow` gains an optional `performancePlan`. This is additive, and existing consumers ignore
  unknown stages.
