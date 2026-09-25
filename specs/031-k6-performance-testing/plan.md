# Implementation Plan: k6 Performance Testing

**Branch**: `031-k6-performance-testing` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/031-k6-performance-testing/spec.md` (AP-029)

## Summary

A new optional last stage of the guided workflow, **Performance Testing**, builds a Performance
Plan from the session's approved test model and approved workflows:
- one positive scenario per operation in scope;
- approved workflows as multi-step journeys in dependency order, and every other operation as a
  single-step journey;
- a load profile and user-set thresholds.

From the plan it renders a byte-identical k6 script and an environment template with no secret
values. On the user's explicit trigger, it runs the unmodified script with a user-installed k6 as
a child process. The target environment's values are passed through the process environment.
While the run is in progress it streams k6's JSON metrics output into a constant-memory
aggregate, which gives live progress. At the end it produces a deterministic, self-contained HTML
report with per-step percentiles, a timeline, rule-based findings and provenance.

Runs are persisted in a new session-owned table, and share the session-wide execution slot. A
run keeps its session alive while it is in progress. The design reuses the Postman generator's
parameter serialization and auth planning, so k6 requests match their Postman equivalents. It
adds no dependency and no AI. The details are in [research.md](./research.md) D1 to D24.

## Resolved questions (2026-09-25)

Both were answered and recorded in the spec's Clarifications (Session 2026-09-25):

1. **FR-015 amended** (research D12). k6 virtual users do not share memory, so a refreshed token
   cannot be shared by all of them as the first one is.
   - The first token is acquired once and shared (FR-009, unchanged). When the response states
     `expires_in`, each virtual user refreshes its own copy through the same producer, at a fixed
     point between 70% and 80% of the lifetime that depends on its virtual-user number, so the
     refreshes are spread out and reproducible.
   - Refresh requests are kept out of step metrics and counted separately in the report.
   - The cost (one token request per virtual user per lifetime) and the risk with producers that
     rate-limit or revoke earlier tokens are recorded in the spec's Assumptions.
2. **FR-003 kept** (research D4). k6 prefers a rule-generated positive scenario. Postman's
   selection, which ignores origin, is unchanged here. Aligning it is a separate follow-up
   (ROADMAP Next Actions #30). FR-011 now says the match with Postman holds for the same scenario.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 22 (root `engines: >=22.0.0`) for the backend.
- React with TypeScript for the frontend.
- The generated artifact is a k6 JavaScript script, targeting k6 1.0.0 or later.

**Primary Dependencies**:
- Existing only: Express, `better-sqlite3` (AP-025), and Node's `node:child_process`,
  `node:crypto`, `node:fs`, `node:readline`.
- k6 is an external, user-installed binary, not an npm dependency (constitution XVII exception of
  2026-09-24).
- No charting library: the report's charts are server-rendered inline SVG (research D17).

**Storage**:
- One new SQLite table, `performance_runs` (research D20). It is not encrypted, because it holds no
  values, bodies or URLs.
- The plan and script live in the in-memory workflow state.
- User-supplied values are the environments' existing encrypted `variableValues`.
- Temporary run directories live under `os.tmpdir()/apipilot-k6/`, and are removed on settle and at
  startup.

**Testing**:
- Vitest; Supertest for routes; React Testing Library with fake timers for polling.
- A fake runner replays fixture NDJSON streams, so `npm test` needs no k6.
- The opt-in `npm run test:k6-real -w backend` (`K6_TEST_REAL=1`) uses the real binary against the
  existing `TargetServer` fixture.

**Target Platform**: a local web application, with the browser and the Node backend on the same
machine. The backend runs k6 on that machine on Windows, macOS or Linux.

**Project Type**: a web application in the npm-workspaces monorepo: `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- Progress visible within 5 s and refreshed at least every 5 s (SC-007).
- The report within 10 s of the run's end (SC-007).
- Cancelling stops load within 10 s (SC-008).
- Aggregation keeps constant memory in the request count, with at most about 200 timeline points
  (research D11).

**Constraints**:
- **Constitution XVII exception conditions:**
  - a per-run trigger that names its target;
  - no automatic runs;
  - only the unmodified generated script runs (checked by SHA-256);
  - a user-installed k6;
  - no secrets in the script or argv;
  - local-only output, with `--no-usage-report`;
  - no AI;
  - the load-origin statement.
