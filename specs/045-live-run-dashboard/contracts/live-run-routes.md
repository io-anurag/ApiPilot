# Contract: live run read routes (AP-045)

Read-only. No route starts, stops or alters a run. All return `LiveRunSnapshot` (see `data-model.md`). Errors follow the existing
error shape; no stack traces or paths.

| Run kind | Route |
|---|---|
| Performance plan run | `GET /api/chain-plans/runs/:runId/live?since=<second>` |
| Run k6 Script run | `GET /api/user-scripts/runs/:runId/live?since=<second>` |
| Import & Run Collection run | `GET /api/external-collections/:id/execution/runs/:runId/live?since=<second>` |

(The collection route sits beside the existing `GET /external-collections/:id/execution/runs/:runId`, under the same `/api` mount.)

## Request

- `since` (optional, integer >= 0, default 0): return only the `series.points` whose bucket ends at or after `since` (a run that has ended returns its whole series). Used to fetch the whole run on first load or reload (`since=0`) and only recent points afterwards (the reply's `nextSince` is 10 seconds before its newest bucket, because k6 can deliver late points). 
- `bucket` (optional, integer >= 1): the `series.bucketSeconds` the client holds. If thinning changed it, the whole series is returned and the client replaces its points. Invalid `bucket` returns 400 `invalid_query`.
- Invalid `since` returns 400 `invalid_query`.

## Responses

| Status | When |
|---|---|
| 200 | Snapshot of a live run, answered from memory |
| 200 | Snapshot of a run that finished while its in-memory state still exists: `state` is final, with the same series and `recent` the live view had |
| 200 | Snapshot of a finished run without in-memory state (after a restart, or an older run): `state` is final, `series` comes from the stored `liveSeries` (empty with `thinned: false` for older runs), `recent` is empty |
| 404 `run_not_found` | Unknown run, or a run of another session or plan |

Headers: `Cache-Control: no-store`.

## Guarantees

- `totals` equals the run's own progress totals at the same moment, and the final snapshot equals the report.
- Contains only fields listed in `data-model.md`; never headers, cookies, bodies, resolved URLs or `rawCapture`.
- Cheap: no database write and no full-result recomputation per request.
- Existing run routes, progress and report contracts are unchanged. The only additions to existing responses are the optional fields listed in `data-model.md`.
