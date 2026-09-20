---

description: "Task list for Frontend Design System & Application Shell"
---

# Tasks: Frontend Design System & Application Shell

**Input**: Design documents from `/specs/027-frontend-design-system/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md)

**Tests**: Included as part of each implementation task (this repo's convention is one Vitest +
Testing Library file per component, plus dedicated accessibility test files) — not a strict
TDD/tests-first gate, per CLAUDE.md's testing philosophy ("tests are part of the feature").

**Organization**: Tasks are grouped by user story (US1/US2/US3, matching spec.md's priorities)
so each story is independently implementable, testable, and shippable.

> Revision note: T013/T014 (Tabs) and T040 (Tabs test) were added, and everything from the
> original T013 onward renumbered accordingly, following `/speckit-analyze` finding E1 (FR-006's
> "tabbed content panels" clause had zero task coverage). See research.md D6/D7 and plan.md's
> Project Structure for the corresponding spec/plan updates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, or US3 — omitted for Setup/Foundational/Polish tasks
- File paths below are relative to the repository root

## Path Conventions

Single-project frontend feature — all paths are under `frontend/` (see plan.md's Project
Structure). No `backend/` or `packages/shared-domain/` changes (FR-012).

---

## Phase 1: Setup

**Purpose**: Establish the regression baseline this feature must not break (SC-003).

- [ ] T001 Run `npm test -w frontend`, `npm run lint -w frontend`, and `npm run build -w frontend`
  from the repo root; record the current pass/fail counts as the baseline that Phase 6 (Polish)
  will diff against.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by all three user stories.

None. Research (research.md D1–D7) found no infrastructure that every story depends on: US1
(shell/navigation), US2 (shared empty/error/loading/dialog/tabs primitives), and US3 (dark mode,
responsiveness, keyboard/contrast) each touch their own new files and only overlap where one
story extends a file another story created — those dependencies are called out inline in each
task below (e.g., US2's T035 depends on US1's T004; US3's dark-mode tasks depend on the files
US1/US2 create). Proceed directly to Phase 3.

---

## Phase 3: User Story 1 - Always know where you are in the workflow (Priority: P1) 🎯 MVP

**Goal**: One consistent header + workflow navigation, reused everywhere, with every stage's
completed/active/pending/locked status visible and every locked stage explaining why.

**Independent Test**: Upload a spec and advance through a few stages; confirm the same header and
`WorkflowStageTracker` presentation appears throughout, stage statuses are correct, and any
locked stage shows its reason — independently of whether US2/US3 have landed yet.

- [ ] T002 [P] [US1] Create `frontend/src/components/workflowStageViewModel.ts`: move
  `STAGE_LABELS` out of `frontend/src/components/WorkflowStageTracker.tsx` (currently private) into
  this new file as the exported single source of truth, and add a `getLockReason(stageId,
  workflow)` function implementing data-model.md's rule (the label of the nearest predecessor in
  `WORKFLOW_STAGE_ORDER` that is not yet `complete`).
- [ ] T003 [US1] Update `frontend/src/components/WorkflowStageTracker.tsx` to import
  `STAGE_LABELS` from `workflowStageViewModel.ts` (remove the local copy) and render
  `getLockReason(...)` as visible text for any stage in `not-yet-reached` status (FR-004), without
  changing any existing `data-testid` or rendered text for stages in other statuses. (Depends on
  T002.)
- [ ] T004 [P] [US1] Create `frontend/src/components/AppHeader.tsx`: extract the `<header>...
  </header>` markup currently inline in `frontend/src/App.tsx` (logo, title, `VersionBadge`, and
  the three connection-status states) into this component with the same props, DOM, and
  `data-testid="connection-status"` contract — a pure extraction, no visual or behavioral change
  (FR-001).
- [ ] T005 [US1] Update `frontend/src/App.tsx` to render `<AppHeader health={health} />` in place
  of the inline header markup; leave the existing top-level tab navigation (`TABS`) and both page
  views untouched for now (Tabs extraction is US2's T013/T014) (FR-014 — no sidebar/router is
  introduced). (Depends on T004.)
- [ ] T006 [P] [US1] Extend `frontend/tests/unit/WorkflowStageTracker.test.tsx` with a case
  asserting the visible lock-reason text for a `not-yet-reached` stage (e.g. "Complete Analysis
  first"), keeping all existing assertions intact. (Depends on T003.)
- [ ] T007 [P] [US1] Create `frontend/tests/unit/AppHeader.test.tsx` covering the three
  connection-status states, mirroring the coverage `frontend/tests/unit/App.test.tsx` currently
  has for the inline header. (Depends on T004.)
- [ ] T008 [US1] Update `frontend/tests/unit/App.test.tsx` so its header-related assertions target
  the new `AppHeader` composition instead of inline markup; no assertion's expected behavior
  should change (FR-012). (Depends on T005.)

**Checkpoint**: The shell (header + stage tracker with explicit lock reasons) is fully functional
and testable on its own.

---

## Phase 4: User Story 2 - One visual language for recurring information (Priority: P2)

**Goal**: Shared `EmptyState`, `ErrorState`, `Skeleton`, `Dialog`, and `Tabs` primitives exist and
every current ad hoc loading/empty/error/tab occurrence in the app is migrated onto them.

**Independent Test**: Trigger a loading state, an empty result, and an error in at least two
different existing pages; confirm both render through the same shared component with identical
shape/label, independently of US1/US3.

- [ ] T009 [P] [US2] Create `frontend/src/components/EmptyState.tsx`: shared "no data" presentation
  (message, optional secondary text) per FR-006, matching this repo's single-file-per-concern
  convention (cf. `StatusBadge.tsx`).
- [ ] T010 [P] [US2] Create `frontend/src/components/ErrorState.tsx`: shared error presentation
  (`role="alert"`, message, optional detail) that formalizes the `role="alert"` +
  `text-danger-700`/`bg-danger-50` convention already used ad hoc across the files in T016–T029,
  per FR-006/FR-007.
- [ ] T011 [P] [US2] Create `frontend/src/components/Skeleton.tsx`: shared loading-placeholder
  primitive that respects `prefers-reduced-motion` (FR-015), per FR-006. Scope is content-panel
  loading only, not a button's own busy state (research.md D7) — see T035.
- [ ] T012 [P] [US2] Create `frontend/src/components/Dialog.tsx`: extract the generic modal shell
  (backdrop, focus trap, Escape-to-close, initial-focus handling, `role="alertdialog"`) currently
  hand-rolled inside `frontend/src/components/ConfirmDialog.tsx`, with no change to
  `ConfirmDialog`'s own public props or output.
- [ ] T013 [P] [US2] Create `frontend/src/components/Tabs.tsx`: a shared tabbed-panel primitive
  (FR-006, research.md D6) generalizing the `aria-current`/focus-ring tab-button pattern currently
  hand-rolled inline in `frontend/src/App.tsx`'s `TABS.map(...)` block, with no change to that
  pattern's accessibility semantics.
- [ ] T014 [US2] Update `frontend/src/App.tsx` to render its two top-level views ("Guided
  Workflow", "Import & Run Collection") through `Tabs.tsx` instead of the inline tab bar; keep the
  existing behavior of both views staying mounted (only visibility toggling) unchanged (FR-012).
  (Depends on T013.)
- [ ] T015 [US2] Refactor `frontend/src/components/ConfirmDialog.tsx` to compose `Dialog.tsx`
  instead of hand-rolling its own modal/focus-trap markup; keep its existing props and
  `data-testid`s unchanged, and update `frontend/tests/unit/ConfirmDialog.test.tsx` only if a
  `data-testid` moves. (Depends on T012.)
- [ ] T016 [P] [US2] Migrate the inline error message (~line 89) in
  `frontend/src/components/ApiReviewStage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/` coverage for this file still passes. (Depends on T010.)
- [ ] T017 [P] [US2] Migrate the two inline error messages (~lines 481, 521) in
  `frontend/src/components/AiEnhancementStage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/AiEnhancementStage.test.tsx`. (Depends on T010.)
- [ ] T018 [P] [US2] Migrate the inline error message (~line 25) in
  `frontend/src/components/AnalysisSummary.tsx` to `ErrorState`. (Depends on T010.)
- [ ] T019 [P] [US2] Migrate the inline error message (~line 184) in
  `frontend/src/components/EnvironmentForm.tsx` to `ErrorState`; verify
  `frontend/tests/unit/EnvironmentForm.test.tsx`. (Depends on T010.)
- [ ] T020 [P] [US2] Migrate the three inline error messages (~lines 427, 616, 752) in
  `frontend/src/pages/TestGenerationWorkflowPage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx`. (Depends on T010.)
- [ ] T021 [P] [US2] Migrate the inline error message (~line 587) in
  `frontend/src/components/ExecutionResultsPanel.tsx` to `ErrorState`; verify
  `frontend/tests/unit/ExecutionResultsPanel.test.tsx`. (Depends on T010.)
- [ ] T022 [P] [US2] Migrate the inline error message (~line 167) in
  `frontend/src/components/ExternalCollectionUpload.tsx` to `ErrorState`; verify
  `frontend/tests/unit/ExternalCollectionUpload.test.tsx` and confirm no behavior change to this
  in-progress feature (FR-013). (Depends on T010.)
- [ ] T023 [P] [US2] Migrate the inline error message (~line 380) in
  `frontend/src/components/ExternalCollectionRunPanel.tsx` to `ErrorState`; verify
  `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx` and confirm no behavior change (FR-013).
  (Depends on T010.)
- [ ] T024 [P] [US2] Migrate the inline error message (~line 212) in
  `frontend/src/components/PostmanExportPanel.tsx` to `ErrorState`; verify
  `frontend/tests/unit/PostmanExportPanel.test.tsx` and
  `frontend/tests/unit/PostmanExportPanelSecrets.test.tsx`. (Depends on T010.)
- [ ] T025 [P] [US2] Migrate the inline error message (~line 157) in
  `frontend/src/components/PostmanGenerationStage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/PostmanGenerationStage.test.tsx`. (Depends on T010.)
- [ ] T026 [P] [US2] Migrate the inline error message (~line 311) in
  `frontend/src/components/ScenarioReviewStage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/ScenarioReviewStage.test.tsx`. (Depends on T010.)
- [ ] T027 [P] [US2] Migrate the inline error message (~line 72) in
  `frontend/src/components/TestScenarioReviewDecision.tsx` to `ErrorState`; verify
  `frontend/tests/unit/TestScenarioReviewDecision.test.tsx`. (Depends on T010.)
- [ ] T028 [P] [US2] Migrate the two inline error messages (~lines 68, 102) in
  `frontend/src/components/TestScenarioReviewRefinement.tsx` to `ErrorState`; verify
  `frontend/tests/unit/TestScenarioReviewRefinement.test.tsx`. (Depends on T010.)
- [ ] T029 [P] [US2] Migrate the two inline error messages (~lines 211, 395) in
  `frontend/src/components/WorkflowReviewStage.tsx` to `ErrorState`; verify
  `frontend/tests/unit/WorkflowReviewStage.test.tsx`. (Depends on T010.)
- [ ] T030 [P] [US2] Migrate the "No uploaded collections yet" message (~line 46) in
  `frontend/src/components/ExternalCollectionList.tsx` to `EmptyState`; verify
  `frontend/tests/unit/ExternalCollectionList.test.tsx` and confirm no behavior change (FR-013).
  (Depends on T009.)
- [ ] T031 [P] [US2] Migrate the "No results match the current filter" message (~line 310) in
  `frontend/src/components/ExecutionResultsPanel.tsx` to `EmptyState`; verify
  `frontend/tests/unit/ExecutionResultsPanel.test.tsx`. (Depends on T009.)
- [ ] T032 [P] [US2] Migrate the "no accepted scenarios to export" message (~line 205) in
  `frontend/src/components/PostmanExportPanel.tsx` to `EmptyState`; verify
  `frontend/tests/unit/PostmanExportPanel.test.tsx`. (Depends on T009.)
- [ ] T033 [P] [US2] Migrate the empty message (~line 31) in
  `frontend/src/components/TestScenarioList.tsx` to `EmptyState`; verify
  `frontend/tests/unit/TestScenarioDetail.test.tsx`/related coverage. (Depends on T009.)
- [ ] T034 [P] [US2] Migrate the "No scenarios match the current filters" message (~line 238) in
  `frontend/src/components/TestScenarioReviewList.tsx` to `EmptyState`; verify
  `frontend/tests/unit/TestScenarioReviewList.test.tsx`. (Depends on T009.)
- [ ] T035 [US2] Replace the ad hoc pulsing-dot "Connecting…" indicator in
  `frontend/src/components/AppHeader.tsx` with the shared `Skeleton` primitive, keeping the
  `data-testid="connection-status"` contract from T004/T007 unchanged. Do **not** touch any
  button-busy-state text (e.g. "Uploading…"/"Exporting…"/"Generating…" in other files) — that is
  explicitly out of `Skeleton`'s scope per research.md D7. (Depends on T004, T011.)
- [ ] T036 [P] [US2] Add `frontend/tests/unit/EmptyState.test.tsx`. (Depends on T009.)
- [ ] T037 [P] [US2] Add `frontend/tests/unit/ErrorState.test.tsx`. (Depends on T010.)
- [ ] T038 [P] [US2] Add `frontend/tests/unit/Skeleton.test.tsx`, including a reduced-motion
  assertion. (Depends on T011.)
- [ ] T039 [P] [US2] Add `frontend/tests/unit/Dialog.test.tsx` covering focus trap, Escape-to-close,
  and initial focus. (Depends on T012.)
- [ ] T040 [P] [US2] Add `frontend/tests/unit/Tabs.test.tsx` covering keyboard navigation and
  `aria-current` selection state, mirroring the coverage `frontend/tests/unit/App.test.tsx`
  currently has for the inline tab bar. (Depends on T013.)

**Checkpoint**: Every existing loading/empty/error/tab occurrence in the app renders through one
of the five shared primitives; US1 and US2 together are independently demonstrable.

---

## Phase 5: User Story 3 - Usable in any environment the user works in (Priority: P3)

**Goal**: The shell and every shared component (new and existing) remain legible and operable in
dark mode, at narrow widths, via keyboard, and without relying on color alone.

**Independent Test**: Switch the OS/browser color scheme to dark and reload; resize to a narrow
width; tab through the shell and every shared component with the keyboard only. Confirm nothing
is unstyled, clipped, unreachable, or color-only — this story audits and completes what US1/US2
built, so it runs after them.

- [ ] T041 [US3] Add dark-mode color token overrides to `frontend/src/index.css`'s `@theme` block
  (research.md D2): redefine `--color-surface`, `--color-background`, `--color-muted`,
  `--color-border` under `@media (prefers-color-scheme: dark)`, adjusting brand/success/warning/
  danger/info shade choices only where contrast requires it (SC-004).
- [ ] T042 [P] [US3] Add `dark:` variants for any raw (non-token) color classes in
  `frontend/src/components/controlStyles.ts` (`BUTTON_STYLES`). (Depends on T041.)
- [ ] T043 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/StatusBadge.tsx`. (Depends on T041.)
- [ ] T044 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/HttpMethodBadge.tsx`. (Depends on T041.)
- [ ] T045 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/ProvenanceBadge.tsx`. (Depends on T041.)
- [ ] T046 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/WorkflowStageTracker.tsx`. (Depends on T041, T003.)
- [ ] T047 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/AppHeader.tsx`. (Depends on T041, T035.)
- [ ] T048 [P] [US3] Add `dark:` variants for any raw color classes in
  `frontend/src/components/EmptyState.tsx`, `ErrorState.tsx`, `Skeleton.tsx`, `Dialog.tsx`, and
  `Tabs.tsx`. (Depends on T041, T009-T013.)
