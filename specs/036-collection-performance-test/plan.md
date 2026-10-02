# Implementation Plan: Performance Test from a Postman Collection

**Branch**: `036-collection-performance-test` (git branch `AP-036`) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/036-collection-performance-test/spec.md` (AP-036)

## Summary

An engineer turns a collection stored in Import & Run Collection into a k6 performance plan without
defining its steps again. The collection is read, never run. The requests become steps, recognised
script statements become captures and expected statuses, and everything else is listed for review.

**A third plan source.** `collection` sits beside `guided` and `quick`. It has its own route family,
`/api/collection-performance`, and an in-memory store (R1). It reuses every AP-029 route, the runs,
the snapshot and the report through one new seam:
- `PlanHandle.context` becomes `PlanHandle.engine` (R2);
- an `openApiEngine` wraps today's functions unchanged;
- a `collectionEngine` implements the same six operations for a collection plan.

**Reading.**
- **Requests:** the `postman-collection` SDK gives each selected request with its effective auth,
  enabled headers, URL, body and the scripts that apply to it (R3).
- **Left out:** requests the script cannot send faithfully are left out with a reason (R4).
- **Scripts:** acorn parses the test scripts. A closed grammar, applied only at the top level and
  directly inside `pm.test`, turns setters into captures and chai-postman status assertions into
  expected statuses (R5, R7). Every other statement, and every pre-request script, becomes a
  finding with its owner and line.

**Assembly.**
- **Bindings:** references bind to the latest earlier capture of the same name, using AP-035's
  capture keys, so the runtime treats them as captures (R6).
- **Credential requests:** a step whose captured values feed only later requests' authentication
  becomes a token source. It runs once in `setup()` and is refreshed per virtual user on
  `expires_in` (R8, clarification Q2).
- **Dynamic variables:** supported `{{$…}}` occurrences become runtime-generated values, unique per
  virtual user, iteration and occurrence (R9).
- **Values:** remaining references are environment values. Literal credentials become secret
  environment values (R12).

**Gates.**
- **Review:** the engineer must mark the conversion reviewed before a script is generated. The
  review is tied to a digest of the conversion (R14).
- **Out of date:** a content digest of the collection marks the plan out of date when the collection
  changes (R13).

**Runtime.** It changes once for every plan, additively (R10):
- the dynamic-value table;
- token sources with captures and an expected status;
- several token schemes per step;
- form bodies;
- a counted setup failure.

The AP-029 and AP-035 goldens are regenerated once.

The feature adds no dependency, no AI, no configuration and no table.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 24 LTS for the backend.
- React with TypeScript for the frontend.
- k6 1.0.0 or later, installed by the engineer.

**Primary Dependencies**: Existing only: Express, `postman-collection` 4.5.0 (reading stored
collections), `acorn` 8 (parsing script text, as AP-034 does), React, Vite and Tailwind CSS v4.
Newman is not used by this feature (R3, R5).

**Storage**:
- The collection plan is in memory, one per session, like the quick plan (FR-025).
- Runs go in `performance_runs` with `plan_source = 'collection'`. There is no schema change.
- Stored collections are read only.

**Testing**:
- Vitest unit and integration tests, with Supertest, the `k6Sandbox` runtime and the fake runner.
- A new golden script, and the two existing goldens regenerated.
- React Testing Library.
- Two opt-in real-k6 cases (R21).

**Target Platform**: a local web application, with the browser and the Node backend on one machine.
k6 runs on the backend's machine.

**Project Type**: a web application in the npm-workspaces monorepo: `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- SC-005: a 100-request collection builds in under 5 seconds.
- Recognition is linear in script size: each script is parsed once per build, and folder and
  collection scripts are parsed once and applied to every inheriting step.

