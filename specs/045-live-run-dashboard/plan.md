# Implementation Plan: Live run dashboard

**Branch**: `AP-045` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/045-live-run-dashboard/spec.md`

## Summary

One shared live dashboard (counters, requests-per-second graph, per-chain rows, latest requests) for the three run kinds that can
be started today: performance plan runs, Run k6 Script runs and Import & Run Collection runs. Backend: two small bounded in-memory
structures (a per-second series and a recent-requests ring) fed from the k6 metrics lines the runners already read, a collection
snapshot derived from settled results, and one read-only route per kind returning one shared `LiveRunSnapshot`. Frontend: one
dashboard component, one SVG chart, one hook polling every second with a cursor. No new dependency, no new k6 option, no change to
how runs start, run, stop or are stored, apart from additive optional fields. See [research.md](research.md) for the decisions.

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS (backend, shared-domain), React + Vite (frontend)

**Primary Dependencies**: Existing only (Express, React, Tailwind CSS v4). No chart library; no new package

**Storage**: Live state is in memory with the run's existing session scope. One optional capped series (at most 1,800 points, the same as held live) is added to the finished result JSON already stored in the run row; no schema migration

**Testing**: Vitest, Supertest, React Testing Library; fixed NDJSON fixtures; the ordinary suite needs no k6

**Target Platform**: Local backend plus browser

**Project Type**: Web application (backend, frontend, shared-domain)

**Performance Goals**: Figures at most 3 s behind the run (SC-001): k6 tail 500 ms plus 1 s poll. Page responsive for 30 minutes (SC-005)

**Constraints**: Graph at most 1,800 points held and stored (older seconds merged, never dropped); recent list 15; reply carries only new points; no per-second database write; no full-result recomputation per poll

**Scale/Scope**: Three run kinds, one backend module, three routes, one shared type file, one component set, four delivery phases

No `NEEDS CLARIFICATION` remains. One verification is a task, not a question: whether `status` and `method` tags are on the chain
run's `http_req_duration` point (R5), pinned by a recorded fixture.

## Constitution Check

| Principle | Result |
|---|---|
| I, XXVI Specification and traceability | Spec, research, contract, model and quickstart exist; spec FR-013 was corrected with the reason recorded |
| II, XVI, XXIV Determinism | Live views are derived from the run's own points; fixtures make tests deterministic; no generated artifact (script, collection) changes |
| IX Separation of concerns | Aggregation in backend `performance/live/`; routes thin; component and hook separate from the client |
| X Domain model first | `LiveRunSnapshot` defined in shared-domain before any route or component |
| XIV, XIX No silent assumptions, fail safely | Unavailable is never shown as zero; stale and error states are explicit |
| XVII, XVIII, XX Privacy and secrets | Only name, method, path template, status, duration; no headers, bodies, query, resolved URL; not logged; no outbound call |
| XXI Testability | Pure aggregation tested with fixtures; routes with Supertest; UI states with RTL |
| XXV Incremental delivery | Phased below; each phase ships a working dashboard for more kinds |
| XXVII Simple architecture | Polling, in memory, no SSE or queue, no dependency |
| XXX Explicit trade-offs | Polling versus push, and extracting only new logic versus merging the aggregates, documented in research R3 and R4 |
| XXXIII Consistent presentation | One dashboard for all kinds; reuses tokens, section colours, badges, status pills, states and chart conventions; mock is a sketch only |
| XXXII Review at scale | Not applicable (no review or approval interface) |

Gate: passes, no violations to justify. Re-checked after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/045-live-run-dashboard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── mock.html            # layout sketch only (FR-016)
├── contracts/
│   └── live-run-routes.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── liveRun.ts                          # LiveRunSnapshot, LivePoint, RecentRequest, LiveChainRow (+ index export)
                                        # optional additions to performance.ts, userScript.ts, externalCollections.ts

backend/src/performance/live/
├── liveSeries.ts                       # bounded per-second series, thinning
├── recentRing.ts                       # fixed-size recent requests
└── buildSnapshot.ts                    # aggregate state -> LiveRunSnapshot (pure)
backend/src/performance/report/aggregate.ts              # feed live structures in ingest (chain)
backend/src/performance/report/userScriptAggregate.ts    # same (user script)
backend/src/performance/runPerformanceTest.ts            # expose live snapshot via the run handle
backend/src/performance/userScript/startUserScriptRun.ts # same
backend/src/externalCollections/runSeries.ts             # pure: stored results -> per-second series (live and reports)
backend/src/externalCollections/liveSnapshot.ts          # snapshot from settled results, plannedTotal, inFlight
backend/src/externalCollections/runReport.ts, runReportHtml.ts, runReportPdf.ts  # graph in both reports
backend/src/externalCollections/runUploadedCollectionExecution.ts  # set plannedTotal, in-flight name
backend/src/api/chainPlans.ts, userScripts.ts, externalCollections.ts  # one thin GET route each

frontend/src/services/liveRunClient.ts                   # one helper, three base paths
frontend/src/components/liveRun/
├── LiveRunDashboard.tsx                # tiles, state badge, composition
├── LiveRunChart.tsx                    # SVG chart + values table
├── LatestRequestsTable.tsx
├── useLiveRun.ts                       # 1 s poll, cursor, stale handling
└── liveRunViewModel.ts                 # state -> label and tone, number formatting
frontend/src/components/StatTile.tsx                     # shared tile (used here first)
frontend/src/components/requestChain/ChainRunPanel.tsx   # mount in the run-in-progress card
frontend/src/components/userScript/UserScriptRunActivity.tsx
frontend/src/components/ExternalCollectionRunPanel.tsx

backend/tests/unit/performance/live/*.test.ts            # fixtures, thinning, ring, totals
backend/tests/integration/live*.test.ts                  # three routes
frontend/tests/unit/liveRun*.test.tsx
```

