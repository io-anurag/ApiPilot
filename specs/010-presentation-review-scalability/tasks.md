---

description: "Task list for AP-010 Presentation System & Review Scalability"
---

# Tasks: Presentation System & Review Scalability

**Input**: Design documents from `/specs/010-presentation-review-scalability/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/bulk-review-actions.md, quickstart.md

**Tests**: Test tasks ARE included, matching this repo's established testing philosophy
(CLAUDE.md §51–53) and this feature's own precedent (AP-009's tasks.md). plan.md names the test
surface explicitly: Vitest + React Testing Library on the `frontend` workspace only — no backend or
`packages/shared-domain` test changes, since research.md D2/D3/D4 confirm this feature changes no
backend behavior.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
delivered independently. Per plan.md, this feature touches the `frontend` workspace only — the
first AP-00x feature to need zero backend or shared-domain changes, because AP-009 already made
both target decision endpoints array-accepting (research.md D2).

**Post-`/speckit-analyze` revision**: This task list incorporates the two HIGH findings from the
`/speckit-analyze` pass run against the original 44-task version: **C1** (Workflow Review's new
bulk controls had no explicit keyboard/accessible-name coverage) and **U1** (FR-002's "same visual
treatment everywhere" had no shared component enforcing it — only per-file prose reuse notes). T009
onward is renumbered from the original version to make room for three new shared badge primitives.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web application in an npm-workspaces monorepo, per plan.md — this feature only touches
`frontend/src/` and `frontend/tests/unit/`. No `backend/` or `packages/shared-domain/` file is
created, modified, or tested by this feature (research.md D2–D4).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Introduce Tailwind CSS v4 into the frontend build for the first time (research.md D1 —
verified nothing in the repo uses it yet). This is additive: no existing build step is replaced.

- [X] T001 Add `tailwindcss` and `@tailwindcss/vite` to `frontend/package.json` dependencies and run `npm install` (research.md D1)
- [X] T002 [P] Register the `@tailwindcss/vite` plugin in `frontend/vite.config.ts` alongside the existing `@vitejs/plugin-react` plugin (depends on T001)
- [X] T003 [P] Create `frontend/src/index.css` with `@import "tailwindcss";` followed by an `@theme` block defining this feature's design tokens (`--color-brand-*`, `--color-success-*`, `--color-warning-*`, `--color-danger-*`, `--color-info-*`, `--color-surface-*`, `--color-background-*`, `--color-muted-*`, `--color-border-*`) per CLAUDE.md §29 — no `tailwind.config.js` file (CSS-first configuration only, CLAUDE.md §27) (depends on T001)
- [X] T004 Import `./index.css` once in `frontend/src/main.tsx` (depends on T003)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Two kinds of shared primitives every later phase builds on: the bulk-decision UI
(`ConfirmDialog`, `useBulkDecision`) that US1/US2 need, and three shared presentational components
(`HttpMethodBadge`, `StatusBadge`, `ProvenanceBadge`) that Phase 5's per-file styling tasks import —
added so FR-002's "same visual treatment everywhere" is enforced by one shared implementation
instead of by prose reuse notes repeated across files (`/speckit-analyze` finding U1).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for bulk-decision primitives

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T005 [P] Unit test for the bulk confirmation component in `frontend/tests/unit/ConfirmDialog.test.tsx`: renders the affected-item count and, when a reason is required, a reason field whose absence disables Confirm; Cancel invokes `onCancel` without invoking `onConfirm`; the initially-focused control is reachable by keyboard and shows a visible focus indicator (FR-011, FR-014, FR-015)
- [X] T006 [P] Unit test for the batching hook in `frontend/tests/unit/useBulkDecision.test.tsx`: a target id array larger than the batch-size threshold is split into ordered, contiguous chunks, calling the injected `submit` function once per chunk and updating `processed`/`succeeded`/`failed` between calls; a target array at or below the threshold results in exactly one call; per-item outcomes (`applied`/`finding`) returned by `submit` are aggregated individually, while a single chunk-level error is treated as failing every id in that chunk (FR-012, FR-020, research.md D3–D5)

### Implementation for bulk-decision primitives

- [X] T007 [P] Implement `frontend/src/components/ConfirmDialog.tsx`: a small, reusable, keyboard-accessible confirmation control taking `{ message, affectedCount, requireReason?, onConfirm, onCancel }`, following the `role="alert"` pattern already used elsewhere in this codebase for accessible status messaging — no dialog library is introduced (FR-011, FR-014, FR-015, research.md D1) (depends on T005)
- [X] T008 Implement `frontend/src/hooks/useBulkDecision.ts`: given a target id array and an async `submit(chunk)` function, splits it into ordered chunks above a fixed batch-size constant, calls `submit` sequentially, and exposes `{ total, processed, succeeded, failed, status, run(), cancel() }` per data-model.md's Bulk Decision Run (FR-020, research.md D5) (depends on T006)

### Tests for shared badge primitives (`/speckit-analyze` finding U1)

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T009 [P] Unit test for `frontend/tests/unit/HttpMethodBadge.test.tsx`: renders a distinguishable, non-color-only treatment for each HTTP method (GET/POST/PUT/PATCH/DELETE/...) it is given (FR-002, FR-016)
- [X] T010 [P] Unit test for `frontend/tests/unit/StatusBadge.test.tsx`: renders a distinguishable, non-color-only treatment for each stage status, analysis-issue severity, and scenario/workflow review decision state it is given (FR-002, FR-016)
- [X] T011 [P] Unit test for `frontend/tests/unit/ProvenanceBadge.test.tsx`: renders a distinguishable treatment for each provenance category (SPECIFICATION/RULE/AI/USER) it is given (FR-002)

### Implementation for shared badge primitives

- [X] T012 [P] Implement `frontend/src/components/HttpMethodBadge.tsx` — single source of truth for HTTP-method visual treatment (including its own Tailwind styling, not just markup — a badge component with no styling of its own would reintroduce the unstyled-default-markup problem this feature exists to fix), to be imported by `OperationList.tsx`, `OperationDetail.tsx`, and `TestScenarioReviewList.tsx` in Phase 5 (FR-001, FR-002) (depends on T009)
- [X] T013 [P] Implement `frontend/src/components/StatusBadge.tsx` — single source of truth for stage-status/severity/decision-state visual treatment, including its own Tailwind styling, to be imported by `WorkflowStageTracker.tsx`, `TestScenarioReviewList.tsx`, `TestScenarioReviewDetail.tsx`, and `WorkflowReviewStage.tsx` in Phase 5 (FR-001, FR-002, FR-016) (depends on T010)
- [X] T014 [P] Implement `frontend/src/components/ProvenanceBadge.tsx` — single source of truth for provenance visual treatment, including its own Tailwind styling, to be imported by `TestScenarioReviewList.tsx` and `TestScenarioReviewDetail.tsx` in Phase 5 (FR-001, FR-002) (depends on T011)

**Checkpoint**: `ConfirmDialog`, `useBulkDecision`, and the three shared badge components exist and
are tested — both bulk-review user stories and Phase 5's styling tasks can now be built.

---

## Phase 3: User Story 1 - Bulk-decide on generated test scenarios (Priority: P1) 🎯 MVP

**Goal**: Let a QA engineer accept or reject scenarios in groups — by the applied operation/category
filter, or by a manual multi-selection — while the existing single-scenario decision stays available,
so reviewing a real-world-sized scenario set (e.g. 371 scenarios) is practical.

**Independent Test**: Generate a test suite with a large number of scenarios, apply an operation or
category filter, and confirm a single confirmed action accepts/rejects every scenario matching that
filter; separately, multi-select an arbitrary set of scenarios and confirm a single action decides
only on that selection.

### Tests for User Story 1

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T015 [P] [US1] Component test in `frontend/tests/unit/TestScenarioReviewList.test.tsx`: renders one manual-selection checkbox per scenario row plus "Accept/Reject all filtered (N)" and "Accept/Reject selected (N)" trigger buttons whose displayed `N` matches the current filtered/selected count; changing the operation or category filter clears any existing manual selection (FR-004, FR-005, FR-019)
- [X] T016 [P] [US1] Extend `frontend/tests/unit/TestScenarioReviewAccessibility.test.tsx`: every new bulk-selection checkbox and bulk-trigger button is individually reachable by keyboard, has a distinguishing accessible name (not several controls announced identically), and shows a visible focus indicator (FR-014, FR-015)

### Implementation for User Story 1

- [X] T017 [US1] Add per-row manual-selection checkboxes and derived "Accept/Reject all filtered (N)" / "Accept/Reject selected (N)" trigger buttons to `frontend/src/components/TestScenarioReviewList.tsx`, each trigger opening `ConfirmDialog`; clear the manual selection whenever `operationFilter` or `categoryFilter` changes (FR-004, FR-005, FR-019, data-model.md: Scenario Review selection) (depends on T007, T015)
- [X] T018 [US1] In `frontend/src/components/ScenarioReviewStage.tsx`, wire the new bulk triggers to `useBulkDecision`, building `ReviewUpdateRequest[]` from the filtered/selected set (collecting one shared `reason` for a bulk reject, per contracts/bulk-review-actions.md) and submitting each chunk through the existing `applyScenarioDecisions` client function unchanged (FR-007, FR-010, FR-011) (depends on T008, T017)
- [X] T019 [US1] In `frontend/src/components/ScenarioReviewStage.tsx`, aggregate the `ReviewUpdateOutcome[]` returned per chunk into a succeeded/failed summary and surface each failed scenario's `finding.message`, without altering the existing single-scenario accept/reject/edit/regenerate handlers (FR-006, FR-012, research.md D3) (depends on T018)

**Checkpoint**: Scenario Review supports bulk accept/reject by filter and by manual selection, with a
mandatory confirmation step and partial-failure reporting; single-scenario review is unchanged. User
Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Bulk-decide on discovered integration workflows (Priority: P2)

**Goal**: Let a QA engineer approve or reject several discovered integration workflows in one
action, while the existing single-workflow decision stays available.

**Independent Test**: Generate a set of discovered integration workflows, select several, and
confirm a single confirmed action approves/rejects the whole selection; confirm a single workflow
can still be decided on its own.

### Tests for User Story 2

> **NOTE: Write this test FIRST and confirm it fails before implementing.**

- [X] T020 [P] [US2] Component test in `frontend/tests/unit/WorkflowReviewStage.test.tsx`: renders one manual-selection checkbox per workflow row plus "Approve/Reject selected (N)" trigger buttons; the existing single-workflow Approve/Reject controls remain present and functional; every new checkbox and bulk button is individually keyboard-reachable with a distinguishing accessible name (`/speckit-analyze` finding C1) (FR-008, FR-009, FR-014, FR-015)

### Implementation for User Story 2

- [X] T021 [US2] Add per-row manual-selection checkboxes and "Approve/Reject selected (N)" trigger buttons to `frontend/src/components/WorkflowReviewStage.tsx`, each opening `ConfirmDialog`, without changing the existing single-workflow `decide()` handler (FR-008, FR-009, FR-011, data-model.md: Workflow Review selection) (depends on T007, T020)
- [X] T022 [US2] In `frontend/src/components/WorkflowReviewStage.tsx`, wire the new bulk triggers to `useBulkDecision`, building `WorkflowDecisionInput[]` from the selection and submitting each chunk through the existing `recordWorkflowDecisions` client function unchanged; treat each chunk's single atomic response as wholly succeeded or wholly failed, per contracts/bulk-review-actions.md and research.md D4 (FR-010, FR-012) (depends on T008, T021)

**Checkpoint**: Workflow Review supports bulk approve/reject by manual selection, with a mandatory
confirmation step and chunk-level failure reporting; single-workflow review is unchanged. User
Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Coherent, legible presentation across the guided workflow (Priority: P3)

**Goal**: Present every stage of the guided workflow through one consistent Tailwind-based visual
and interaction system, with HTTP methods/statuses/severities/provenance shown consistently via the
shared badge components from Phase 2, loading/empty/error states always distinguishable, no
duplicate "AI enhancement skipped" notice, and every bulk/individual control operable by keyboard
with non-color-only status.

**Independent Test**: Walk every stage of the guided workflow end to end and confirm consistent
visual treatment for HTTP methods/statuses/severities/provenance, consistent loading/empty/error
states, exactly one AI-skip notice, and full keyboard operability.

### Tests for User Story 3

- [X] T023 [P] [US3] Update `frontend/tests/unit/WorkflowStageTracker.test.tsx`: replace the assertion that expected the tracker's own `workflow-ai-unavailable` status line with an assertion that the tracker no longer renders it, while `AiEnhancementStage`'s skip banner remains the sole place the notice appears (FR-013, research.md D6)
- [X] T024 [P] [US3] Extend `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx`: every stage screen visually distinguishes loading/populated/empty/error states; status/severity/provenance indicators are conveyed by text or icon in addition to color; and Workflow Review's bulk-selection checkboxes and bulk buttons are keyboard-reachable with distinguishing accessible names, mirroring T016's coverage of Scenario Review (`/speckit-analyze` finding C1) (FR-002, FR-003, FR-014, FR-015, FR-016)

### Implementation for User Story 3

- [X] T025 [US3] Remove the duplicate `workflow-ai-unavailable` block from `frontend/src/components/WorkflowStageTracker.tsx`, keeping only `AiEnhancementStage`'s skip banner as the sole surface for this notice (FR-013, research.md D6) (depends on T023)
- [X] T026 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/App.tsx` (FR-001, FR-002, FR-003)
- [X] T027 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/VersionBadge.tsx` (FR-001, FR-002, FR-003)
- [X] T028 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/pages/TestGenerationWorkflowPage.tsx` (FR-001, FR-002, FR-003)
- [X] T029 [US3] Apply consistent Tailwind utility styling to `frontend/src/components/WorkflowStageTracker.tsx`, using the shared `StatusBadge` component for per-stage status indicators (FR-001, FR-002, FR-003, FR-016) (depends on T025, T013)
- [X] T030 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/ApiReviewStage.tsx` (FR-001, FR-002, FR-003)
- [X] T031 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/AnalysisSummary.tsx` (FR-001, FR-002, FR-003)
- [X] T032 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/OperationList.tsx`, using the shared `HttpMethodBadge` component (FR-001, FR-002, FR-003) (depends on T012)
- [X] T033 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/OperationDetail.tsx`, using the shared `HttpMethodBadge` component (FR-001, FR-002, FR-003) (depends on T012)
- [X] T034 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/AiEnhancementStage.tsx` (FR-001, FR-002, FR-003)
- [X] T035 [US3] Apply consistent Tailwind utility styling to `frontend/src/components/ScenarioReviewStage.tsx`, including its new bulk controls from Phase 3 (FR-001, FR-002, FR-003) (depends on T019)
- [X] T036 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/TestScenarioReviewSummary.tsx` (FR-001, FR-002, FR-003)
- [X] T037 [US3] Apply consistent Tailwind utility styling to `frontend/src/components/TestScenarioReviewList.tsx`, including its new bulk controls from Phase 3, using the shared `HttpMethodBadge`, `StatusBadge`, and `ProvenanceBadge` components for method/decision-state/category display (FR-001, FR-002, FR-003) (depends on T017, T012, T013, T014)
- [X] T038 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/TestScenarioReviewDetail.tsx`, using the shared `HttpMethodBadge`, `StatusBadge`, and `ProvenanceBadge` components (FR-001, FR-002, FR-003) (depends on T012, T013, T014)
- [X] T039 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/TestScenarioReviewDecision.tsx` (FR-001, FR-002, FR-003)
- [X] T040 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/TestScenarioReviewRefinement.tsx` (FR-001, FR-002, FR-003)
- [X] T041 [US3] Apply consistent Tailwind utility styling to `frontend/src/components/WorkflowReviewStage.tsx`, including its new bulk controls from Phase 4, using the shared `StatusBadge` component for decision-state display and a consistent dependency-confidence treatment (FR-001, FR-002, FR-003) (depends on T022, T013)
- [X] T042 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/PostmanGenerationStage.tsx` (FR-001, FR-002, FR-003)
- [X] T043 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/PostmanExportLimitations.tsx` (FR-001, FR-002, FR-003)
- [X] T044 [P] [US3] Apply consistent Tailwind utility styling to `frontend/src/components/ConfirmDialog.tsx` (FR-001, FR-002, FR-003) (depends on T007)
- [X] T045 [US3] Verify no unstyled default markup remains anywhere in the live guided-workflow tree (every file touched by T012–T014 and T026–T044 has non-zero Tailwind utility usage), and that `frontend/src/components/PostmanExportPanel.tsx`, `TestScenarioList.tsx`, and `TestScenarioDetail.tsx` were correctly left untouched as out of scope (FR-001, SC-004, research.md D8) (depends on T012, T013, T014, T026–T044)

**Checkpoint**: Every guided-workflow screen presents consistently through the shared badge
components, the duplicate banner is resolved, and every bulk/individual control is keyboard-operable
with non-color-only status. All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T046 [P] Run `npm run lint` from the repository root and resolve any issues introduced by this feature
- [X] T047 [P] Run `npm run build` for the `frontend` workspace and resolve any type errors
- [X] T048 [P] Run `npm test` from the repository root and confirm the full suite passes, including every test added or updated by this feature
- [X] T049 Execute quickstart.md Scenarios 1–9 against a specification producing real-world scale (hundreds of scenarios, several discovered workflows), confirming SC-001–SC-008 — run against the real dev server (backend + frontend) with a 12-operation/55-scenario/4-workflow synthetic spec, driven both via direct API calls and a real headless-browser session. Confirmed bulk accept/reject by filter, bulk approve/reject by selection, the mandatory confirmation step, and partial-outcome reporting all work against the live backend. Caught and fixed a real bug in the process: `handleBulkDecision`/`handleConfirmBulk` discarded the updated `workflow` each chunk returned, so the list/summary never visually reflected a completed bulk decision even though the backend applied it correctly — fixed by forwarding the last chunk's returned workflow through the existing `onAdvanced` callback (does not touch the single-item `handleAccept`/`handleReject`/`decide()` handlers, preserving FR-006/FR-009). Re-verified visually after the fix: rows correctly show "Accepted"/"Approved" post-bulk-action.
- [X] T050 Review the final diff against spec.md/plan.md for scope compliance: confirm no `backend/` or `packages/shared-domain/` file changed (research.md D2/D4), no existing `data-testid` relied on by an untouched test was removed, no task modified `ReviewPolicy`/`DEFAULT_REVIEW_POLICY` in `packages/shared-domain/src/testScenarioReview.ts` (FR-017, `/speckit-analyze` finding C3), and `PostmanExportPanel.tsx`/`TestScenarioList.tsx`/`TestScenarioDetail.tsx` remain untouched (research.md D8) — verified via `git diff --stat`: zero backend/shared-domain files touched, zero diff on the three dead components, zero diff on `testScenarioReview.ts`; the full 568-test suite passing end to end confirms no relied-upon `data-testid` was removed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS both bulk-review user stories (via T005–T008) and blocks the badge-dependent subset of Phase 5's styling tasks (via T009–T014); Phase 5's badge-independent styling tasks only need Setup, not the badge tasks specifically
- **User Story 1 (Phase 3)**: Depends on Foundational T005–T008 — no dependency on User Story 2
- **User Story 2 (Phase 4)**: Depends on Foundational T005–T008 — no dependency on User Story 1; may be worked in parallel with it by a different developer
- **User Story 3 (Phase 5)**: Depends on Foundational for `ConfirmDialog` (T044) and the three badge components (T032, T033, T037, T038, T041); its styling tasks for `ScenarioReviewStage.tsx`/`TestScenarioReviewList.tsx` (T035, T037) depend on User Story 1's implementation tasks (T017–T019), and its styling task for `WorkflowReviewStage.tsx` (T041) depends on User Story 2's implementation tasks (T021–T022) — every other Phase 5 styling task is independent of US1/US2
- **Polish (Phase 6)**: Depends on all three user stories being complete

### Within Each User Story

- Tests are written first and must fail before implementation
- Within Phase 3: T017 (selection/trigger UI) precedes T018 (wiring to the batching hook), which precedes T019 (outcome aggregation) — all three edit the same two files
- Within Phase 4: T021 precedes T022 for the same reason
- Within Phase 5: the banner-removal task (T025) precedes that file's styling task (T029); each `TestScenarioReviewList.tsx`/`ScenarioReviewStage.tsx`/`WorkflowReviewStage.tsx` styling task waits for that file's own US1/US2 behavioral tasks to land first, so styling is applied once per file, not twice; `OperationList.tsx` and `OperationDetail.tsx` (T032, T033) no longer depend on each other — both depend directly on the shared `HttpMethodBadge` (T012) instead, so they run fully in parallel

### Parallel Opportunities

- T002 and T003 (Phase 1) run in parallel once T001 completes
- T005/T006 and T009/T010/T011 (Foundational tests) all run in parallel; T007/T008 and T012/T013/T014 (Foundational implementation) run in parallel once their respective tests exist
- Once Foundational is complete, User Story 1 (Phase 3) and User Story 2 (Phase 4) can proceed fully in parallel — they touch entirely disjoint files
- Within Phase 5, every styling task not explicitly marked with a dependency in the list above runs in parallel; T026, T027, T028, T030, T031, T032, T033, T034, T036, T039, T040, T042, T043 have no dependency on US1/US2 and can start as soon as Foundational is done, even before Phase 3/4 finish
- With multiple developers: after Phase 2, Developer A can take US1 (Phase 3), Developer B can take US2 (Phase 4), and Developer C can start the independent half of Phase 5's styling tasks immediately, joining T035/T037/T041 once US1/US2 land

---

## Parallel Example: Foundational + User Stories 1 & 2

```bash
# Foundational tests, in parallel (bulk-decision primitives and badge primitives are independent of each other):
Task: "Unit test for ConfirmDialog in frontend/tests/unit/ConfirmDialog.test.tsx"
Task: "Unit test for useBulkDecision in frontend/tests/unit/useBulkDecision.test.tsx"
Task: "Unit test for HttpMethodBadge in frontend/tests/unit/HttpMethodBadge.test.tsx"
Task: "Unit test for StatusBadge in frontend/tests/unit/StatusBadge.test.tsx"
Task: "Unit test for ProvenanceBadge in frontend/tests/unit/ProvenanceBadge.test.tsx"

