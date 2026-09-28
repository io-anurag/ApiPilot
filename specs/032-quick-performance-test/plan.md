# Implementation Plan: Quick Performance Test from a Specification

**Branch**: `032-quick-performance-test` (git branch `AP-032`) | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/032-quick-performance-test/spec.md` (AP-032)

## Summary

A third start-screen entry, **Quick performance test**, takes an uploaded OpenAPI specification
straight to AP-029's performance plan. It keeps its own session-scoped state and never touches the
guided workflow.
- The upload goes through the unchanged parse, validate and analyze pipeline.
- Only the three positive-category rules run. Each scenario gets a content-derived id, so AP-029's
  "lowest identifier" choice gives the same plan and a byte-identical script for the same
  specification.
- Every operation with a positive scenario is a single-step journey, with no chaining. Login
  operations found by the existing credential producers start in the removed list and can be
  restored.

The plan, script and run routes of AP-029 are registered a second time, under
`/api/quick-performance`, through a small plan-source adapter. The run trigger, its check order
and the XVII exception's conditions therefore stay in one implementation. The environments
routes open to a session that has a quick test. Everything else about environments is unchanged,
so both paths share one set.

On the one shared plan screen, used by both paths:
- a write-operation summary above the journeys and beside the run trigger;
- a text effect marker on each write step;
- bulk removal by method or of all writes;
- a view-only preview of each step's request;
- counted, collapsible lists.

The guided stage loses its scope toggle and always uses the API review's selection. Quick runs
record `planSource: "quick"`, and their report says the scenarios were generated and not reviewed.
The feature adds no dependency, no AI and no new configuration. Details are in
[research.md](./research.md) Q1 to Q19.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 24 LTS (root `engines: >=24.0.0`) for the backend.
- React with TypeScript for the frontend.
- The generated artifact is AP-029's k6 script (k6 1.0.0 or later), unchanged in form.

**Primary Dependencies**:
- Existing only: Express, `multer` (existing upload middleware), `better-sqlite3` (AP-025), React,
  Vite, Tailwind CSS v4.
- k6 stays an external, user-installed binary (constitution XVII exception, v2.4.0).

**Storage**:
- Quick test (specification model, scenarios, plan, script): in memory, per session, cleared on
  expiry. Not persisted (spec Edge Cases, research Q1).
- `performance_runs` gains `plan_source TEXT NOT NULL DEFAULT 'guided'`, added through the existing
  `ensureColumn` helper (research Q12).
- Environments: the existing encrypted, session-scoped table, unchanged (AP-025).

**Testing**:
- Vitest for backend and frontend unit tests, Supertest for routes, and React Testing Library.
- AP-029's fake runner, so `npm test` needs no k6.
- The opt-in `npm run test:k6-real -w backend` gains one quick-path run.

**Target Platform**: a local web application, with the browser and the Node backend on one machine
(Windows, macOS or Linux). k6 runs on the backend's machine.

**Project Type**: a web application in the npm-workspaces monorepo: `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- SC-001: from the start screen to a generated script for a 50-operation specification in under
  3 minutes. The server-side work is analysis plus three rules per operation, well under a second
  at that size.
- The step preview is built on request, one step at a time, so plan responses do not grow with
  request bodies (research Q8).
- Run-time goals are AP-029's, unchanged (SC-007, SC-008 of AP-029).

**Constraints**:
- **Constitution XVII exception (v2.4.0) conditions, unchanged and enforced by the one shared
  `POST /runs`** (research Q2):
  - a per-run trigger that names its target;
  - only the unmodified generated script runs;
  - a user-installed k6;
  - no secrets in the script;
  - local-only results and no AI;
  - the load-origin statement;
  - for a quick plan, every write operation listed on the plan and at the trigger (FR-009, FR-011).
- A byte-identical script and template for the same specification and edits (FR-007, SC-004).
- No environment value in any response, preview, script, template, report or log (FR-008).
- The guided workflow and the quick test never read or change each other (FR-021).
- The existing upload size limit and error mapping apply unchanged (FR-002).

**Scale/Scope**:
- Specifications of 100 or more operations (US5, SC-003). The existing
  `paypal-invoicing-v2.yaml` fixture is the scale check.
