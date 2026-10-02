# Implementation Plan: User-Defined Journeys and Captured Values for Performance Tests

**Branch**: `035-user-defined-journeys` (git branch `AP-035`) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/035-user-defined-journeys/spec.md` (AP-035)

## Summary

On both performance paths, the engineer can compose their own journeys from the plan's operations,
capture values from a step's response, and bind them into later steps of the same journey.

**Model.** User-defined journeys are stored as definitions in the plan's choices, like AP-033's
body and parameter edits. `assemblePlan` re-resolves them on every assembly (research R1, R4):
- a definition whose operation is missing becomes an **incomplete** journey that is not run;
- a binding whose target vanished becomes **target-missing** and blocks script generation;
- deleting a journey returns its operations as single-step journeys.

**Ids.** Ids come from server-kept sequence numbers. An operation can therefore appear more than
once per journey, and each occurrence keeps its own expected statuses and edits (R2).

**Writes.** One field, `PUT /plan { userJourneys }`, carries the complete list, so every check sees
the result of the edit (R3). Restore sends a snapshot's list back unchanged (R12).

**Captures and bindings ride on the existing workflow-variable path.** A binding becomes a
`consumes` entry with `producerStepId`. Because of that, these keep working unchanged:
- request substitution and serialization;
- the request preview;
- the "Replaced at run time" list;
- environment-value accounting;
- the AP-029 order check.

`stepRequestFor` is refactored to read bindings from the step rather than from the workflow by
position (R5). Capture paths follow a closed grammar of field names and array positions, parsed on
the server and written into the script only as data (R6).

**Runtime.** The fixed k6 runtime changes once, for every plan (R7):
- captures are attempted only on an expected status;
- a capture succeeds only for a scalar value;
- header captures are matched case-insensitively;
- a new `apipilot_capture` counter gives per-capture success and failure counts for the report
  (R13).

This amends AP-029 FR-010 for proposed workflow journeys too (see Open items).

**Other parts:**
- The guided path can convert a proposed workflow journey into an editable "based on workflow"
  journey, and revert it (R14).
- The write summary counts steps rather than operations (R15).
- The UI extends the existing operations table and step inspector with journey controls, a Captures
  tab and a binding source per parameter or body field (R16).

The feature adds no dependency, no AI, no configuration and no table.

## Technical Context

**Language/Version**:
- TypeScript on Node.js 24 LTS for the backend.
- React with TypeScript for the frontend.
- k6 1.0.0 or later, installed by the engineer (the existing readiness probe).

**Primary Dependencies**: Existing only: Express, React, Vite, Tailwind CSS v4, and `acorn` (the
AP-034 script check, re-run on the generated script). No new dependency (R18).

**Storage**:
- Plans stay in memory: guided in the session workflow, quick in the quick-test store.
- Run snapshots stay in `performance_runs.plan_snapshot` (SQLite, unencrypted). Their content
  class is unchanged: names, operation keys, field paths, and no values (R12).
- No schema change. Older snapshots are read with defaults.

**Testing**:
- Vitest unit and integration tests, with Supertest, the `k6Sandbox` script runtime and the fake
  runner.
- Golden fixtures: the existing one regenerated once, plus one new.
- React Testing Library.
- One opt-in real-k6 case in `npm run test:k6-real -w backend` (R19).

**Target Platform**: a local web application, with the browser and the Node backend on one
machine. k6 runs on the backend's machine.

**Project Type**: a web application in the npm-workspaces monorepo: `backend/`, `frontend/`,
`packages/shared-domain/`.

**Performance Goals**:
- SC-001: three single-step journeys to one chained journey with a generated script, in under 3
  minutes.
- Assembly cost grows linearly with steps. Each journey has at most 20 steps and each step at most
  10 captures.
- The documented-field walk is capped at depth 8 and 300 fields (R9).
- Runtime overhead per capture is one walk of the response, which the existing workflow variables
  already pay.

**Constraints**:
- **Constitution XVII**, the 2026-09-24 exception as clarified on 2026-09-29 (v2.6.0). Every
  condition holds:
  - captures and bindings are data only: closed path grammar, header token, names (R6, R8, R11);
  - the runtime text is identical for every plan (R7);
  - no captured value exists outside one virtual user's journey run (FR-020);
  - user-defined steps are marked in the plan, snapshot and report (FR-022, FR-027, FR-029).
- **FR-020.** No captured value is logged, stored, reported or shown. Seeded-value scans run in
  integration and real-k6 tests (R19).
- **Unchanged.** Generated runs keep their argument list, environment and AP-034 check
  compatibility. Plans without user journeys keep their ids and fingerprint (R2, R17).

**Scale/Scope**:
- Any number of user journeys, bounded by the existing `PUT /plan` body limit (R11).
- Up to 20 steps per journey and 10 captures per step.
- The existing one-run-per-session slot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v2.6.0. `specs/constitution.md` is identical,
with the same SHA-256 (`7fcc41e0…`).

The spec asks this check to confirm its governance reading or raise an amendment. **It is
confirmed: no constitution amendment is needed.**
- Under the XVII 2026-09-24 exception as clarified on 2026-09-29, inputs the user edits in the
  plan are part of the approved plan when three conditions hold:
  - they are written only as data;
  - they carry no secret;
  - the steps carrying them are marked.
- A capture is a field path or a header name, and a binding names a capture and a target. Both are
  data, and neither carries a value (R6, R8, data-model).
- XV is respected because ApiPilot never creates a journey or binding unasked (FR-006). The one
  server-built definition comes from the engineer's explicit **Edit journey** (R14).

| Principle | Status | How the design complies |
|---|---|---|
| I. Specification is the source of truth | Pass | Documented fields come from the ApiModel only (R9). An undocumented path is accepted with a warning, never presented as documented. No expected status is invented. |
| II to VII, XXII, XXIII, XXIX. AI principles | N/A | No AI (FR-032, R18). |
| VIII. Framework-independent model | Pass | Definitions, captures and bindings are shared-domain types. k6 specifics stay in `renderScript.ts`. |
| IX. Separation of concerns | Pass | Validation, assembly, the path grammar, field listing and conversion are pure modules in `performance/plan/`. `PUT /plan` stays a thin adapter. The UI only composes `PlanUpdate`s. |
| X. Domain model first | Pass | data-model.md. The types are added before routes and UI. |
| XI. Human in the loop | Pass | Every journey, step, capture and binding is an explicit action. Binding over an edited parameter, delete and revert each ask first (FR-014, FR-004, FR-024). |
| XIII. Provenance | Pass | Each journey has an origin: proposed, defined by you, or based on workflow. Steps are marked `userDefined`. Converted bindings keep relationship and confidence. The report states each bound value's source (FR-022, FR-027, FR-029). |
| XIV. No silent assumptions; XIX. Fail safely | Pass | Refusals name the capture and steps (R10). A vanished target blocks and is listed rather than being dropped (FR-016). An incomplete journey is shown, not shortened (FR-025). A failed capture cuts the journey short (FR-019). |
| XV. Conservative dependency inference | Pass | No inference on either path. The quick context keeps `workflows: []`, and the field-name match in the picker is a hint that binds nothing (R9, R18). |
| XVI. Deterministic artifacts | Pass | Ids come from stored sequence numbers. Data is sorted or ordered by the plan. The runtime text is fixed. Byte-identity is tested ten times (SC-004, R2, R7, R19). |
| XVII. Security and privacy (2026-09-24 exception, 2026-09-29 clarification) | Pass | Every condition is mapped under Constraints above. The exact bytes run are the generated bytes, as before. |
| XVIII. Secrets not in artifacts | Pass | A capture may hold a secret at run time and is treated as secret everywhere. It exists only in `scope.vars` and is never tagged, logged or reported. Binding to authentication is out of scope (spec Edge Cases). |
| XX. Observability without sensitive logging | Pass | Logs hold ids, counts and codes only, not capture names, paths or values (contract Logging). |
| XXI. Testability | Pass | Pure validators and assembly. The sandboxed runtime. The fake runner. Opt-in real k6 only. |
| XXIV. Reproducibility | Pass | The same plan gives the same script. The same run data gives the same findings (ruleset version 2, R13). |
| XXV. Incremental delivery | Pass | P1, P2 and P3 follow the user stories (R20). |
| XXVI. Traceability | Pass | FR, SC and R references run through the contracts, data model and quickstart. Three earlier-spec amendments are listed below. |
| XXVII. Simple architecture | Pass | One `PUT` field rather than ten command routes. One substitution path. One new read route. No new table (R3, R5). |
| XXVIII. Technology is replaceable | Pass | The path grammar and capture semantics are domain types. k6 sees only rendered data. |
| XXX. Explicit trade-offs | Pass | Recorded in research: the full-list write (R3), the strict grammar (R6), one runtime rule (R7), the unsplit header value (R8), no listed headers (R9), and losing settings on revert (R14). |
| XXXI. Definition of done | Pass, planned | Quickstart 1 to 8, docs, spec pointers for the amendments, the version bump and the roadmap. |
| XXXII. Review at scale | Pass | Field list bounded and sorted. Journey and capture limits. One table with filters (R9, R11, R16). |
| XXXIII. Presentation | Pass | AP-027 components and tokens. Origin, incomplete, target-missing and undocumented states are shown in text, not colour alone. Button-based reordering stays keyboard accessible (R16). |

**Gate result: PASS.** No violations, and no constitution amendment.

**Re-check after Phase 1 design: PASS.** The design adds:
- four `PUT /plan` fields;
- one read route;
- one `POST /script` refusal;
- one runtime counter;
- optional result fields.

It adds no new network destination, stored value, execution path or AI. The generated script is
still a pure function of the plan.

## Open items for the engineer's confirmation

These are not constitution issues. They change or narrow earlier behaviour, so they are surfaced
rather than decided silently (CLAUDE.md §63).

1. **Resolved 2026-10-02 (spec Clarifications, FR-033): AP-029 FR-010 is amended (R7).** One
   capture rule for every plan:
   - workflow-variable extraction in **proposed** journeys is also skipped on an unexpected status,
     and cuts the journey short;
   - an object or array value fails, rather than being sent as text.
2. **Resolved 2026-10-02 (spec Edge Cases): repeated response headers (R8).** A header capture
   takes the value as k6 reports it, never split.
3. **Response headers are not listed (R9).** The ApiModel does not keep response headers, so
   header captures are typed by name only and carry no documented or undocumented warning.
   FR-009 asks for documented body fields only, so it is met.
4. **Resolved 2026-10-02 (spec FR-024): revert carries settings back (R14).** Settings on steps
   that came from the workflow return to the proposed steps. Settings on steps the engineer added
   are discarded, and the confirmation names them.
5. **AP-032 FR-009 and FR-011 (R15).** The write summary counts steps. This differs only for an
   operation in more than one step.

## Project Structure

### Documentation (this feature)

```text
specs/035-user-defined-journeys/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1 to R20
├── data-model.md        # Phase 1: shared types, plan and result extensions, lifecycle
├── quickstart.md        # Phase 1: validation scenarios 1 to 8
├── contracts/
│   ├── plan-journeys-api.md           # PUT /plan fields, response-fields route, script refusal
│   └── changes-to-existing-apis.md    # runtime, assembly, report, write summary, frontend
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/shared-domain/src/
└── performance.ts                     # + Capture, ValueBinding, UserJourneyDefinition, journey
                                       #   source "user", plan fields, PreviewReference "capture",
                                       #   result fields; summarizeWriteOperations counts steps

