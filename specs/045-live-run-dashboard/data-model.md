# Data Model: Live run dashboard (AP-045)

All types live in `packages/shared-domain/` (new file `liveRun.ts`, exported from the package index). Additive only; nothing existing changes shape.

## LiveRunSnapshot

What one poll returns for one run.

| Field | Type | Notes |
|---|---|---|
| `runId` | string | The run this belongs to |
| `kind` | `"chain" \| "user-script" \| "collection"` | Which figures exist (see below) |
| `state` | `"live" \| "completed" \| "cancelled" \| "failed"` | From the run status; `stale` and `loading` are client states, never sent |
| `elapsedMs` | number | Since the run started |
| `plannedDurationMs` | number \| null | k6 kinds only |
| `plannedRequests` | number \| null | Collection only |
| `totals` | `{ requests, failures }` | Same numbers as the run progress and, at the end, the report |
| `currentVirtualUsers` | number \| null | null for `collection` |
| `latency` | `{ averageMs, p95Ms } \| null` | Whole run so far; null when no request has completed (not zero). Not applicable to a kind: `kind` decides whether the dashboard shows the figure at all (collection: omitted) |
| `chains` | `LiveChainRow[]` | Per chain or step; empty where the kind has none |
| `series` | `{ fromSecond: number, bucketSeconds: number, points: LivePoint[] }` | `bucketSeconds` is 1 until the run is thinned, then 2, 4, ...; it applies to every point. `second` is the bucket start. Points whose bucket ends at or after `since`; at most 1,800 held. When `bucketSeconds` differs from the client's, the reply carries the whole series and the client replaces its points |
| `recent` | `RecentRequest[]` | Newest first, at most 15 |
| `inFlight` | string \| null | Name of the request being sent (collection only) |
| `nextSince` | number | Cursor for the next poll |
| `thinned` | boolean | True when older points were merged into wider buckets (none are dropped; totals unchanged) |

## LivePoint

`{ second: number, requests: number, failures: number, virtualUsers: number | null, latencyMs?: number | null, byGroup?: Record<string, number> }`. `latencyMs` is the mean duration of the requests that completed in the bucket (null when none did); `byGroup` is requests per chain, with the ids and labels in `series.groups` (present for a plan with 2 to 8 chains). One per bucket of the run (`series.bucketSeconds`, 1 s until thinned); `requests` and `failures` count that bucket only, so the chart plots `requests / bucketSeconds`. Seconds with no requests are present with zeros while the run is live, so a stall is visible.

## RecentRequest

`{ second: number, chain: string, method: string, path: string, status: number | null, failed: boolean, durationMs: number }`.
`path` is a template without query, user info or fragment. `status` is null when no response was received (connectivity failure or timeout), and `failed` is true. No headers, bodies, cookies, tokens or resolved URLs.

## LiveChainRow

`{ id: string, label: string, method?: string, path?: string, requests: number, failures: number }`.

## Additions to existing records (all optional or additive)

- Collection runs: the planned total, the request in flight and each request's authored path are held in memory (`externalCollections/liveRunState.ts`) while the run is held, not added to `UploadedCollectionExecutionRun` (decided during implementation: no schema change and no extra write per request). A finished run with no held state shows `plannedRequests` from its results and empty paths.
- `PerformanceResult.liveSeries?` and `UserScriptResult.liveSeries?`: `{ bucketSeconds: number, points: LivePoint[] }`, at most 1,800 points, absent on older runs (US4).
- Collection runs store no series: it is derived from `results` on demand for the live snapshot and for both reports, so it is identical in all three and exists for older runs too. `RunReportModel` gains `series: LivePoint[]` (virtual users null).

## Server-side state (not shared)

- `LiveSeries`: a bounded map of second to counters, window 1,800 s, thinned by merging pairs when exceeded.
- `RecentRing`: a fixed-size ring of 15 `RecentRequest`.
- Both are in memory in the run's aggregate and are discarded with it.

## State transitions

`live` to `completed | cancelled | failed` once, never back. The client adds `loading` (before the first reply), `stale` (replies stopped; shows the time of the last good one) and keeps the last snapshot on screen while stale.

## Validation rules

- `requests >= failures` in every point and in totals.
- Final `totals` equal the run record's totals (SC-002); a test asserts this per kind.
- Points are ordered by `second` with no duplicates; `nextSince` is 10 seconds before the newest bucket: k6 stamps a point with the time of its request but writes in batches, so a late point can still arrive for a recent second. The next poll asks for those buckets again and the client replaces a point with the same `second`. A run that has ended returns its whole series whatever `since` says. The client sends the `bucketSeconds` it holds as the `bucket` query value so the server can return the whole series when thinning changed it.