- A byte-identical script for an identical plan (XVI, XXIV).
- No URL, value, token or body in the metrics stream, the report or the logs (FR-040, FR-042).

**Scale/Scope**:
- Specifications of up to about 50 selected operations (SC-002), and workflows of up to 10 steps
  (`MAX_WORKFLOW_STEPS`).
- There is no limit on virtual users or duration (FR-019). The machine's capacity is the bound,
  and it shows in the measurements.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.3.0.

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | Requests come from approved scenarios. Status checks come only from documented statuses (FR-012). Unique values are applied only for `email`/`uuid` formats (D13). |
| II. Deterministic before AI; III. AI is an assistant | Pass | No AI anywhere in the plan, script, run or report (FR-041). |
| IV. Structured and validated | N/A | No AI output. k6's metrics lines are parsed defensively, and an unreadable stream fails the run with `metrics-unreadable` (D11). |
| V, VI, VII, XXII, XXIII, XXIX. AI-related principles | N/A | No AI. |
| VIII. Framework-independent test model | Pass | The shared types are k6-agnostic. k6 syntax, options and output formats are confined to `performance/k6/` (D2). |
| IX. Separation of concerns | Pass | A new `performance/` module and router. The only change to `postman/` is exporting pure planning functions (D3). The run slot change is one extra check in two routes (D18). |
| X. Domain model first | Pass | `performance.ts` in `shared-domain` (data-model.md). |
| XI. Human in the loop | Pass | Every run is a user trigger. The plan is reviewed and editable before generation (FR-007, FR-024). |
| XII. Quality over quantity | Pass | One positive scenario per operation, and no negative scenarios under load (FR-002). |
| XIII. Provenance | Pass | Every step records its scenario choice, dependency and confidence, variable sources and auth method, and the report shows them (FR-039). Runs record the script hash and k6 version. |
| XIV. No silent assumptions; XIX. Fail safely | Pass | A missing value is reported, never guessed (FR-014). A step without a documented status is shown as having no check (FR-012). Unsupported k6, integrity mismatch and unreadable output are explicit failures (D8, D9). A token with no stated lifetime is reported as such (D12). |
| XV. Conservative inference | Pass | Journeys use only approved workflows (CONFIRMED and LIKELY relationships), unchanged (D5). |
| XVI. Deterministic artifacts | Pass | The script and template are byte-identical for the same plan, with content-derived ids, code-unit ordering, and no timestamps in the script (D4, D5, SC-001). |
| XVII. Security and privacy (v2.3.0 exception) | Pass | Each condition of the 2026-09-24 exception maps to a check (D7 to D10, D18, FR-024 to FR-028, FR-033). There is no shell, no remote imports, no values in argv or the script, a minimal child environment, and `--no-usage-report`. No endpoint accepts script content. |
| XVIII. Secrets not in artifacts | Pass | Values reach k6 only through its process environment (D7). A test scans the script, template and report for seeded secret values. |
| XX. Observability without sensitive logging | Pass | Metadata-only events (D23). k6 stderr is never logged verbatim. |
| XXI. Testability | Pass | Pure plan, render, aggregate and report code. An injected runner. An opt-in real-binary test (D24). |
| XXIV. Reproducibility | Pass | Deterministic unique values from `__VU`/`__ITER` (D13), deterministic percentiles and findings (D11, D16), and the report rendered from the stored result. |
| XXV. Incremental delivery | Pass | Stories are ordered P1 to P4. The plan and script (US1) are useful without k6. |
| XXVI. Traceability | Pass | FR and SC references carried into the contract, data model and quickstart. |
| XXVII. Simple architecture | Pass | No job queue or worker: one child process per run, fire-and-poll like the existing runs. |
| XXVIII. Technology is replaceable | Pass | k6 is behind the `k6/` boundary. A different load tool would replace that folder, not the plan or the result. |
| XXX. Explicit trade-offs | Pass | Recorded in research: per-virtual-user refresh (D12), 1% percentile precision (D11), no schema checks under load (D14), the report styling (D17), a possible orphaned k6 after a crash (D18), the child-environment visibility (D7), and no SSRF guard, which is consistent with the existing runs. |
| XXXI. Definition of done | Pass, planned | Includes the opt-in real-k6 run and quickstart 1 to 8 before "Implemented". |
| XXXII. Review at scale | Pass | Removal and reorder are per operation and per journey. Nothing requires reviewing per request. |
| XXXIII. Presentation | Pass | Stage UI built with AP-027 components (`StatusBadge` tier labels, `HttpMethodBadge`, `EmptyState`/`ErrorState`/`Skeleton`, and "Move up"/"Move down" menus like AP-028). The report's own styling is justified in D17. |