**Constraints**:
- **Constitution v2.7.0, XVII, the 2026-09-24 exception as extended on 2026-10-02 for AP-036.** Each
  condition maps to a design decision:

  | Condition | Design |
  |---|---|
  | Scripts are never executed, and are read only against enumerated forms | R3, R5 |
  | Request content is written only as data | R2, R10, where the runtime is fixed text |
  | Dynamic values come from ApiPilot's own code | R9 |
  | No value or literal credential is in the script | R12 |
  | Every host is listed | R12, FR-021 |
  | The plan, snapshot and report name the collection and record captured values' sources without values | R15, R16 |
  | A rebuild needs a new review | R13, R14 |

- **Unchanged.** The guided and quick paths' HTTP behaviour and plan fingerprints. Generated scripts
  keep passing AP-034's check.

**Scale/Scope**:
- One collection plan per session.
- At most 100 steps, and at most 10 captures added by the engineer per step.
- The existing one-run-per-session slot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.7.0, ratified in the working tree on
2026-10-02. `specs/constitution.md` is identical (SHA-256 `7ab4cf144e0c…` for both).

**The spec's governance prerequisite.** It asked this check to draft the XVII amendment. The
amendment was drafted through `/speckit-constitution` before this plan, as v2.7.0.
- **Status: committed on `AP-036` (173cb1b), not yet merged.** The Governance section requires
  approval through a pull request. `/speckit-implement` MUST NOT start until it is merged.
- The spec's Governance section is updated to cite v2.7.0.

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | There is no specification here, and nothing claims one. Statuses are "from the collection's test" or "set by you", never "from specification". Undocumented capture paths are labelled so (R7, R15, R20). |
| II to VII, XXII, XXIII, XXIX. AI principles | N/A | No AI (FR-026). |
| VIII. Framework-independent model | Pass | `CollectionPlanInfo`, findings and the new union members are shared-domain types. Postman and k6 specifics stay in `collection/` and `renderScript.ts`. |
| IX. Separation of concerns | Pass | Reading, recognition, binding, credential classification, values and the digest are pure modules in `performance/collection/`. The routes are thin adapters. The UI composes requests only. |
| X. Domain model first | Pass | data-model.md. The types are added before the routes and the UI. |
| XI. Human in the loop | Pass | Building, the review, replacing a plan and rebuilding are explicit actions, and every run is an explicit trigger (R14, R18). |
| XIII. Provenance | Pass | Each step names its collection request. Each capture names its script, owner and line, or "set by you". The report states the collection source (R15, R16). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | Nothing is guessed: unrecognised statements, unsupported requests, contradictory assertions and URL-encoding differences are listed. A failed setup capture is counted and named (R4 to R8, R11). Two spec rules that depended on information the system does not have are amended openly (Open items). |
| XV. Conservative dependency inference | Pass | Bindings come only from the collection's own setters and references, by name. Credential classification uses only where captured values are used, never names or paths (R6, R8). |
| XVI. Deterministic artifacts | Pass | Ids are digests of stable item ids. Every list has a defined order. Recognition is pure. Generated values derive from the virtual user, the iteration and the occurrence. The script is tested byte-identical ten times (R5, R9, R19). |
| XVII. Security and privacy (v2.7.0, 2026-10-02 extension) | Pass, pending merge | Every condition is mapped under Constraints. The exact generated bytes run, as before. |
| XVIII. Secrets not in artifacts | Pass | Literal credentials become secret environment references. Values are read only by R17's server-side copy. A seeded-literal scan covers the script, the template, logs and the snapshot (R12, R17, R21). |
| XX. Observability without sensitive logging | Pass | Logs hold ids, counts and codes only (contract Logging). |
| XXI. Testability | Pass | Pure modules. The sandboxed runtime. The fake runner. Opt-in real k6 only. |
| XXIV. Reproducibility | Pass | The same collection and choices give the same plan and script. Generated values are reproducible (R9). |
| XXV. Incremental delivery | Pass | P1 to P4 follow the user stories (R22). |
| XXVI. Traceability | Pass | FR, SC and R references run through the contracts, data model and quickstart. The spec amendments are listed below. |
| XXVII. Simple architecture | Pass | One seam at six call sites, rather than a union context in fifteen functions. One store. One router. No new table (R1, R2). |
| XXVIII. Technology is replaceable | Pass | Findings, captures and bindings are domain types. Postman reading and k6 rendering are adapters. |
| XXX. Explicit trade-offs | Pass | Recorded in research: form-data left out (R4), the grammar's limits (R5), scope binding (R6), status intersection (R7), the one runtime and its Run again effect (R10), URL encoding (R11), the digest rather than a column (R13). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 8, the manual, architecture, roadmap, the version bump (19.16.0 → 19.17.0). |
| XXXII. Review at scale | Pass | 100 steps. Findings grouped by step and owner, collapsible and counted. Left-out and removed tables are searchable (R20). |
| XXXIII. Presentation | Pass | AP-027 components and tokens. States and reasons in text. Tables for structured lists. Keyboard-accessible actions. |