- [ ] T049 [US3] Verify and, if needed, adjust responsive/truncation behavior (FR-009) of
  `AppHeader.tsx`, `WorkflowStageTracker.tsx`, and `Tabs.tsx` at narrow widths (edge case: a long
  API path or file name must truncate/wrap, not break layout or hide actions), and confirm
  `EmptyState.tsx`/`ErrorState.tsx`/`Skeleton.tsx`/`Dialog.tsx` have no narrow-width issues either.
  (Depends on T005, T003, T014.)
- [ ] T050 [US3] Audit focus-visible styling (FR-011) across every new/extended interactive
  element from US1/US2, applying the existing `focus-visible:ring-2 focus-visible:ring-brand-500`
  convention wherever missing.
- [ ] T051 [US3] Make `WorkflowStageTracker.tsx`'s `scrollIntoView({ behavior: "smooth" })` call
  and `Skeleton.tsx`'s pulse animation respect `prefers-reduced-motion` (FR-015) — the existing
  CSS-only media query in `index.css` neutralizes CSS transitions/animations but not this
  JS-triggered smooth scroll, so branch to `behavior: "auto"` when reduced motion is requested.
  (Depends on T003, T011.)
- [ ] T052 [US3] Audit text/background contrast (SC-004) for every `StatusBadge` tone,
  `HttpMethodBadge` per-method color, and `ProvenanceBadge` tone in both light and dark; adjust
  token shades only where a check fails. (Depends on T041-T045.)