**Gate result: PASS.** No violations. Running the script depends on the v2.3.0 XVII exception,
whose conditions are all designed in.

**Re-check after Phase 1 design: PASS.** The data model, contract and quickstart add no new
execution path, stored secret, or network destination.

## Project Structure

### Documentation (this feature)

```text
specs/031-k6-performance-testing/
├── plan.md              # This file
├── research.md          # Phase 0: decisions D1 to D24
├── data-model.md        # Phase 1: shared types, the run table, state transitions
├── quickstart.md        # Phase 1: validation scenarios 1 to 9
├── contracts/
│   └── performance-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
├── performance.ts                     # NEW: plan, run, result, readiness types
├── testGenerationWorkflow.ts          # + performanceTesting stage, performancePlan field
└── index.ts                           # + export

backend/src/
├── performance/                       # NEW
│   ├── plan/
│   │   ├── selectScenario.ts          # D4
│   │   ├── buildJourneys.ts           # D5
│   │   ├── validateOrder.ts           # D5, FR-007
│   │   ├── userSuppliedValues.ts      # D6
│   │   ├── uniqueValueFields.ts       # D13
│   │   ├── loadProfiles.ts            # starting stages
│   │   └── buildPlan.ts               # plan and fingerprint
│   ├── k6/
│   │   ├── renderScript.ts            # script and template (D7, D8, D10 to D14)
│   │   ├── readiness.ts               # D9
│   │   ├── runner.ts                  # spawn, integrity check, cancel (D8, D10, D19)
│   │   └── metricsStream.ts           # NDJSON parsing (D11)
│   ├── report/
│   │   ├── aggregate.ts               # histogram, timeline, categories (D11, D14)
│   │   ├── thresholds.ts              # D15
│   │   ├── findings.ts                # D16
│   │   └── renderHtmlReport.ts        # D17
│   ├── performanceRunStore.ts         # session-scoped store, onExpire, touch (D18)
│   └── runPerformanceTest.ts          # orchestration: runner → aggregate → store
├── persistence/
│   ├── connection.ts                  # + performance_runs table
│   └── performanceRunRepository.ts    # NEW
├── postman/                           # export existing pure planning functions only (D3)
├── testGenerationWorkflow/            # + stage wiring, staleness entry
├── api/
│   ├── performanceTesting.ts          # NEW router (contract)
│   ├── testGenerationWorkflow.ts      # + performance run in the slot check
│   └── externalCollections.ts         # + performance run in the slot check
├── app.ts                             # + router
└── server.ts                          # + restart marking, run-directory cleanup
backend/scripts/perfStubTarget.ts      # NEW: local stub target for the quickstart

backend/tests/
├── unit/performance/                  # plan, render, stream, aggregate, findings, report, readiness, runner args
├── integration/performance/           # routes with a fake runner, slot, restart, keep-alive
├── integration/performance.k6.real.test.ts   # opt-in (K6_TEST_REAL=1)
└── fixtures/performance/              # NDJSON streams, specification, golden script

frontend/src/
├── components/performance/            # NEW: PlanEditor, JourneyList, LoadProfileEditor,
│                                      #   ThresholdEditor, ValuesChecklist, RunPanel, ReportFrame
├── pages/TestGenerationWorkflowPage.tsx   # + stage block
├── components/workflowStageViewModel.ts   # + label and lock reason
└── services/performanceTestingClient.ts   # NEW (contract client, {ok} result union)
frontend/tests/unit/                   # component and client tests
```

**Structure Decision**: This uses the existing web-application layout. Performance testing is a
new backend module with its own router and table, a new shared-domain file, and a new frontend
component folder behind one new guided-workflow stage. Existing modules change only additively:
- the stage list;
- the slot checks in two routes;
- the exports from `postman/`.

Configuration adds one optional variable, `K6_BINARY_PATH`, to `.env.example` and the README.

## Complexity Tracking

No constitution violations. The one new capability that needed governance, running a generated
script, is covered by the v2.3.0 XVII exception, and every condition of it is designed in.