**Gate result: PASS**, conditional on the v2.7.0 amendment being merged before implementation.

**Re-check after Phase 1 design: PASS.** The design adds:
- one route family of four routes;
- one store, one engine and five pure modules;
- additive shared-type members;
- four additive runtime changes.

It adds no new network destination beyond the collection's own hosts, which are listed. It adds no
stored value, no new execution path and no AI.

## Open items for the engineer's confirmation

These are not constitution issues. They change spec text approved earlier today, so they are
surfaced rather than decided silently (CLAUDE.md §63). The spec is amended to match. Each amendment
is marked "amended by plan".

1. **Resolved 2026-10-02 (spec Clarifications): scope precedence (R6; spec Edge Cases, FR-008).** The spec said a reference stays an
   environment value when Postman's precedence would resolve it from the environment. That depends on
   values, which change on every functional run.
   - **Plan:** bind by the script's intent, and add a `scope-precedence` note for every
     `collectionVariables` or `globals` capture.
   - **Confirmed:** option A.
2. **Form-data bodies are left out (R4; FR-004).** k6 cannot send multipart without new runtime code.
3. **"Marked secret by the collection's environment" is removed (R12; FR-014).** The upload keeps no
   such marking.
4. **Out of date only on collection content (R13; FR-022, Edge Cases).**
   - A functional run's value save-back does not change anything the plan uses.
   - "Re-upload" does not exist: a new upload is a new collection.
5. **FR-017 wording (R17).** The copy never returns values. The environment it creates is then like
   any other, whose values the existing edit form shows.
6. **Run again after the upgrade (R10).** The runtime change alters every generated script's bytes,
   so runs made before 19.17.0 need a regenerated script before **Run again**. This is the same
   effect AP-035 had.

## Project Structure

### Documentation (this feature)

