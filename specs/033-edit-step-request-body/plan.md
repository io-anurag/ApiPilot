# Implementation Plan: Edit a Performance Step's Request Body

**Branch**: `033-edit-step-request-body` (git branch `AP-033`) | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/033-edit-step-request-body/spec.md` (AP-033)

## Summary

The engineer can edit the body a performance step sends, on the plan screen that the guided and
quick paths share. The script then sends the edited body.

What the engineer edits is the step's **base body**: the body before ApiPilot's substitutions.
ApiPilot then applies the same substitutions it applies to a generated body:
- workflow variables at their consumer field;
- per-iteration unique values at their field path;
- credential references by field name.

Because of this, the references keep working, and ApiPilot's positional token names never enter
stored text (research R1).

The edit is stored in the plan (`bodyEdits`, a parsed JSON value or text) and fingerprinted, so a
generated script becomes out of date. It is applied through one function, used both by plan
assembly and by the `stepRequestFor` that the script and the preview already share. The preview
therefore stays byte for byte what the script sends (R3).

Saving goes through the existing `PUT /plan` and is all or nothing. It checks:
- that the step can have a body and the content type matches;
- the 64 KiB limit and valid JSON;
- that no reserved reference is used;
- that no literal value is written into a `format: password` field (R6, R8).

Schema mismatches are listed as warnings and never block (R7).

Runs store a snapshot with no body content, only a `bodyEdited` flag per step, and the report says
which steps sent an engineer-written body (R11).

No dependency, no configuration, no migration and no AI are added. A plan with no edits keeps its
exact fingerprint and script bytes (R10).

## Technical Context

**Language/Version**: TypeScript on Node.js 24 LTS for the backend; React with TypeScript for the
frontend. The generated artifact is AP-029's k6 script, unchanged in form.

**Primary Dependencies**: existing only: Express, React, Vite, Tailwind CSS v4. There is no JSON
Schema library; the mismatch checker is a small pure module over `SchemaConstraint` (R7).

**Storage**:
- Body edits live in memory, in the session's performance plan (the guided workflow state or the
  quick test store), and are lost on backend restart, like the plan (spec Assumptions).
- `performance_runs` is unchanged. The per-step `bodyEdited` flags ride in the existing
  `plan_snapshot` JSON, and body content is never stored (R11).

**Testing**: Vitest (unit), Supertest (routes), React Testing Library (UI), the k6 sandbox for
what the script sends, and the opt-in `npm run test:k6-real -w backend`.

**Target Platform**: the local web application; browser and backend on one machine.

**Project Type**: web application in the npm-workspaces monorepo (`backend/`, `frontend/`,
`packages/shared-domain/`).

**Performance Goals**:
- SC-001: an edit reaches the next generated script in under a minute of user time.
- Server work per save is one parse of at most 64 KiB, one plan assembly (already done for every
  `PUT /plan`) and one schema walk bounded by `MAX_TRAVERSAL_DEPTH`.
- Plan responses grow by the stored edits only: at most 64 KiB per edited step.

**Constraints**:
- **Constitution v2.5.0 XVII exception, as amended for AP-033**:
  - edited content enters the script only as data;
  - no secret literal in a `format: password` field;
  - edited steps are marked in the plan, the run snapshot and the report, with no content;
  - every existing condition is enforced unchanged by the one shared `POST /runs`.
- A byte-identical script and template for the same plan and edits (FR-015). Byte-identical output
  for plans without edits (R10).
- No environment value in any response, preview, script, template, report or log (AP-032 FR-008).
- No body text or parser message in any log (R14).
- No `pattern` regex from the specification is ever evaluated (R7).

**Scale/Scope**: plans of 100 or more steps (SC-006: find and reset every edited body in one
action each). One plan per path per session, as today.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.5.0 (`specs/constitution.md` is
byte-identical).

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | Bodies are editable only where the specification documents one (FR-003, R6). Mismatch warnings come only from the request schema (R7). No body is added to an operation that documents none. |
| II. Deterministic before AI; III. AI is an assistant | Pass | No AI. Edits are the engineer's explicit input. |
| IV to VII, XXII, XXIII, XXIX. AI principles | N/A | No AI. |
| VIII. Framework-independent model | Pass | `BodyEdit`, `BodyMismatch` and the preview fields have no k6 syntax. k6 stays in `performance/k6/`. |
| IX. Separation of concerns | Pass | Validation, mismatch checking and application are pure modules in `performance/plan/`. Routes stay thin (`applyPlanUpdate`). The Postman builder and workflow substitution are reused, not changed, except for the edited-step consumer guard (R4). |
| X. Domain model first | Pass | Changes are in `shared-domain/performance.ts` first (data-model.md). |
| XI. Human in the loop | Pass | Edits are user-defined content, marked "Body edited" on the plan and "Body edited by you" in the report, and distinguished from generated bodies (FR-008, FR-014). |
| XII. Quality over quantity | N/A | No scenarios are added. |
| XIII. Provenance | Pass | Each edit records its step, operation and scenario. Runs and reports record which steps sent an edited body (R11). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | Dropped references are stated (FR-010). Discarded edits are named after a rebuild (FR-018). Every refusal is a typed 400 with the step and the reason, and nothing half-applies (R6). Sensitive fields are identified from the schema, not guessed (R8). |
| XV. Conservative dependency inference | Pass | No inference changes. A dropped consumer is announced, never re-bound elsewhere. |
| XVI. Deterministic artifacts | Pass | The parsed value is stored and serialized as generated bodies are (R2). The fingerprint covers edits (R10). The golden files stay byte-identical. |
| XVII. Security and privacy (v2.5.0) | Pass | This is the amendment made for this feature. Data-only embedding is pinned by a hostile-content test (R5). The password-field rule and the edited-step marking are designed in (R8, R11). The run route and its check order are unchanged. |
| XVIII. Secrets not in artifacts | Pass | Secrets only as `{{name}}` resolved from the environment. Credential substitution still applies to edited bodies (R4). A seeded-secret scan covers the preview, script, template, snapshot and report. The known limit for untyped fields is recorded (R8). |
| XX. Observability without sensitive logging | Pass | Only `bodyEditCount` is added to an existing event (R14). |
| XXI. Testability | Pass | The validation, checker, effective-scenario and snapshot functions are pure and unit-tested. Routes are tested with Supertest, and the sent body through the k6 sandbox. |
| XXIV. Reproducibility | Pass | As XVI. |
| XXV. Incremental delivery | Pass | US1 (show the body or "no body") ships alone. US2 and US3 form the editing MVP. US4 (reset) follows. |
| XXVI. Traceability | Pass | FR, SC and R references run through the contracts, data model and quickstart. The AP-029 and AP-032 contract changes are listed in [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md). |
| XXVII. Simple architecture | Pass | One edit route (the existing one), one stored list, no new table or column, no editor library. |
| XXVIII. Technology is replaceable | Pass | The k6 boundary is unchanged. |
| XXX. Explicit trade-offs | Pass | Recorded in research: the base body over as-sent text (R1), a parsed value over text (R2), no `pattern` or unknown-field warnings (R7), and the untyped-secret limit (R8). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 9, the user manual (§3.11), architecture.md, the ROADMAP entry and a MINOR version bump (19.10.0) are included. |
| XXXII. Review at scale | Pass | A counted "Body edited" filter and reset-all in one confirmed action (SC-006). |
| XXXIII. Presentation | Pass | Built from existing components (`CodeBlock`, `StatusBadge`, `ConfirmDialog`, `ErrorState`) and Tailwind tokens. Every state is in text, not colour alone. |

**Gate result: PASS.** No violations. The feature relies on the v2.5.0 XVII amendment, and each of
its added conditions is designed in.

**Re-check after Phase 1 design: PASS.** The data model and contracts add:
- one field to an existing route body;
- three plan fields;
- one optional step flag;
- two preview fields.

None of these adds an execution path, a stored secret, a network call or a stored body outside the
session's plan. The spec amendment in R1 (FR-009's "move") narrows what the engineer can do and
widens no principle.

## Project Structure

### Documentation (this feature)

```text
specs/033-edit-step-request-body/
├── plan.md              # This file
├── research.md          # Phase 0: R1 to R14
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1: scenarios 1 to 9
├── contracts/
│   ├── body-edits-api.md
│   └── changes-to-existing-apis.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── performance.ts                 # BodyEdit, BodyEditNotice, BodyMismatch, StepBodyStatus,
                                   # StepBodyEditModel; PerformancePlan, PerformanceStep and
                                   # StepRequestPreview fields

