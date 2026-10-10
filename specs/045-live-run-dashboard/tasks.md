---

description: "Task list for AP-045 Live run dashboard"
---

# Tasks: Live run dashboard

**Input**: Design documents from `/specs/045-live-run-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/live-run-routes.md, quickstart.md

**Tests**: Included. Project rules (CLAUDE.md sections 51-54) require tests with every feature; the ordinary suite uses fixtures and needs neither k6 nor a model.

**Organization**: Grouped by user story. Each story covers the three run kinds, chain (performance plan) first, so the first slice of US1 plus US2 is the MVP (plan runs with counters and graph). Paths follow plan.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 to US4, from spec.md
- No commits are made by these tasks; changes are left for the user's review.

## Phase 1: Setup

- [ ] T001 Record a real k6 metrics capture of a short chain run as a fixture in `backend/tests/fixtures/live/chain-run.ndjson` (secrets-free, from the mock target) and note which tags (`step`, `method`, `status`) sit on `http_req_duration` points (research R5)
- [ ] T002 [P] Record a short user-script run capture as `backend/tests/fixtures/live/user-script-run.ndjson`, including the `url`, `name`, `method` tags

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the shared contract, the pure aggregation module, and the shared frontend pieces.

- [ ] T003 Define `LiveRunSnapshot`, `LivePoint`, `RecentRequest`, `LiveChainRow` and the `LiveRunKind` / `LiveRunState` unions in `packages/shared-domain/src/liveRun.ts` per data-model.md, and export them from `packages/shared-domain/src/index.ts`
- [ ] T004 [P] Implement the bounded per-second series with pair-merging thinning (whole run kept, at most 1,800 points, merge rather than drop, exposes `bucketSeconds`) in `backend/src/performance/live/liveSeries.ts`
- [ ] T004a [P] Implement `backend/src/externalCollections/runSeries.ts`: pure function from stored results (start time and duration) to `LivePoint[]` (virtual users null), using the same merging rule and `bucketSeconds`; tests in `backend/tests/unit/externalCollections/runSeries.test.ts` (deterministic, handles not-attempted and connectivity failures, unordered input)
- [ ] T005 [P] Implement the fixed-size newest-first ring (15 entries) in `backend/src/performance/live/recentRing.ts`
- [ ] T006 Implement the pure `buildSnapshot` (totals, latency average and p95 or null, `nextSince`, `thinned`, cursor filtering) in `backend/src/performance/live/buildSnapshot.ts`
- [ ] T007 [P] Unit tests for series (per-second counts, zero-filled seconds, thinning keeps totals and the plotted rate `requests / bucketSeconds`, cursor, whole series returned when `bucketSeconds` changes) in `backend/tests/unit/performance/live/liveSeries.test.ts`
- [ ] T008 [P] Unit tests for the ring (order, capacity, no sensitive fields) in `backend/tests/unit/performance/live/recentRing.test.ts`
- [ ] T009 [P] Unit tests for `buildSnapshot` (null versus zero, invariants requests >= failures, ordered unique seconds) in `backend/tests/unit/performance/live/buildSnapshot.test.ts`
- [ ] T010 [P] Add the shared `StatTile` (label, value, sub-line, optional tone; tokens only) in `frontend/src/components/StatTile.tsx` with a test in `frontend/tests/unit/StatTile.test.tsx`
- [ ] T011 [P] Add `frontend/src/services/liveRunClient.ts`: one helper `fetchLiveRun(kind, ids, since)` over the three route bases, typed with `LiveRunSnapshot`, errors as typed results (no thrown strings)
- [ ] T012 Add `frontend/src/components/liveRun/useLiveRun.ts`: 1 s poll with `since` cursor, merges points, states loading / live / stale (after 10 s without a reply, keeps last figures and the time of the last good reply) / final, stops on a final state, replaces its points when `bucketSeconds` changes, cleans up on unmount
- [ ] T013 [P] Add `frontend/src/components/liveRun/liveRunViewModel.ts`: state to `{label, tone}` using `StatusBadge` tones, number and duration formatting via the existing `formatDuration`, wording shared with `runStatusLabel`
- [ ] T014 [P] Tests for the hook (merge, cursor, fresh mount with `since=0` restores history, stale after 10 s, recovery, stop on final, no overlapping polls, points replaced on bucket change) in `frontend/tests/unit/useLiveRun.test.tsx`, with fake timers

**Checkpoint**: contract, pure logic and shared UI pieces exist and are tested; no run kind is wired yet.

---

## Phase 3: User Story 1 - See how a run is going, as it happens (P1) MVP

**Goal**: live counters, state badge and elapsed time on Runs & reports, then on the other two kinds.

**Independent Test**: start a plan run against the mock target; requests, failures, virtual users and elapsed time rise while it runs and stop at the final totals (which equal the report), and Cancel shows Cancelled with the totals reached.

- [ ] T015 [US1] Feed the series from `ingest` in `backend/src/performance/report/aggregate.ts` (chain), using step method and path template from the run snapshot via `layoutFromChainSnapshot`; expose a `liveSnapshot(sinceSecond)` accessor (series only; the ring is T033)
- [ ] T016 [US1] Expose the accessor through the live run handle in `backend/src/performance/runPerformanceTest.ts` (memory only; no new checkpoint write)
- [ ] T017 [US1] Add `GET /api/chain-plans/runs/:runId/live` in `backend/src/api/chainPlans.ts` per contracts/live-run-routes.md (validate `since`, 404 `run_not_found`, `Cache-Control: no-store`), thin: delegates to `buildSnapshot`
- [ ] T018 [P] [US1] Integration tests for the chain route (live, finished, unknown run, other-session or other-plan run is 404, bad `since`, `since=0` restores the run so far, totals equal progress totals) in `backend/tests/integration/performance/liveChainRoute.test.ts`
- [ ] T019 [US1] Build `frontend/src/components/liveRun/LiveRunDashboard.tsx`: state badge, tiles (requests done, failures, virtual users, elapsed, average and p95 duration), progress bar for k6 kinds, loading / stale / error / completed / cancelled panels using `Skeleton`, `ErrorState`, `StatusBadge`; omits figures a kind cannot supply
- [ ] T020 [US1] Mount the dashboard in the run-in-progress card in `frontend/src/components/requestChain/ChainRunPanel.tsx` (replace the one-line status; keep Cancel run where it is)
- [ ] T021 [P] [US1] Component tests (states, null shown as unavailable not zero, Cancel stays, omitted figures) in `frontend/tests/unit/LiveRunDashboard.test.tsx`; update `frontend/tests/unit/ChainRunPanel*.test.tsx` only for the replaced status line
- [ ] T021a [US1] Failed state: a run that ends in error shows the error and the figures reached in the dashboard; a run that fails to start (no run id) shows the start error in the run card instead of a blank panel; tests in `frontend/tests/unit/LiveRunDashboard.test.tsx`; also assert the dashboard calls only `liveRunClient` and no other service (FR-010, FR-011)
- [ ] T022 [US1] Feed the same structures in `backend/src/performance/report/userScriptAggregate.ts` (`add`), expose through `backend/src/performance/userScript/startUserScriptRun.ts`
- [ ] T023 [US1] Add `GET /api/user-scripts/runs/:runId/live` in `backend/src/api/userScripts.ts`, with route tests in `backend/tests/integration/performance/liveUserScriptRoute.test.ts`
- [ ] T024 [US1] Mount the dashboard in `frontend/src/components/userScript/UserScriptRunActivity.tsx` (replace the three ad-hoc tiles shown during a run), update its tests
- [ ] T025 [US1] Add `plannedTotal` and `inFlightRequestName` (additive, optional) to `UploadedCollectionExecutionRun` in `packages/shared-domain/src/externalCollections.ts`; set them in `backend/src/externalCollections/runUploadedCollectionExecution.ts` and the run store (`uploadedCollectionExecutionStore.ts`, `uploadedCollectionRunRepository.ts`)
- [ ] T026 [US1] Implement `backend/src/externalCollections/liveSnapshot.ts` (totals, "n of N", in-flight name, no virtual users) and `GET /api/external-collections/:id/execution/runs/:runId/live` in `backend/src/api/externalCollections.ts`, with the series from `runSeries.ts` (T004a); tests in `backend/tests/unit/externalCollections/liveSnapshot.test.ts` and `backend/tests/integration/externalCollections/liveRoute.test.ts`
- [ ] T027 [US1] Mount the dashboard in the Results step of `frontend/src/components/ExternalCollectionRunPanel.tsx` (keep the existing run-in-progress polling that other parts of the panel depend on; replace only the overview during a live run); update `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx`

**Checkpoint**: US1 works for all three kinds; MVP (plan runs) is shippable after T021.

---

## Phase 4: User Story 2 - Watch the run on a graph (P1)

**Goal**: requests/s, failures/s and virtual users against elapsed time, whole run, thinned note, text alternative.

**Independent Test**: during a ramping plan run the graph gains points and the virtual-user line follows the ramp; failures are distinguishable without colour; before the first point it says it is waiting.

- [ ] T028 [US2] Build `frontend/src/components/liveRun/LiveRunChart.tsx`: inline SVG following `LoadProfileChart` conventions (`figure`, `role="img"`, `aria-label` summary, `chart-*` tokens, mono ticks), three series with different line styles and direct labels, "waiting for the first figures" empty state, "thinned" note, values table in a `details`, reduced-motion respected, horizontal overflow contained
- [ ] T029 [P] [US2] Tests for the chart (extends with new points, keeps earlier ones, series distinguishable without colour, table matches points, empty and thinned states, no virtual-user series when null) in `frontend/tests/unit/LiveRunChart.test.tsx`
- [ ] T030 [US2] Add the chart to `LiveRunDashboard.tsx` and the per-chain rows (`LiveChainRow`, with `HttpMethodBadge`) beside it; tests added to `LiveRunDashboard.test.tsx`
- [ ] T031 [US2] Confirm the collection live graph: `liveSnapshot.ts` returns the `runSeries.ts` series (T004a) with `bucketSeconds`, virtual users null; chart omits the virtual-user line for it (test in `LiveRunChart.test.tsx`)
- [ ] T032 [P] [US2] Cross-kind test: the same fixture run through chain and user-script aggregates yields consistent point shapes and `requests >= failures` in `backend/tests/unit/performance/live/aggregateLive.test.ts`

**Checkpoint**: US1 and US2 together are the requested dashboard.

---

## Phase 5: User Story 3 - See the latest individual requests (P2)

**Goal**: newest-first list of the most recent 15 requests, no sensitive data, stated as a sample.

**Independent Test**: with a run sending requests the list shows step, method, path, status, duration, keeps to 15, states it is a sample, and never shows headers, query strings, tokens or bodies.

- [ ] T033 [US3] Chain: build each ring entry from the `http_req_duration` point (step, method, status, duration) with the path template from the snapshot step, per the tag findings of T001 (fallback to `http_reqs` of the same step if `status` or `method` is absent); strip query, user info and fragment, in `backend/src/performance/report/aggregate.ts`
- [ ] T034 [P] [US3] User script: build entries with `displayNameOf` (no query, user info or fragment) in `backend/src/performance/report/userScriptAggregate.ts`
- [ ] T035 [P] [US3] Collection: derive the latest 15 from stored results (name, method, path from `endpointPath` of the authored URL so `{{variables}}` stay unresolved, status, duration; never `rawCapture` or `requestUrl`) in `backend/src/externalCollections/liveSnapshot.ts`
- [ ] T036 [US3] Tests with the fixtures: entries are newest first, capped at 15, contain only the allowed fields, and a request carrying an Authorization header and a `?token=` query shows neither, for all three kinds, in `backend/tests/unit/performance/live/recentPrivacy.test.ts` and the collection snapshot test
- [ ] T037 [US3] Build `frontend/src/components/liveRun/LatestRequestsTable.tsx` (semantic table with the existing table classes, `HttpMethodBadge`, status as a word plus number, "a sample of the latest requests" note, horizontal scroll contained) and add it to the dashboard; tests in `frontend/tests/unit/LatestRequestsTable.test.tsx`

**Checkpoint**: all three stories work for all three kinds while a run is live.

---

## Phase 6: User Story 4 - Dashboard after the run (P3)

**Goal**: the graph stays after the run, in the dashboard and in the reports.

**Independent Test**: open a finished k6 run, a finished collection run and a collection run from before this feature; each shows the graph with figures equal to its report; the collection HTML and PDF show identical figures.

- [ ] T038 [US4] Add optional `liveSeries` (`bucketSeconds`, at most 1,800 points) to `PerformanceResult` and `UserScriptResult` in `packages/shared-domain/src/performance.ts` and `userScript.ts`; fill it in each aggregate's `toResult` by downsampling the series; confirm older stored rows still parse
- [ ] T039 [US4] Keep serving the in-memory snapshot (series and `recent`) for a run that just finished while its state exists; serve the stored series only when it does not (after a restart or an older run: empty with `thinned: false`, `recent` empty); extend T018, T023 and T026 tests
- [ ] T040 [US4] Show the dashboard graph for a finished run in `ChainRunPanel.tsx`, `UserScriptRunActivity.tsx` and the collection Results step, with the final state and totals
- [ ] T041 [US4] Add the per-second chart to the k6 HTML reports using the existing chart code in `backend/src/performance/report/chainReportCharts.ts` (new `liveSeriesChart`), rendered from `renderChainReport.ts` and `renderUserScriptReport.ts`; skipped when `liveSeries` is absent; report tests in `backend/tests/unit/performance/report/`
- [ ] T042 [US4] Add `series` to `RunReportModel` built by `runSeries.ts` in `backend/src/externalCollections/runReport.ts`
- [ ] T043 [US4] Draw the graph in the collection HTML report (inline SVG, same palette) in `backend/src/externalCollections/runReportHtml.ts`
- [ ] T044 [US4] Draw the same graph in the collection PDF report with the existing PDF library (vector shapes, no new dependency) in `backend/src/externalCollections/runReportPdf.ts`
- [ ] T045 [US4] Tests: the HTML and PDF figures are identical (compare the series values each draws), reports stay byte-deterministic for the same run, an older run renders with the graph, in `backend/tests/unit/externalCollections/runReport.test.ts` and `backend/tests/integration/externalCollections/runReportPdf.test.ts`; update existing report assertions deliberately, never weaken them

**Checkpoint**: every story complete for every kind.

---

## Phase 7: Polish and cross-cutting

- [ ] T046 [P] Accessibility and theme pass: keyboard order, focus visibility, light and dark, reduced motion, 360 px width, no page overflow, in `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx` style tests for the dashboard (`frontend/tests/unit/LiveRunDashboardAccessibility.test.tsx`)
- [ ] T047 [P] Consistency review against FR-016: same names, units and formats as the run report and run list; remove any local colour or class that duplicates an existing token
- [ ] T048 Performance check: a simulated 30-minute run keeps the held series at or below 1,800 points and the poll reply small (cursor), in `backend/tests/unit/performance/live/longRun.test.ts`; a freshness test (a point ingested is in the next snapshot, and 500 ms tail plus 1 s poll stays at or under 3 s with fake timers, SC-001); a chart render test at 1,800 points (SC-005) in `frontend/tests/unit/LiveRunChart.test.tsx`
- [ ] T049 Update `docs/USER_MANUAL.md` (dashboard, states, what the latest-requests list shows and never shows, graphs in reports) and `docs/architecture.md` (live module, routes, polling decision)
- [ ] T050 Add AP-045 to `specs/ROADMAP.md` and bump the version in the workspace `package.json` files and `package-lock.json` through npm (feature-finish rule), without committing
- [ ] T051 Run `npm test`, `npm run lint`, `npm run build`; walk through `quickstart.md` scenarios 1 to 7; report results as run
- [ ] T052 Run `/speckit-analyze` for consistency, then review the final diff for unrelated changes and secrets

---

## Dependencies and order

- Phase 1 then Phase 2; Phase 2 blocks everything.
- US1 and US2 are the P1 pair; US2 needs the dashboard shell from T019. US3 needs T015, T022 and T026. US4 needs US1 and US2.
- Within a story: pure logic, then wiring and routes, then UI.
- T001 (the tag check) blocks T033 only.

### Parallel examples

- Phase 2: T004, T005, T007, T008, T009, T010, T011, T013, T014 touch different files.
- US1: after T015 to T017, T018 and T019 can proceed together; T022 to T024 (user script) and T025 to T027 (collection) are independent of each other.
- US4: T041 (k6 reports) and T042 to T044 (collection reports) are independent.

## Implementation strategy

1. **MVP**: Phases 1 and 2, then T015 to T021 and T028 to T030 (chain runs with counters and graph). Validate with quickstart scenario 1.
2. Add the user-script and collection kinds (T022 to T027, T031), then latest requests (US3), then reports and the finished-run graph (US4).
3. Polish, documentation and validation last. Every phase leaves the app working; nothing is committed without review.
