# Implementation Plan: API Test Coverage Intelligence

**Branch**: `046-api-test-coverage-intelligence` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/046-api-test-coverage-intelligence/spec.md`

## Summary

Add a deterministic coverage calculator and a Coverage view. The calculator reads three things that already exist in a session: the workflow's `ApiModel`, its reviewed scenarios, and the uploaded-collection runs whose request results carry an `itemId` derived from a scenario ID. It produces two separate coverage dimensions (specification, runtime-verified), a six-state classification per requirement, ranked gaps and recommendations. Nothing is stored; the result is recomputed on demand per request.

Repository analysis ([research.md](research.md)) changes the scope in six ways that the spec could not know:

1. There is no "Results" navigation group. Coverage becomes a catalog view in the `results` section (R1).
2. Runs the UI produces are `UploadedCollectionExecutionRun`s with no scenario ID or assertion type. The join is `itemId` and the assertion kind is inferred from Newman test names (R3).
3. Path-level parameters are not merged into `ApiModel`. A small prerequisite fix in `buildApiModel` is required (R5).
4. `oneOf`/`anyOf` are dropped from schemas. Branch coverage is limited to enums, array items and `allOf`-merged schemas; composition branches are reported as not measurable (R6).
5. Deterministic rules assert exactly one status per scenario, so most documented response codes will honestly show as uncovered (R7).
6. No security/authorization scenario category exists. That dimension is reported as unavailable (R8).

## Technical Context

**Language/Version**: TypeScript on Node.js 24, npm workspaces

**Primary Dependencies**: Express (backend), React + Vite + Tailwind CSS v4 (frontend). No new dependencies. Charts are hand-rolled SVG, following `frontend/src/components/liveRun/`.

**Storage**: None added. Coverage is derived from the in-memory session workflow and the existing SQLite run repositories. Revision fingerprint is computed, not stored.

**Testing**: Vitest (unit + Supertest integration in `backend/tests/`), React Testing Library in `frontend/tests/`, shared-domain tests in `packages/shared-domain/tests/unit`. No real-model tests; the feature uses no AI.

**Target Platform**: Local single-user backend plus browser frontend.

**Project Type**: Web application (backend + frontend + shared-domain).

**Performance Goals**: 500-operation specification usable within 3 s of data availability; filter and sort within 1 s (spec SC-006). Calculation is a single pass with indexed lookups, no per-row re-parse.

**Constraints**: Deterministic output (SC-005); no network; no secrets in records, exports or logs; routes thin; pure calculator independent of Express.

**Scale/Scope**: Up to roughly 500 operations, a few thousand scenarios, runs of thousands of results.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design (below).*

| Principle | Assessment |
|---|---|
| I Specification is source of truth; XIV No silent assumptions | Eligible items come only from `ApiModel`. Constructs that cannot be measured are listed with a reason (FR-017, R6), never ignored or guessed. |
| II Deterministic before AI; III AI is not the authority | No AI in any count or status. Recommendations are rule-derived. Optional AI explanation is deferred (out of scope, R12). |
| IX Separation of concerns; X Domain model first | Types in `packages/shared-domain/src/coverage.ts`; pure calculator in `backend/src/coverage/`; thin route; frontend view-model separate from JSX. |
| XIII Provenance and traceability; XXVI Specification traceability | Every requirement carries its mapping (scenario IDs, rule, target) and evidence refs (run ID, result `itemId`). |
| XVI / XXIV Deterministic, reproducible | Sorted iteration, stable element IDs, no clocks or randomness inside the calculator (time is an input). |
| XVII Security and privacy; XVIII No secrets in artifacts; XX No sensitive logging | Coverage carries identifiers, counts and outcomes only; never request/response bodies or `rawCapture`. Export uses the same rule. Logs carry counts and durations only. |
| XIX Fail safely | Typed errors, structured 4xx; API failure is never rendered as empty coverage (FR-039). |
| XXI Testability at every boundary | Calculator, mapper, evidence joiner, prioritizer, route and view are separately testable. |
| XXV Incremental delivery | Phased below; P1 stories ship first. |
| XXVII Prefer simple architecture | No store, no cache, no new dependency, no new persistence. |
| XXXI Definition of done | Docs, roadmap and version bump are in the final phase. |
| XXXIII Presentation consistent and coherent | Reuses `StatTile`, `StatusBadge`, `Tabs`, `Pagination`, `EmptyState`, `ErrorState`, `Skeleton`, `HttpMethodBadge`, section colour system, chart tokens. |

**Findings**

- **FR-018 vs repository.** The spec asks for a Coverage page under a "Results" group. No such group exists (R1). Adding a catalog view is the nearest existing convention but it is a new top-level tab. Logged in Complexity Tracking; the spec's Assumptions already anticipated this.
- **Behaviour change in generated output.** Merging path-level parameters (R5) adds scenarios to specifications that declare them. This is additive and fixes a defect, but it changes deterministic output; it is isolated in its own phase and tests, and the roadmap/spec of AP-002/AP-003 must note it. No other existing contract changes.
- **Constitution "Documented Gaps".** I did not re-read all 33 principles verbatim; the table covers those relevant by title and by the project instructions. Re-verify XVII wording during `/speckit-analyze`.

**Post-design re-check**: Phase 1 artifacts add one shared-domain module, one backend module tree, one router and one view. No principle is newly violated; the only justified deviation is the tab addition above.

## Project Structure

### Documentation (this feature)

```text
specs/046-api-test-coverage-intelligence/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── coverage-routes.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── coverage.ts                         # NEW: all coverage contracts (types, state precedence, metric ids)
└── index.ts                            # export coverage