- One quick test per session.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.4.0 (`specs/constitution.md` is identical,
same SHA-256).

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | Requests come from rule-generated positive scenarios. Expected statuses are pre-filled only from documented 2xx responses (AP-029 D26). Credential producers come only from the existing detection (Q5). |
| II. Deterministic before AI; III. AI is an assistant | Pass | No AI anywhere in the quick path (FR-004). Only the deterministic positive rules run (Q3). |
| IV to VII, XXII, XXIII, XXIX. AI principles | N/A | No AI. |
| VIII. Framework-independent model | Pass | The new shared types (`WriteOperationSummary`, `StepRequestPreview`) have no k6 syntax. k6 stays inside `performance/k6/`. |
| IX. Separation of concerns | Pass | The quick store and scenario-id module live in `performance/quick/`. Routes stay thin over the source adapter (Q2). `testDesign/` gains one additive export (Q3). The guided workflow modules are not imported by the quick path (Q14). |
| X. Domain model first | Pass | The changes are in `shared-domain/performance.ts` (data-model.md). |
| XI. Human in the loop | Pass, via the XVII extension | The quick path has no scenario review, by design. The constitution's 2026-09-27 extension rests on write-operation visibility instead: the summary on the plan and at the trigger (FR-009, FR-011), per-step effect markers, the request preview, and per-run user triggers. Every run is still a user decision on a reviewed plan. |
| XII. Quality over quantity | Pass | One positive scenario per operation, and no negative scenarios (FR-004). |
| XIII. Provenance | Pass | Scenario provenance (rule, description, merged rules) is unchanged. The plan and run record `source`/`planSource`, and the report states that the scenarios were not reviewed (FR-013). The removal reason for credential producers is derived and shown (Q5). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | Nothing is guessed by name (FR-003a). Unchainable path parameters are listed as needed values (FR-019). `scope` is rejected explicitly (Q7). A failed upload stores nothing (Q15). A replacement asks for confirmation (FR-021). |
| XV. Conservative dependency inference | Pass | The quick path infers no dependency (FR-006). The guided path is unchanged. |
| XVI. Deterministic artifacts | Pass | Content-derived scenario ids make the plan and script byte-identical across uploads (Q4). The shared `stepRequestFor` makes the preview identical to what the script sends (Q8). |
| XVII. Security and privacy (v2.4.0 exception) | Pass | The exception names AP-032. Its conditions are enforced by the one run route both paths share (Q2). The uploaded specification is never executed, only analyzed. Environments open only to a session with a quick test (Q6). |
| XVIII. Secrets not in artifacts | Pass | The script and template are rendered unchanged. The preview shows environment values by name only. A seeded-secret scan covers the preview, script, template and report (Q18). |
| XX. Observability without sensitive logging | Pass | Metadata-only events, with no filename or content (Q17). |
| XXI. Testability | Pass | Pure scenario ids, producer detection, write summary and preview classification, the injected runner, and route tests for isolation and gating (Q18). |
| XXIV. Reproducibility | Pass | Same as XVI. There is no random input to the plan. |
| XXV. Incremental delivery | Pass | Stories are P1 to P3. US4 (removing the toggle) is independent of the quick path. |
| XXVI. Traceability | Pass | FR, SC and Q references run through the contracts, data model and quickstart. The AP-029 contract changes are listed in [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md). |
| XXVII. Simple architecture | Pass | An in-memory store and one adapter with two implementations that exist now. No new table beyond one column, no queue, and no dependency. |
| XXVIII. Technology is replaceable | Pass | Unchanged k6 boundary. |
| XXX. Explicit trade-offs | Pass | Recorded in research: quick-only scenario ids rather than global ones (Q4), rejecting `scope` rather than ignoring it (Q7), a preview route rather than an embedded request (Q8), distinct-operation counting (Q9), and replacement allowed during a run (Q14). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 9, docs, the version bump and the roadmap update are included (Q19). |
| XXXII. Review at scale | Pass | Bulk removal by method and of all writes (FR-014, Q10), counted collapsible lists (FR-024, Q11), and a counted needs-status list linked to each step. |
| XXXIII. Presentation | Pass | One shared plan screen for both paths, built from AP-027 components (`HttpMethodBadge`, `StatusBadge`, `EmptyState`, `ErrorState`, `ConfirmDialog`) and Tailwind tokens. Effect markers and the summary use text, not colour alone (FR-010). |

**Gate result: PASS.** No violations. Running a quick plan's script depends on the XVII exception
as extended in v2.4.0, and every one of its conditions is designed in.

**Re-check after Phase 1 design: PASS.** The data model, contracts and quickstart add the following:
- one read-only route on each path (the step preview);
- one new route family;
- one column that holds no values;
- one widened access condition, the one FR-018 permits.

None of these adds an execution path beyond the exception's, a stored secret, a network
destination or AI. The guided path loses one input (`scope`) and gains derived fields only.

## Project Structure

### Documentation (this feature)