# Once Foundational (T007, T008) is done, User Story 1 and User Story 2 proceed fully in parallel:
Task: "Bulk selection/trigger UI in frontend/src/components/TestScenarioReviewList.tsx"     # US1
Task: "Bulk selection/trigger UI in frontend/src/components/WorkflowReviewStage.tsx"        # US2

# Independent Phase 5 styling tasks can start immediately after Foundational, without waiting on US1/US2:
Task: "Style frontend/src/App.tsx"
Task: "Style frontend/src/components/VersionBadge.tsx"
Task: "Style frontend/src/pages/TestGenerationWorkflowPage.tsx"
Task: "Style frontend/src/components/ApiReviewStage.tsx"
Task: "Style frontend/src/components/AnalysisSummary.tsx"
Task: "Style frontend/src/components/OperationList.tsx"
Task: "Style frontend/src/components/OperationDetail.tsx"
Task: "Style frontend/src/components/AiEnhancementStage.tsx"
Task: "Style frontend/src/components/TestScenarioReviewSummary.tsx"
Task: "Style frontend/src/components/TestScenarioReviewDecision.tsx"
Task: "Style frontend/src/components/TestScenarioReviewRefinement.tsx"
Task: "Style frontend/src/components/PostmanGenerationStage.tsx"
Task: "Style frontend/src/components/PostmanExportLimitations.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (Tailwind wired in)
2. Complete Phase 2: Foundational — `ConfirmDialog` and `useBulkDecision` block both review stories (the badge components can be deferred if only US1 is wanted, since Phase 3 doesn't depend on them)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: generate a large scenario set, confirm bulk accept/reject by filter and by
   selection works with confirmation and partial-failure reporting, and that single-scenario review
   still works
5. Demo bulk Scenario Review — this alone resolves the largest usability blocker found during the
   real-world pass

### Incremental Delivery

1. Setup + Foundational → shared bulk-decision UI and badge primitives ready
2. Add US1 → Scenario Review is practical at real scale (MVP)
3. Add US2 → Workflow Review is practical at real scale
4. Add US3 → the entire guided workflow is visually consistent, coherent, and fully accessible
5. Each story adds value without breaking the previous ones; US3 does not change functionality
   introduced by US1/US2, only its presentation

---

## Notes

- [P] tasks = different files, no dependencies
- Every task in Phases 3–5 carries its story label for traceability
- No new dependency is introduced anywhere in this feature except Tailwind CSS itself and its
  official Vite plugin (plan.md Technical Context) — no backend route, shared-domain type, or client
  function signature changes anywhere (research.md D2–D4)
- `frontend/src/components/PostmanExportPanel.tsx`, `TestScenarioList.tsx`, and
  `TestScenarioDetail.tsx` (plus their dedicated tests) are dead code already unreached by the live
  guided workflow and are explicitly out of scope (research.md D8) — do not touch them
- `HttpMethodBadge.tsx`, `StatusBadge.tsx`, and `ProvenanceBadge.tsx` (T009–T014) exist specifically
  so FR-002's cross-screen consistency is guaranteed by shared code, not by independently re-reading
  the same prose instruction in 19 separate styling tasks (`/speckit-analyze` finding U1)
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