backend/src/performance/plan/
├── bodyEdits.ts                   # NEW: effectiveScenario, validateBodyEdits (R6, R8),
│                                  #      carry-over (R9), notices (R4)
├── bodySchemaMismatches.ts        # NEW: pure checker over SchemaConstraint (R7)
├── buildPlan.ts                   # choices carry bodyEdits; fingerprint when not empty;
│                                  #   rebuildPlan discards by scenario
├── buildJourneys.ts               # makeStep uses effectiveScenario; bodyEdited flag
├── planStepRequest.ts             # stepRequestFor uses effectiveScenario
├── stepRequest.ts                 # edited-step guard for body consumers (R4)
├── planUpdate.ts                  # accepts bodyEdits
├── requestPreview.ts              # bodyStatus, bodyEdit (R12)
└── runSnapshot.ts                 # NEW: planSnapshotForRun (R11)

backend/src/api/
├── performanceRuns.ts             # stores planSnapshotForRun(plan)
└── performanceHttp.ts             # maps the new 400 errors

backend/src/performance/report/renderHtmlReport.ts   # "Body edited by you", provenance count
backend/src/persistence/performanceRunRepository.ts  # defaults for pre-AP-033 snapshots

backend/tests/
├── fixtures/openapi/body-edits.yaml                 # NEW (quickstart prerequisites)
├── unit/performance/bodyEdits.test.ts               # NEW
├── unit/performance/bodySchemaMismatches.test.ts    # NEW
├── unit/performance/renderScript.test.ts            # hostile-content test; golden unchanged
├── unit/performance/requestPreview.test.ts          # bodyStatus, bodyEdit
├── unit/performance/report.test.ts                  # marker, provenance, no content
├── integration/performance/planRoutes.test.ts       # PUT bodyEdits, errors, both paths
└── integration/performance.k6.real.test.ts          # opt-in edited-body case

frontend/src/
├── services/performanceTestingClient.ts             # PlanUpdate.bodyEdits
├── components/performance/StepBodyEditor.tsx        # NEW (R13)
├── components/performance/StepRequestPreview.tsx    # body status text; hosts the editor
├── components/performance/JourneyList.tsx           # marker, filter chip, reset all
├── components/performance/PerformancePlanScreen.tsx # wires bodyEdits; discarded note
└── pages/QuickPerformancePage.tsx                   # replace-confirmation text

frontend/tests/unit/
├── StepBodyEditor.test.tsx                          # NEW
├── StepRequestPreview.test.tsx
└── PerformancePlanScreen.test.tsx

docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md
```

**Structure Decision**: This is the existing web-application layout. All domain logic goes into
`backend/src/performance/plan/` as pure modules next to the ones they extend. Contracts go into
the shared-domain package first. The frontend adds one component and extends the three that
already render the plan's steps.

## Complexity Tracking

No constitution violations to justify.