```text
specs/032-quick-performance-test/
├── plan.md              # This file
├── research.md          # Phase 0: decisions Q1 to Q19
├── data-model.md        # Phase 1: type changes, new derived types, quick store, column
├── quickstart.md        # Phase 1: validation scenarios 1 to 9
├── contracts/
│   ├── quick-performance-api.md       # the new route family
│   └── changes-to-existing-apis.md    # AP-029 performance API, AP-017 environments, entry chooser
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── performance.ts                     # − scope/PerformanceScope; + plan.source,
                                       #   credentialProducerOperationKeys, run.planSource,
                                       #   WriteOperationSummary, summarizeWriteOperations,
                                       #   WRITE_EFFECT_LABELS, StepRequestPreview

backend/src/
├── testDesign/generateTestModel.ts    # + generatePositiveScenarios (Q3)
├── performance/
│   ├── quick/                         # NEW
│   │   ├── quickScenarioIds.ts        # Q4
│   │   ├── createQuickTest.ts         # pipeline → positive scenarios → ids → plan (FR-002 to FR-006)
│   │   └── quickTestStore.ts          # session-scoped, onExpire (Q1, Q13)
│   ├── plan/
│   │   ├── buildPlan.ts               # − scope; + source, producer keys, quick default exclusions
│   │   ├── buildJourneys.ts           # operationsInScope(context) (Q7)
│   │   ├── planUpdate.ts              # scope → 400 invalid_request
│   │   ├── stepRequest.ts             # TokenSource.producerOperationKey; context.source;
│   │   │                              #   stepRequestFor shared with the renderer (Q5, Q8)
│   │   └── requestPreview.ts          # NEW: StepRequestPreview from stepRequestFor (Q8)
│   ├── k6/renderScript.ts             # uses stepRequestFor; output unchanged
│   ├── report/renderHtmlReport.ts     # + quick provenance line (FR-013)
│   └── performanceRunStore.ts         # + planSource filter for listing
├── persistence/
│   ├── connection.ts                  # + ensureColumn plan_source
│   └── performanceRunRepository.ts    # + plan_source read/write, list by source
├── api/
│   ├── performanceRoutes.ts           # NEW: registerPerformanceRoutes(router, base, source, deps) (Q2)
│   ├── performanceTesting.ts          # guided source adapter; routes moved to performanceRoutes.ts
│   ├── performanceRuns.ts             # run routes take the source adapter
│   ├── quickPerformance.ts            # NEW: POST/GET /quick-performance + quick source adapter
│   └── testGenerationWorkflow.ts      # environments routes use requireEnvironmentAccess() (Q6)
└── app.ts                             # + quick router

backend/tests/
├── unit/performance/                  # positive-only generation, quick ids, producers, scope,
│                                      #   preview, stepRequestFor parity
├── unit/testDesign/                   # generatePositiveScenarios
├── integration/performance/           # quick routes, determinism across uploads, environment
│                                      #   gate, slot, planSource, isolation (FR-021)
├── integration/performance.k6.real.test.ts   # + one quick run (opt-in)
└── fixtures/openapi/quick-performance.yaml   # NEW (quickstart prerequisites)
backend/scripts/perfStubTarget.ts      # + the quick fixture's paths

frontend/src/
├── App.tsx                            # + third tab and mounted page
├── components/EntryChooser.tsx        # + "quick-performance" choice (FR-001)
├── components/performance/
│   ├── PerformancePlanScreen.tsx      # NEW: body moved from PerformanceTestingStage, takes a client
│   ├── PerformanceTestingStage.tsx    # guided framing + FR-023 note; no scope toggle
│   ├── WriteOperationSummary.tsx      # NEW (plan and run-trigger variants)
│   ├── CountedOperationList.tsx       # NEW (FR-024)
│   ├── StepRequestPreview.tsx         # NEW (FR-008)
│   ├── JourneyList.tsx                # + effect markers, preview disclosure
│   ├── PerformanceRunPanel.tsx        # client prop; + WriteOperationSummary beside the trigger
│   └── PerformanceReportFrame.tsx     # client prop
├── pages/QuickPerformancePage.tsx     # NEW: upload → plan, Back to start, replace confirmation
└── services/
    ├── performanceTestingClient.ts    # createPerformanceClient(base); guided exports kept
    └── quickPerformanceClient.ts      # NEW: upload, fetch quick test
frontend/tests/unit/                   # entry, quick page, summary, lists, preview, stage

docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md,
specs/031-k6-performance-testing/contracts/performance-api.md (pointer note),
package.json ×4 + package-lock.json (19.5.3 → 19.6.0)
```

**Structure Decision**: This uses the existing web-application layout. The quick path is a new
backend sub-module (`performance/quick/`), a new route family, and a new frontend page. The
AP-029 routes are made source-agnostic through one adapter rather than copied. Other existing
modules change only as follows:
- the plan builder loses `scope` and gains derived fields;
- `testDesign/` gains one export;
- the environments routes widen one access condition;
- `performance_runs` gains one column.

## Complexity Tracking

No constitution violations to justify. The one capability that needs governance, running the
script generated from a quick plan, is covered by the constitution v2.4.0 extension of the XVII
exception, and every condition of it is designed in.