**Structure Decision**: Existing web-application layout. New backend logic sits in one new module next to the k6 aggregates; the
dashboard is one new frontend folder; the contract lives in shared-domain. Existing aggregates and orchestrators are touched only to
feed and expose the new structures.

## Delivery phases (XXV)

1. **Contract and shared dashboard, performance plan runs (MVP, US1 and US2).** Shared types, `live/` module, chain wiring and
   route, client, hook, dashboard, chart, `StatTile`, mount in Runs & reports. Includes the R5 fixture check.
2. **Latest requests (US3) for plan runs**, then the same wiring for **Run k6 Script** (reusing the module).
3. **Import & Run Collection**: `plannedTotal`, in-flight name, derived snapshot, route, mount in the Results step (no VU series).
4. **After the run (US4)**: capped `liveSeries` on finished k6 results, dashboard of a finished run, chart in the k6 HTML reports;
   the graph in both the collection HTML report and the collection PDF report, from one shared series function over the stored
   results (`backend/src/externalCollections/runSeries.ts`, used by the live snapshot, `runReportHtml.ts` and `runReportPdf.ts`).

The feature is complete only when all phases are done (spec assumption). Docs (user manual, architecture, roadmap) and a version bump
follow with implementation, per the project rule; nothing is committed without the user's review.

## Risks and notes

- **Tag check (R5)**: if `status` is not on the duration point, the entry is built from `http_reqs`; contained in `liveSeries`/ring, no contract change.
- **Chain path**: shown as the plan's template path, so it may read `/orders/{{id}}`; this is intended (no resolved values).
- **Two aggregates**: only the feed lines are added in each; a shared test runs the same fixture through both where the metrics allow.
- **Quick Performance Test**: has no runs of its own now; its seeded plans use the chain dashboard.
- **Collection reports**: HTML and PDF both get the graph from one series function, so they cannot disagree; a test compares the
  figures drawn in each. The PDF chart is drawn with the existing PDF library, no new dependency. Reports stay byte-deterministic
  for the same run (the series uses only the run's own times). Existing report tests are updated deliberately, not weakened.
- **`StatTile`**: the three existing ad-hoc tiles are not converted here; a follow-up can converge them.

## Complexity Tracking

No constitution violations; nothing to justify.