- [ ] T053 [P] [US3] Extend `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx` and
  `frontend/tests/unit/TestScenarioReviewAccessibility.test.tsx` with keyboard-reachability/focus
  assertions for the new shell and shared components.
- [ ] T054 [US3] Extend `frontend/tests/unit/AppHeader.test.tsx` with a narrow-width/truncation
  assertion. (Depends on T007, T049.)

**Checkpoint**: All three user stories are independently functional; the shell and every shared
component work in light/dark, at narrow widths, and via keyboard.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T055 [P] Re-run `npm test -w frontend`, `npm run lint -w frontend`, and
  `npm run build -w frontend`; diff results against the T001 baseline and confirm zero regressions
  (SC-003).
- [ ] T056 Execute quickstart.md's four manual validation scenarios in a real browser, including
  the External Collections regression check.
- [ ] T057 Audit the full app for any remaining ad hoc header, navigation, tab, badge, loading,
  empty, or error markup not covered by T002–T054 (SC-002), checking any candidate against
  research.md D7's documented loading-state scope boundary before treating it as a gap; if a real
  gap is found, add a follow-up task rather than leaving it unaddressed silently.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Empty for this feature (see rationale above) — proceed directly from
  Setup to User Story 1.
- **User Story 1 (Phase 3)**: Depends only on Setup.
- **User Story 2 (Phase 4)**: Depends only on Setup; T035 additionally depends on US1's T004.
- **User Story 3 (Phase 5)**: Depends on Setup, and — unlike a typical fully-independent
  story — genuinely depends on US1 and US2 having landed, because this story's job is to audit and
  complete dark-mode/responsive/keyboard behavior for the components they create. This is the one
  deliberate exception to "stories are independent" in this feature, and matches the P1 → P2 → P3
  priority order already.
