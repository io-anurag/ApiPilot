# Contract Delta: Test Execution & Results API

This amends `specs/018-test-execution-results/contracts/execution-api.md`. Every change is
additive (spec.md FR-014). Endpoints, request bodies, status codes, and error codes are
unchanged, and so is every field not mentioned here. When this feature is implemented, the
`specs/018` contract gains a short note pointing to this delta. The two documents are not merged.

## `GET /api/test-generation-workflow/execution/runs/:runId`

Each entry in `run.results` may carry two more fields:

| Field | Presence | Values |
|-------|----------|--------|
| `processingStage` | Every result produced after this feature ships. Absent on results stored before it. | `"not-sent"`, `"no-response"`, `"response-received"` (data-model.md) |
| `unmetDependencies` | Only when `notAttemptedReason` is `"dependency-not-met"`. | Array of `{ "scenarioId", "operationPath", "operationMethod" }`, one or more entries, in execution order |

`notAttemptedReason` can now be `"dependency-not-met"`. It was already part of the declared
vocabulary but was never returned before. It is returned when an earlier request the result
takes a data value from was not attempted, or failed with `connectivity-failure`, `timeout`,
`unexpected-status`, or `could-not-evaluate`. A producer that failed only with
`assertion-failed` does not cause it.

**Example**: a workflow's second step withheld because its first step failed.

```json
{
  "scenarioId": "scenario-get-order",
  "operationPath": "/orders/{orderId}",
  "operationMethod": "GET",
  "outcome": "not-attempted",
  "notAttemptedReason": "dependency-not-met",
  "unmetDependencies": [
    { "scenarioId": "scenario-create-order", "operationPath": "/orders", "operationMethod": "POST" }
  ],
  "processingStage": "not-sent",
  "startedAt": "2026-09-23T10:00:01.000Z",
  "durationMs": 0,
  "assertionOutcomes": []
}
```

**Example**: a request whose target was unreachable.

```json
{ "...": "...", "outcome": "failed", "failureCategory": "connectivity-failure", "processingStage": "no-response" }
```

`GET .../execution/runs` returns summaries only and is unchanged. `summary.notAttempted` already
counts every not-attempted result, including `"dependency-not-met"` ones.

## `POST /api/test-generation-workflow/execution/start` → `409 confirmation_required`

The response shape is unchanged. Two rules change, both restating `specs/018` FR-007 (spec.md
FR-010 to FR-013):

- `destructiveOperations` lists only POST, PUT, PATCH, and DELETE operations that have at least
  one approved scenario, each once, in `ApiModel` order. A destructive operation in the
  specification with no approved scenario is not listed, and the OAuth2 token request ApiPilot
  adds is never listed or counted.
- The 409 is returned when the tier is `staging` or `production`, or when that list is non-empty.
  A `local`, `dev`, or `qa` run whose approved scenarios are all non-destructive now starts
  without `"confirmed": true`. Before this feature it was refused whenever the specification had
  any destructive operation.

The behavior-visible change for existing callers is this: a caller that always sent
`"confirmed": true` is unaffected. A caller that relied on the 409 for a GET-only approved
collection against `local`, `dev`, or `qa` now gets `200` straight away.