backend/src/
├── openapi/buildApiModel.ts            # MOD: merge path-level parameters (R5)
├── coverage/                           # NEW, framework-independent
│   ├── specRevision.ts                 # canonical ApiModel -> sha256 fingerprint
│   ├── elements.ts                     # ApiModel -> CoverageRequirement[] with stable ids + eligibility
│   ├── scenarioMapping.ts              # scenario -> requirement ids (rule/target/assertion based)
│   ├── evidence.ts                     # uploaded/guided run results -> evidence per scenario
│   ├── classify.ts                     # state precedence per requirement
│   ├── metrics.ts                      # numerator/denominator/percentage, zero-denominator rule
│   ├── prioritize.ts                   # documented heuristic scoring + rationale
│   ├── recommendations.ts              # gaps -> ranked recommendations
│   ├── calculateCoverage.ts            # orchestrator (pure: inputs -> CoverageSnapshot)
│   ├── filterSnapshot.ts               # filter/sort applied identically to screen and export
│   ├── renderCoverageHtml.ts           # export, mirrors externalCollections/runReportHtml.ts
│   └── errors.ts                       # typed errors
├── api/coverage.ts                     # NEW thin router: GET snapshot, GET export
└── app.ts                              # MOD: register router

frontend/src/
├── services/coverageClient.ts          # NEW: result-union client, stale-response guard
├── hooks/useCoverage.ts                # NEW: load/refresh, request-sequence guard
├── pages/CoveragePage.tsx              # NEW
├── components/coverage/                # NEW: CoverageNotice, MetricGroup, CoverageBars,
│   │                                   #      GapsTable, GapFilters, Recommendations, coverageViewModel.ts
├── components/workflowCatalog.ts       # MOD: new "coverage" view in section "results"
├── App.tsx                             # MOD: mount view; onOpenCoverage hand-off
├── components/ScenarioReviewStage.tsx  # MOD: link to Coverage
└── components/ExternalCollectionRunPanel.tsx  # MOD: link to Coverage from results

backend/tests/unit/coverage/*.test.ts, backend/tests/integration/coverage.test.ts
frontend/tests/unit/coverage/*.test.tsx, packages/shared-domain/tests/unit/coverage.test.ts
docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md, package.json versions
```

**Structure Decision**: Follows AP-045's layout (shared contract module, a backend domain directory with a thin router, a frontend client + hook + page + component folder). The calculator is deliberately a pure function of `(workflow snapshot, runs, now)` so identical input yields identical output.

## Delivery Phases (XXV)

1. **Foundations**: shared-domain `coverage.ts`; spec-revision fingerprint; element extraction; metric math; state precedence. Unit tests for spec tests 1, 7, 11.
2. **Specification coverage (US1)**: scenario mapping for operation, parameter, request schema, response code/schema, category; deduplication; the `buildApiModel` path-level fix with its own tests (tests 6, 8, 9, 10).
3. **Runtime evidence (US2)**: evidence join for uploaded runs and guided `ExecutionRun`s; state classification incl. failed/inconclusive/not-attempted (tests 2–5, 13).
4. **Unattributed evidence and run selection (US5)**: unattributed-result reporting, review-edit note, latest-qualifying-run rule (test 12).
5. **Prioritization and recommendations (US3, US4)**: documented scoring, gap de-duplication.
6. **Route and export**: `GET /api/coverage`, export route, filter parity (FR-024, FR-037).
7. **Frontend (US3, US6, US7)**: client, hook with request-sequence guard, page, chart, table, filters, notices; catalog entry; contextual links; palette entry comes free from the catalog. Light/dark and empty/error states.
8. **Finish**: docs (USER_MANUAL, architecture), ROADMAP entry, feature version bump via `npm run version:bump -- feature` (19.39.0 → 19.40.0), full `npm test`, `npm run lint`, `npm run build`. Changes are left uncommitted for review.

## Risks and Notes

- **Evidence attribution for uploaded runs is inferential.** A result is attributed to a scenario only when `itemId === itemIdForScenario(scenarioId)`; the assertion kind comes from Newman test names. Results that cannot be joined are counted and surfaced as "unattributed evidence", never used (R3).
- **Workflow is in-memory per session.** After idle expiry or restart there is no `ApiModel` to compute from; the view must show a specific "no active specification" state with a recovery action, not an error or zeros (R4).
- **Scenario IDs are random per generation.** Cross-regeneration reconciliation uses a derived stable key (method + path + rule + target + variant) for requirement mapping; evidence still joins by scenario ID, so regeneration orphans old evidence, which is reported as unattributed and never counted as verified (R4). Runs record no specification revision, so the system does not claim those results are from an earlier specification; it says "possibly".
- **Security-sensitivity is inferred from declared security requirements only** and is labelled as a heuristic (R8).
- **Reference-quality caveat.** Research was done by reading code. The "scenario edited after run" note depends on timestamps in `ReviewScenario.history`; if absent the note is omitted and nothing else changes (R4).
- **Stale state is reserved.** It stays in the contract and UI vocabulary but no rule in this feature produces it (clarified 2026-10-10).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New catalog tab "Coverage" in place of a sub-item of a non-existent "Results" group | Coverage spans the guided workflow's model and Import & Run results; neither page owns it | Embedding it as a step of the Import & Run stepper would hide it from users who have generated but not yet executed (spec US1) and would tie a specification-level view to one collection. |
| Touching `buildApiModel` (AP-002) | Path-level parameters are missing, so parameter coverage would be wrong at the source | Reading the raw spec in the coverage module would duplicate parsing and violate "do not repeatedly parse the full specification". |
