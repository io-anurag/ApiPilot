# Research: Live run dashboard (AP-045)

Findings come from reading the code on 2026-10-10 (file references in `plan.md`). Each item is a decision with its reasoning.

## R1. Which run kinds can start today

- **Decision**: Build for three startable kinds: performance plan runs (chain, `POST /api/chain-plans/:planId/runs`), Run k6 Script
  runs (`POST /api/user-scripts/:id/runs`) and Import & Run Collection runs (`POST /external-collections/:id/execution/start`).
- **Rationale**: Quick Performance Test now only seeds a plan; the 031, 032 and 036 runs are read-only history (`registerLegacyRunRoutes`).
  The spec's FR-013 was corrected to match.
- **Alternatives**: Give the legacy read-only runs a dashboard. Rejected: they cannot be live.

## R2. Source of live figures for k6 runs

- **Decision**: Reuse the existing `--out json` NDJSON tail (500 ms) and add two bounded in-memory structures to the aggregates:
  a per-second series and a recent-requests ring. No new k6 flag, statsd or summary export.
- **Rationale**: Every point already arrives live through `parseMetricsLine` and is folded into counts and histograms. The
  existing 5 s timeline bucket is too coarse for a live graph, and no per-request record is kept.
- **Alternatives**: statsd or csv output (adds a second channel for no gain); `--summary-export` (only written at the end);
  shorter timeline buckets (would change stored reports and every existing chart).

## R3. One implementation for two aggregates

- **Decision**: Put the per-second series and the recent ring in one shared module (`backend/src/performance/live/`) and call it
  from both `aggregate.ts` (chain) and `userScriptAggregate.ts` (user script).
- **Rationale**: The two aggregates are duplicated today; adding the same logic twice would duplicate it a third and fourth time
  and drift. Extracting only the new logic keeps the change small and leaves the existing aggregates alone (no unrelated refactor).
- **Alternatives**: Merge the aggregates (out of scope, high risk); implement twice (inconsistent, FR-016).

## R4. Transport and latency

- **Decision**: Keep polling (no SSE or websocket). Add a lightweight read of the live state, answered from the in-memory aggregate
  (not the database), polled every 1 s with a cursor (`since`) so each reply carries only new points.
- **Rationale**: The existing hook polls every 2 s and the checkpoint tick is 2 s, so figures can be 4 s old, which fails SC-001
  (3 s). Reading memory avoids the cost of recomputing and storing the full result each second (the full `toResult()` per tick
  is why the tick is 2 s). Polling matches the existing architecture (constitution XXVII: no new infrastructure).
- **Trade-off (XXX)**: 1 request per second per open dashboard against the local backend, versus a push channel's added moving parts.
- **Alternatives**: SSE (new server pattern, reconnection logic, proxy buffering); lowering the 2 s tick (raises per-tick cost and
  stored-row growth).

## R5. Per-request record for chain runs

- **Decision**: Build each recent-request entry from one `http_req_duration` point. k6 tags every `http_req_*` point of a request
  with the same tag set, so that point carries the `step`, `method` and `status` tags (the chain script sets exactly those system tags).
  The path comes from the plan step in the run snapshot, as the unresolved template without query, user info or fragment.
- **Rationale**: Pairing `http_reqs` with `http_req_duration` by order has no join key. `url` is deliberately not a tag
  (constitution XVIII), so the path cannot come from k6 and must not.
- **Open check (task)**: confirm against a real NDJSON capture that `status` and `method` are on the `http_req_duration` point; if
  not, take them from `http_reqs` of the same step in the same timestamp. A recorded fixture test pins the answer.

## R6. Per-request record for user-script runs

- **Decision**: Take step name, method, status and duration from the same point, using the existing display-name rule
  (`displayNameOf`: no query, user info or fragment; origin-only hosts).
- **Rationale**: `url`, `name` and `method` are tags there, but raw values can hold secrets in query strings; the display-name rule
  already exists for this reason.

## R7. Collection runs have no k6 and no live record

- **Decision**: Add the planned total to the run record (additive field) and derive the live snapshot on the server from the settled
  results: per-second requests and failures from each result's start time and duration, recent requests from the last results,
  plus the name of the request that is in flight (additive field set before each request starts).
- **Rationale**: Today the run record has no planned total and no in-flight marker, and `summary.total` is the count of settled
  results, so progress cannot be shown as "n of N". The executor is sequential, so there are no virtual users (spec assumption).
- **Alternatives**: Compute on the client from `results` (puts domain logic in JSX and keeps the 750 ms full-array re-poll).

## R8. One contract, three routes

- **Decision**: One `LiveRunSnapshot` type in `packages/shared-domain/` and one read route per run kind returning it. One React
  dashboard component, one hook and one client helper serve all three kinds.
- **Rationale**: FR-016 (consistency) and the shared-domain rule: one canonical contract, not three variants.

## R9. Chart

- **Decision**: A new React SVG chart following `LoadProfileChart`'s conventions (inline SVG, `chart-*` tokens, `figure` with an
  accessible label, mono tick labels), with a values table as the text alternative. No chart library.
- **Rationale**: The frontend has no chart dependency; the backend report charts are HTML-string renderers and cannot be reused in
  React. Constitution XXVII and the dependency rules favour no new dependency. Series differ by line style and a direct label,
  not colour alone.
- **Alternatives**: A charting library (bundle size, theming, a second visual language).

## R10. Stat tiles and tables

- **Decision**: Add one shared `StatTile` and use it in the dashboard only; hand-rolled table markup follows the existing table
  classes. Leave the three existing ad-hoc tiles as they are and record converging them as a follow-up.
- **Rationale**: Consistency inside the new feature without an unrelated refactor (CLAUDE.md section 58).

## R11. Final graph after the run (US4)

- **Decision (k6 runs)**: Store a capped series (at most 1,800 points, merged into wider buckets when longer, same as held live) as an optional field on the finished
  result, omitted on older runs. The dashboard of a finished run reads it, and the HTML reports of k6 runs gain the chart using
  the existing report chart code (k6 runs have no PDF report).
- **Decision (collection runs)**: Nothing new is stored. The per-second series is a pure function of the stored results (each
  result's start time and duration), shared by the live snapshot and by the report model, so older runs get the graph too. Both
  the HTML report and the PDF report draw it from that one series (decided 2026-10-10). The HTML report uses inline SVG; the PDF
  draws the same chart as vector shapes with the PDF library already in use (no new dependency).
- **Rationale**: The stored k6 result is a JSON string in the run row, so size is capped, and optional because older runs lack it.
  Collection results already hold what the series needs, so deriving it avoids a second source of truth and keeps the two reports
  identical (FR-014).
- **Limitation (documented)**: Older k6 runs show no graph; collection reports show requests and failures only (no virtual users).

## R12. Security and privacy

- **Decision**: The snapshot carries only step or request name, method, path template, HTTP status and duration. It never carries
  headers, cookies, bodies, resolved URLs, query strings or `rawCapture`. Live data stays in memory with the run's existing session
  scope and is not logged. No outbound call is added.
- **Rationale**: Constitution XVII, XVIII, XX; the debug-run masker is not needed because nothing sensitive is surfaced.