backend/src/
├── performance/
│   ├── plan/
│   │   ├── userJourneys.ts            # NEW: validate (R10, R11), assign ids (R2), resolve (R4)
│   │   ├── capturePath.ts             # NEW: R6 grammar (pure)
│   │   ├── responseFields.ts          # NEW: R9 documented fields (pure)
│   │   ├── convertWorkflowJourney.ts  # NEW: R14 (pure)
│   │   ├── buildPlan.ts               # choices, assembly, fingerprint (R1, R4, R17)
│   │   ├── planStepRequest.ts         # bindings from the step (R5)
│   │   ├── planUpdate.ts              # + userJourneys, alsoStandalone, edit/revertProposedJourney
│   │   ├── bodyEdits.ts               # reserved prefix; dropped-binding notice
│   │   ├── requestPreview.ts          # capture references
│   │   └── runSnapshot.ts             # keep definitions (R12)
│   ├── k6/renderScript.ts             # captures data, runtime rule, counter (R7, R13)
│   ├── report/
│   │   ├── aggregate.ts               # capture counts (R13)
│   │   ├── findings.ts                # ruleset 2 (R13)
│   │   └── renderHtmlReport.ts        # bound sources, capture counts, origin
│   └── errors.ts                      # new error classes
├── api/
│   ├── performanceRoutes.ts           # + GET /plan/response-fields; script refusal
│   └── performanceHttp.ts             # error mapping
└── persistence/performanceRunRepository.ts   # snapshot defaults on read

