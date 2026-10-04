# Contract: Chain Debug Run API

Base: `/api/chain-plans` (existing router, 8 MiB JSON parser). All routes are session-scoped like the other chain plan routes. Types are in `packages/shared-domain/src/chainDebugRun.ts` (see [data-model.md](../data-model.md)). Error bodies follow the existing `{ error, message, ...details }` shape.

No response from these routes is cacheable: every response carries `Cache-Control: no-store`.

## POST `/api/chain-plans/:planId/debug-runs`

Runs every chain of the saved plan once, in plan order, and returns the masked result. The request stays open until the run ends; the client cancels by aborting the request.

Request body:

```json
{ "environmentId": "<uuid>" }
```

`200` response: `DebugRunResult`.

Errors:

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | `environmentId` is missing or not a UUID. |
| 404 | `chain_plan_not_found` | No such plan in this session, or `planId` is not a UUID. |
| 404 | `environment_not_found` | No such environment in this session. |
| 409 | `execution_in_progress` | A run is in progress in this session. |
| 409 | `debug_run_in_progress` | A Debug run is already executing for this plan (FR-023). |
| 422 | `plan_has_blockers` | The plan's analysis has blockers (same rule as the run trigger); `blockers` lists them. |

A missing environment value, a missing data value, an unreachable target, an unexpected status and a failed extractor are **not** errors: they are part of a `200` result (FR-004, FR-007).

Behaviour:
- Uses the **current saved plan**, not a generated script, so no script is required.
- Sends only to the plan's allowed hosts and the environment base URL origin; any other target, including a redirect hop, is not requested and is reported (`host-not-allowed`).
- No think time or request pause is waited out.
- Uses the first row of each data set.
- Creates no run record, report, run directory or stored artifact.

## GET `/api/chain-plans/:planId/debug-runs/:debugRunId/values/:valueId`

Reveals one masked value that came from the target.

`200`: `{ "value": "<string>" }` with `Cache-Control: no-store`.

| Status | `error` | When |
|---|---|---|
| 404 | `debug_value_not_found` | The value is unknown, malformed, not revealable, expired, or its Debug run was discarded or replaced. The response does not distinguish these cases. |

Secret environment values and secret data-column values are never held, so they always yield `404`.

## DELETE `/api/chain-plans/:planId/debug-runs/:debugRunId`

Discards the held revealable values for that Debug run. `204` whether or not anything was held (`404 chain_plan_not_found` only for an unknown plan). The client calls it when the Debug view is closed.

## Logging contract

Events: `chain_debug_run_started`, `chain_debug_run_finished`, `chain_debug_run_cancelled`, `chain_debug_value_revealed`. Fields: plan id, counts of steps sent and not sent, duration, outcome and error category. Never a URL, header, body, extracted value, environment value or the revealed value itself.