```text
specs/036-collection-performance-test/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1 to R22
├── data-model.md        # Phase 1: shared and backend types, rendered data, lifecycle
├── quickstart.md        # Phase 1: validation scenarios 1 to 8
├── contracts/
│   ├── collection-performance-api.md   # new routes, shared-route behaviour for this source
│   └── changes-to-existing-apis.md     # seam, runtime, report, persistence, frontend
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── performance.ts                       # + CollectionPlanInfo, ConversionFinding, LeftOutRequest,
                                         #   CredentialRequestView, CaptureOrigin; union members
                                         #   (source "collection", journey source, step fields,
                                         #   auth kind, status source, binding target, value
                                         #   sources, preview reference, run planSource)

backend/src/
├── performance/
│   ├── collection/                      # NEW, all pure except the store
│   │   ├── readCollectionRequests.ts    # R3, R4
│   │   ├── recognizeScript.ts           # R5 grammar and findings
│   │   ├── statusAssertions.ts          # R7
│   │   ├── bindCollectionPlan.ts        # R6 captures, references, bindings
│   │   ├── credentialRequests.ts        # R8
│   │   ├── dynamicValues.ts             # R9 supported list and rewriting
│   │   ├── collectionValues.ts          # R12 base URL, secrets, literals
│   │   ├── assembleCollectionPlan.ts    # choices → PerformancePlan (R13, R14, R15, R19)
│   │   ├── collectionEngine.ts          # PlanEngine for this source (R2)
│   │   ├── collectionPlanStore.ts       # in-memory store (R1)
│   │   └── seedEnvironment.ts           # R17
│   ├── plan/
│   │   ├── openApiEngine.ts             # NEW: wraps today's functions (R2)
│   │   ├── buildPlan.ts                 # fingerprint includes `collection`
│   │   └── runSnapshot.ts               # empties excerpts (R16)
│   ├── k6/renderScript.ts               # split; runtime changes (R2, R10)
│   ├── report/aggregate.ts, renderHtmlReport.ts   # R16
│   └── errors.ts                        # new error classes
├── api/
│   ├── collectionPerformance.ts         # NEW router (R1, R18)
│   ├── performanceRoutes.ts             # PlanHandle.engine (R2)
│   ├── performanceTesting.ts, quickPerformance.ts # pass openApiEngine
│   ├── performanceHttp.ts               # error mapping
│   └── testGenerationWorkflow.ts        # environments gate (R17)
├── externalCollections/uploadedCollectionParsing.ts   # export the dynamic list
├── persistence/performanceRunRepository.ts            # planSource "collection"
└── app.ts                               # mount the router

backend/tests/
├── unit/performance/collection/         # one file per module above, plus sandbox values
├── unit/performance/renderScript.test.ts               # goldens, AP-034 check
├── integration/performance/collectionPerformanceRoutes.test.ts
├── integration/performance.k6.real.test.ts             # + two opt-in cases
├── fixtures/collections/apifoundry.postman_collection.json (+ environment)   # NEW
└── fixtures/performance/golden/         # script.js, user-journeys-script.js regenerated;
                                         #   collection-script.js NEW
backend/scripts/perfStubTarget.ts        # token issue, expires_in, 401, 409 on repeated email

frontend/src/
├── App.tsx                              # fifth tab, callback
├── pages/ExternalCollectionsPage.tsx    # forwards the callback
├── pages/CollectionPerformancePage.tsx  # NEW
├── services/collectionPerformanceClient.ts             # NEW
├── components/ExternalCollectionRunPanel.tsx           # the action
└── components/performance/
    ├── collection/ConversionReview.tsx, CredentialRequestList.tsx,
    │   CollectionStepSource.tsx, NewEnvironmentFromCollection.tsx   # NEW
    ├── PerformancePlanScreen.tsx        # collection views and gates
    └── performanceViewModel.ts (+ label call sites)   # source-aware labels
frontend/tests/unit/                     # run panel action, page, review, credential list,
                                         #   left out, labels

docs/USER_MANUAL.md (new section 5a, limitations), docs/architecture.md, README.md,
specs/ROADMAP.md, specs/036-collection-performance-test/spec.md (amendments above),
package.json ×4 + package-lock.json (19.16.0 → 19.17.0, `npm run version:bump -- feature`)
```

**Structure Decision**: The feature uses the existing web-application layout. Its logic is a new
`backend/src/performance/collection/` package of pure modules behind one engine. It plugs into the
shared performance routes through the `PlanEngine` seam, so routes, runs, the snapshot and the report
are reused rather than copied. The frontend adds one page and a small component folder, and reuses
`PerformancePlanScreen` with source-aware views.

## Complexity Tracking

There are no constitution violations to justify. Two changes reach beyond the new package, and both
are bounded:

| Change | Why needed | Simpler alternative rejected because |
|---|---|---|
| The `PlanHandle.engine` seam (R2) | The shared routes read an OpenAPI context in six places. | A union context would branch about fifteen OpenAPI functions. A synthetic `ApiModel` would present collection content as specification content (constitution I, XIV). |
| The runtime change for every plan (R10) | Credential requests need multi-capture, status-checked token sources. Dynamic values and form bodies need runtime support. | A second runtime for collection plans would drift from the first, and would double AP-034 compatibility work. |