backend/tests/
├── unit/performance/                  # userJourneys, capturePath, responseFields,
│                                      #   convertWorkflowJourney, buildPlan, renderScript
│                                      #   (sandbox), aggregate, findings, report
├── integration/performance/           # userJourneyRoutes (both paths), restore round-trip,
│                                      #   seeded-value scan
├── integration/performance.k6.real.test.ts   # + chained journey (opt-in)
├── fixtures/openapi/user-journeys.yaml       # NEW
└── fixtures/performance/golden/       # script.js regenerated; user-journeys script NEW
backend/scripts/perfStubTarget.ts      # + stateful customers mode

frontend/src/
├── services/performanceTestingClient.ts      # PlanUpdate, fetchResponseFields, extras
├── components/performance/
│   ├── JourneyList.tsx                # origin labels, incomplete, controls, Captures tab
│   ├── UserJourneyControls.tsx        # NEW
│   ├── AddStepDialog.tsx              # NEW
│   ├── CaptureEditor.tsx              # NEW
│   ├── BindingSourceControl.tsx       # NEW
│   ├── StepParameterEditor.tsx        # binding source
│   ├── StepBodyEditor.tsx             # bind a field
│   ├── PreviewReferenceNote.tsx       # capture wording
│   ├── WriteOperationSummary.tsx      # per-step counts
│   ├── PerformancePlanScreen.tsx      # pending item, explain(), generate gate
│   ├── restoreFromRun.ts              # definitions (R12)
│   └── performanceViewModel.ts        # labels
└── pages/QuickPerformancePage.tsx     # FR-031 scope note
frontend/tests/unit/                   # plan screen, journeys, captures, bindings, restore

docs/USER_MANUAL.md, docs/architecture.md, specs/ROADMAP.md,
specs/031-k6-performance-testing/spec.md (FR-010, FR-024b pointers),
specs/032-quick-performance-test/spec.md (FR-006, FR-009, FR-011 pointers),
specs/031-k6-performance-testing/contracts/performance-api.md (pointer),
package.json ×4 + package-lock.json (19.15.0 → 19.16.0, `npm run version:bump -- feature`)
```

**Structure Decision**: This uses the existing web-application layout. The feature is mostly new
pure modules in `backend/src/performance/plan/`, which hang off the single assembly point
`assemblePlan`. It extends the existing `PUT /plan` and adds one read route, so there is no new
route family. The script runtime is changed in place, because FR-018 requires one runtime for every
plan. The frontend extends the shared `PerformancePlanScreen` and `JourneyList`, so both paths get
the feature from one implementation.

## Complexity Tracking

No constitution violations to justify. The R5 refactor of `stepRequestFor` is required, because
the current function cannot express user journeys. The golden fixture bounds it.