- **Polish (Phase 6)**: Depends on whichever stories were completed.

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (there is only one).
- Within US1: T002 and T004 are parallel; T006/T007 are parallel once their prerequisites land.
- Within US2: T009–T013 (the five new primitives) are parallel; once T010 lands, T016–T029 are all
  parallel (different files); once T009 lands, T030–T034 are all parallel (different files);
  T036–T040 are parallel.
- Within US3: T042–T048 (dark-mode passes on independent files) are parallel once T041 lands;
  T053 is parallel with the others.

---

## Parallel Example: User Story 2

```bash
# After T010 (ErrorState) lands, launch all its file migrations together:
Task: "Migrate ApiReviewStage.tsx error message to ErrorState"
Task: "Migrate AiEnhancementStage.tsx error messages to ErrorState"
Task: "Migrate AnalysisSummary.tsx error message to ErrorState"
# ...through T029
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Phase 2 is empty — proceed to Phase 3.
3. Complete Phase 3: User Story 1 (T002–T008).
4. **STOP and VALIDATE**: exercise the shell/tracker per US1's Independent Test.

### Incremental Delivery

1. Setup → Phase 3 (US1) → validate → demo (MVP: consistent, gated workflow navigation).
2. Add Phase 4 (US2) → validate → demo (every shared component now consistent).
3. Add Phase 5 (US3) → validate → demo (dark mode, responsive, keyboard-complete).
4. Phase 6: Polish, regression diff, quickstart validation.

Unlike the template's general guidance, US3 should not be attempted by a parallel team member
before US1/US2 land — it audits their output (see Dependencies above).
