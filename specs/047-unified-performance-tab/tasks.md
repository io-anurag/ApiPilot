---

description: "Task list for AP-047 Unified Performance Tab"
---

# Tasks: Unified Performance Tab

**Input**: Design documents from `/specs/047-unified-performance-tab/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/reselect-api.md, contracts/changes-to-existing-apis.md, quickstart.md

**Tests**: Included. Tests are part of the feature in this repository (CLAUDE.md §51); write each story's tests before its implementation and confirm they fail first. AI is not involved; nothing here needs a model, network access or a real k6 run (use the existing client mocks and the stand-in API fixtures).

**Organization**: Grouped by user story. Foundational work is the extraction of the plan editor's state and panes, the pure path logic, the stepper and the single-tab catalogue/routing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 to US6, mapping to spec.md; none for Setup, Foundational and Polish
- Paths are relative to the repository root

## Path Conventions

Web application: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/unit/`, `packages/shared-domain/src/`, `packages/shared-domain/tests/unit/`.

---

## Phase 1: Setup

- [ ] T001 Run the baseline `npm test`, `npm run lint` and `npm run build` from the repository root and record the pass counts and any pre-existing failure in `specs/047-unified-performance-tab/validation.md` (created now, completed in T058)
- [ ] T002 [P] Inventory every reference to `quick-performance`, `performance-plans`, `onOpenChainPlan`, `QuickPerformancePage`, `RequestChainPlansPage` and `--color-wf-quick` across `frontend/src`, `frontend/tests`, `packages/shared-domain/src` and `docs/`; append the list to `specs/047-unified-performance-tab/research.md` under R10 and confirm `--color-wf-quick` has no consumer besides `frontend/src/components/workflowCatalog.ts` and `frontend/src/index.css`

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: Make the plan editor's state and panes reusable by the path, add the pure path logic and stepper, and merge the two catalogue entries into one tab.

- [ ] T003 Extract the plan session state from `frontend/src/components/requestChain/ChainPlanEditor.tsx` into `frontend/src/components/requestChain/useChainPlanSession.ts` (load, whole-plan save with queue and revision-conflict handling, local plan analysis, environments, runs client, script generation, debug run, restore, announcements); `ChainPlanEditor.tsx` consumes the hook with no behaviour change; the existing `frontend/tests/unit/ChainPlanEditor.test.tsx` must pass unchanged
- [ ] T004 Extract the three tab bodies of `ChainPlanEditor.tsx` into `frontend/src/components/requestChain/ChainsPane.tsx`, `SetupPane.tsx` (without the launch card) and `RunPane.tsx` (launch card, results, runs and reports), each taking the session from T003; `ChainPlanEditor.tsx` composes them; existing `ChainPlanEditor.test.tsx`, `ChainRunPanel.test.tsx` and `ChainDebugPanel.test.tsx` pass unchanged (depends on T003)
- [ ] T005 [P] Create the pure path logic in `frontend/src/components/performance/path/pathState.ts`: `PathStep`, step order, `entryStep(source, specLoaded)`, per-step Next gating with reason text, which steps are selectable (`reached`, skipped Operations for an empty plan), and transitions from `data-model.md`; unit tests in `frontend/tests/unit/performancePathState.test.ts` covering every gating row and every entry-step case
- [ ] T006 [P] Create `frontend/src/components/performance/path/PerformanceStepper.tsx` following `frontend/src/components/ImportRunStepper.tsx` (theme tokens, no `dark:` overrides, `aria-current="step"`, lock reasons and skipped state as text, reached steps selectable); test in `frontend/tests/unit/PerformanceStepper.test.tsx`
- [ ] T007 Create `frontend/src/hooks/usePerformancePath.ts`: in-memory reducer over `pathState.ts` holding `view`, `draft`, `planId`, `step`, `reached`, `parked`, `panel`; test in `frontend/tests/unit/usePerformancePath.test.ts` (depends on T005)
- [ ] T008 Merge the catalogue entries: one `performance` entry (tab label "Performance", plans tone) in `frontend/src/components/workflowCatalog.ts`; update `frontend/src/components/sectionCatalog.ts`, `frontend/src/components/EntryIllustration.tsx`, `frontend/src/components/performance/CountedOperationList.tsx` if it names the old ids, and remove the unused `--color-wf-quick` tokens in `frontend/src/index.css` (light and dark); update `frontend/tests/unit/workflowCatalog.test.ts`, `frontend/tests/unit/EntryChooser.test.tsx` and `frontend/tests/unit/CountedOperationList.test.tsx` (depends on T002)
- [ ] T009 Create the shell `frontend/src/pages/PerformancePage.tsx` (props `onExit`, `openRequest` with nonce; renders a loading state and the home container) and wire it in `frontend/src/App.tsx`: one `performance` view, one merged mount flag so it stays mounted after first use, palette command, `onOpenPerformancePlan(planId)` replacing `onOpenChainPlan`; update `frontend/tests/unit/App.test.tsx` (depends on T008)

**Checkpoint**: One Performance tab opens an empty shell; the editor behaves exactly as before; all existing tests pass.

---

## Phase 3: User Story 1 - Specification to a running load test (Priority: P1) MVP part 1

**Goal**: From the Performance tab, upload a specification, choose operations, edit the plan, set the load profile and start a run, with no tab change.

**Independent Test**: With no plans and no uploaded specification, complete Source, Operations, Plan, Load and Run in one tab and see a result (quickstart scenario 1, 2).

### Tests for User Story 1 (write first, confirm failing)

- [ ] T010 [P] [US1] `frontend/tests/unit/SourcePicker.test.tsx`: four source cards, accessible names, pressed state, empty-state copy
- [ ] T011 [P] [US1] `frontend/tests/unit/SourceStep.test.tsx`: Next locked until the upload is analysed; reuse of an already uploaded specification shows file name and operation count; upload error shown with the previous specification kept
- [ ] T012 [P] [US1] Extend `frontend/tests/unit/OperationSelection.test.tsx` (create if absent): text filter, method filter, select all and clear all act on the filtered or full set as labelled, chosen-of-total count
- [ ] T013 [US1] `frontend/tests/unit/PerformancePath.test.tsx`: end to end with mocked clients: first plan from a specification reaches Run and shows a result with a text verdict; opens on Source with no upload and on Operations with one; Back keeps state; write steps and environment shown next to Start with no extra gate (FR-028)

### Implementation for User Story 1

- [ ] T014 [P] [US1] Create `frontend/src/components/performance/path/SourcePicker.tsx` (OpenAPI specification, Guided workflow, Postman collection, Empty plan)
- [ ] T015 [P] [US1] Create `frontend/src/components/performance/path/SourceStep.tsx`: upload and reuse via `frontend/src/services/quickPerformanceClient.ts`, same validation and limit as today (FR-025), errors via `ErrorState`
- [ ] T016 [P] [US1] Add text and method filters to `frontend/src/components/requestChain/OperationSelection.tsx` without changing its props contract for existing callers
- [ ] T017 [US1] Create `frontend/src/components/performance/path/OperationsStep.tsx` for the specification source: `OperationSelection`, counts, optional environment for moved credentials (the field from `SeedPlanDialog.tsx`), and on Next create the plan with `seedPlan` (`selectedOperationKeys`, default name from the specification title) then move to Plan (depends on T016, T007)
- [ ] T018 [US1] Create `frontend/src/components/performance/path/PlanStep.tsx` hosting `ChainsPane` (rename, steps, data sets, plan check, seeding report) with Next gated on a non-blank name and at least one step (depends on T004)
- [ ] T019 [US1] Create `frontend/src/components/performance/path/LoadStep.tsx` hosting `SetupPane` (environment, load profile, thresholds, think time) with the existing validation (FR-026) (depends on T004)
- [ ] T020 [US1] Create `frontend/src/components/performance/path/RunStep.tsx` hosting `RunPane`: launch card with named environment and listed writes beside Start, progress and stop, result, Run again, Edit load profile (back to Load), Open full report, Back to plans (depends on T004)
- [ ] T021 [US1] Create `frontend/src/components/performance/path/PerformancePath.tsx`: header (plan name or "New performance test", Draft or Saved, seeded-from label), `PerformanceStepper`, step body, Back and Next with the reason text; mount it from `PerformancePage.tsx` with the source picker home for the no-plans state (depends on T006, T007, T014 to T020)
- [ ] T022 [US1] Reword the message in `backend/src/performance/chain/seed/seedService.ts` to "Upload a specification in Performance first." and update the assertions in `backend/tests/integration/performance/chainPlanSeedSources.test.ts` and any test that matches the old text
- [ ] T023 [US1] Remove `frontend/src/pages/QuickPerformancePage.tsx` and `frontend/tests/unit/QuickPerformancePage.test.tsx` once T013 to T015 cover their assertions (the replace-confirm assertions move to the US6 tasks T052 and T053; note any assertion deferred there)

**Checkpoint**: A specification becomes a running load test in one tab. US1 is demonstrable; it is not shippable alone (see Implementation Strategy).

---

## Phase 4: User Story 2 - Open a saved plan and continue (Priority: P1) MVP part 2

**Goal**: The entry screen lists saved plans and recent runs; opening a plan lands on Plan with every step reachable and the source read-only.

**Independent Test**: With saved plans, open one and reach Run in two interactions (quickstart scenario 3, 11).

### Tests for User Story 2

- [ ] T024 [P] [US2] `frontend/tests/unit/PerformanceHome.test.tsx`: plans table with Open, Duplicate, Delete (confirm text keeps runs and reports), loading, error with retry, empty state, recent runs, earlier-runs view present when legacy runs exist
- [ ] T025 [P] [US2] Extend `frontend/tests/unit/PerformancePath.test.tsx`: opening a plan lands on Plan with all steps selectable, Source read-only with the plan's source, edits saved and reflected in the list

### Implementation for User Story 2

- [ ] T026 [US2] Create `frontend/src/components/performance/PerformanceHome.tsx`: source picker plus plans table and dialogs ported from `frontend/src/pages/RequestChainPlansPage.tsx` (`listPlans`, `duplicatePlan`, `deletePlan`, `PromptDialog`, `ConfirmDialog`), with distinct loading, empty, error and success states (FR-002 to FR-005, FR-031)
- [ ] T027 [P] [US2] Create `frontend/src/components/performance/RecentRuns.tsx`: recent runs across plans by fetching the runs of the 10 most recently updated plans (no new endpoint), merged by start time, plus `frontend/src/components/requestChain/LegacyRunsView.tsx`; document the 10-plan limit in the component comment and in `research.md`
- [ ] T028 [US2] Open-plan flow in `usePerformancePath.ts` and `PerformancePath.tsx`: land on Plan with all steps reached; `SourceStep.tsx` shows the plan's source read-only (FR-013, FR-014); honour `openRequest` from `PerformancePage.tsx`
- [ ] T029 [US2] Remove `frontend/src/pages/RequestChainPlansPage.tsx`, `frontend/tests/unit/RequestChainPlansPage.test.tsx`, and, after migrating their assertions onto the pane and path tests, `ChainPlanEditor.tsx`, `ChainPlanEditor.test.tsx` and `PlansIntro.tsx` if nothing else imports them

**Checkpoint**: US1 and US2 together replace both old tabs. This is the first shippable increment.

---

## Phase 5: User Story 3 - Change selection without losing edits (Priority: P2)

**Goal**: Change operations on a specification plan merges the selection and keeps edits; edited removals are confirmed; Reset to seed is explicit.

**Independent Test**: Edit a step, add and remove operations through the panel, confirm the edit survives, then trigger the edited-removal warning and Reset to seed (quickstart scenarios 4 to 6).

### Tests for User Story 3 (write first)

- [ ] T030 [P] [US3] `packages/shared-domain/tests/unit/requestChain.test.ts`: `isChainEdited`, `seededOperationKeys`, `isPlanEdited` against the definitions in `research.md` R3
- [ ] T031 [P] [US3] `backend/tests/unit/performance/chain/seed/reselectService.test.ts`: every row of the merge and reset table in `data-model.md` (kept chain byte-identical, new chains appended in specification order, unedited removal, edited removal refused, engineer-created chain kept on merge and removed on reset, credentials chain added/kept/removed, data sets, load profile, thresholds untouched, determinism)
- [ ] T032 [P] [US3] `backend/tests/integration/performance/chainPlanReselect.test.ts` (Supertest): every status and body in `contracts/reselect-api.md`, including `edited_steps_would_be_removed` with and without `confirmRemoveEdited`, `plan_revision_conflict`, `plan_source_not_supported`, `quick_test_not_found`, `invalid_request`
- [ ] T033 [P] [US3] `frontend/tests/unit/ChangeOperationsPanel.test.tsx` and extend `PerformancePath.test.tsx`: panel opens on specification plans only, cancel changes nothing, apply merges, edited-removal dialog names the chains and Cancel leaves the plan and selection unchanged, Reset to seed confirmation states what is kept and lost, "Edited by you" clears after reset, Escape closes dialogs and the panel

### Implementation for User Story 3

- [ ] T034 [US3] Add `ReselectMode`, `ReselectRequest`, `ReselectEditedRemoval`, `ReselectOutcome` and the pure helpers to `packages/shared-domain/src/requestChain.ts` and export them from the package index (depends on T030)
- [ ] T035 [US3] Implement `backend/src/performance/chain/seed/reselectService.ts` using the per-operation pieces of `seedFromSpecification.ts` (`operationStep`, `credentialStep`, `planAuth`); deterministic, no clock, ids from the existing counters; literal credentials found are dropped and listed in the seeding report, never moved (depends on T034, T031)
- [ ] T036 [US3] Add `POST /:planId/reselect` to `backend/src/api/chainPlans.ts`: validate input, call the service, map errors to the contract, save with the revision check, log `chain_plan_reselected` with counts only; no logic in the route (depends on T035, T032)
- [ ] T037 [P] [US3] Add `reselectPlan(planId, request)` to `frontend/src/services/requestChainClient.ts` with typed results including the edited-removal refusal; cover in `frontend/tests/unit/requestChainClient.test.ts` (depends on T034)
- [ ] T038 [P] [US3] Create `frontend/src/components/performance/path/ChangeOperationsPanel.tsx` (side panel on `Dialog`, `OperationSelection`, Cancel and Apply, full width at phone size) (depends on T016)
- [ ] T039 [US3] In `PlanStep.tsx` add "Change operations…" (specification plans only; other plans show the source read-only, FR-015), "Reset to seed…" when the plan is edited, the "Edited by you" indication from `isPlanEdited`, and the explicit statement that every request is editable (FR-018) (depends on T037, T038)
- [ ] T040 [US3] In `OperationsStep.tsx` handle an existing plan: Next calls `reselectPlan` in merge mode; on `edited_steps_would_be_removed` show a confirmation naming the chains and retry with `confirmRemoveEdited: true` only on confirm; on `plan_revision_conflict` reload the plan and tell the engineer; moving past Operations never discards anything silently (FR-010, FR-016) (depends on T037)
- [ ] T041 [US3] Update `specs/037-request-chain-performance/spec.md` (FR-026 note) and `specs/037-request-chain-performance/contracts/chain-plan-api.md` (link to `contracts/reselect-api.md`) so the narrowed "never re-derived" rule is recorded where it was stated

**Checkpoint**: US1 to US3 work independently; edits are never lost except by an explicit, confirmed action.

---

## Phase 6: User Story 4 - Other sources (Priority: P2)

**Goal**: Empty plan, collection and guided workflow start the same path; other views hand a plan over to the Plan step.

**Independent Test**: Start from an empty plan, a collection and the guided workflow and reach Run from each; accept "Create request-chain plan" in Import & Run and land on Plan (quickstart scenario 9).

### Tests for User Story 4

- [ ] T042 [P] [US4] `frontend/tests/unit/PerformancePath.test.tsx` additions: empty plan opens on Plan with Operations skipped and Next locked until a step exists; workflow source shows the read-only summary and the not-ready message; collection source shows the picker and request selection
- [ ] T043 [P] [US4] Update `frontend/tests/unit/ChainSeedEntryPoints.test.tsx` for `onOpenPerformancePlan` opening Performance on the Plan step

### Implementation for User Story 4

- [ ] T044 [US4] Empty plan: `createPlan(name)` from the picker, open on Plan, Operations skipped (FR-007, FR-008) in `frontend/src/components/performance/PerformanceHome.tsx` and `usePerformancePath.ts`
- [ ] T045 [US4] Workflow source in `frontend/src/components/performance/path/OperationsStep.tsx`: read-only summary of the approved workflows to be seeded (one chain each), the precondition message from `409 workflow_not_ready`, then `seedPlan({ kind: "workflow" })`
- [ ] T046 [US4] Collection source: read `frontend/src/components/ExternalCollectionRunPanel.tsx` around the request selection and run order (about lines 700 to 960), extract the selection and order part into a shared component under `frontend/src/components/performance/path/` without changing Import & Run's behaviour (its tests pass unchanged), add a collection picker from the uploaded collections list, then `seedPlan({ kind: "collection", collectionId, orderedRequestIds })`
- [ ] T047 [US4] Rename `onOpenChainPlan` to `onOpenPerformancePlan` and open Performance on the Plan step in `frontend/src/App.tsx`, `frontend/src/components/ExternalCollectionRunPanel.tsx`, `frontend/src/components/performance/PerformanceTestingStage.tsx`, `frontend/src/components/requestChain/SeededPlans.tsx`, `frontend/src/pages/ExternalCollectionsPage.tsx`, `frontend/src/pages/TestGenerationWorkflowPage.tsx`

**Checkpoint**: Every source reaches Run through the same path.

---

## Phase 7: User Story 5 - Leave and pick up later (Priority: P2)

**Goal**: An unfinished test is parked, offered again and never lost by navigation.

**Independent Test**: Start a test, leave from Operations, see the banner and the Start-screen badge, resume with the selection intact (quickstart scenario 7).

### Tests for User Story 5

- [ ] T048 [P] [US5] `frontend/tests/unit/DraftBanner.test.tsx` and additions to `PerformancePath.test.tsx`: leaving without a plan parks a draft, Resume restores step and selection, Discard clears it, leaving with a plan creates no draft (FR-019, FR-022), picking a source over a draft asks first and Cancel keeps it (FR-020)
- [ ] T049 [P] [US5] Additions to `frontend/tests/unit/App.test.tsx` and `EntryChooser.test.tsx`: Start-screen Performance card shows a draft badge in text; Back to start and a tab switch keep the whole state including run progress (FR-021)

### Implementation for User Story 5

- [ ] T050 [US5] Park, resume and discard in `usePerformancePath.ts`; create `frontend/src/components/performance/path/DraftBanner.tsx`; confirm-before-replace using `ConfirmDialog` in `PerformanceHome.tsx`
- [ ] T051 [US5] Expose the draft state from `PerformancePage.tsx` to `frontend/src/App.tsx` and show the badge on the Performance card in `frontend/src/components/EntryChooser.tsx`; keep the page mounted across Back to start and tab switches

**Checkpoint**: Navigation never loses work.

---

## Phase 8: User Story 6 - Replace the specification safely (Priority: P3)

**Goal**: Replacing the uploaded specification asks first and keeps plans, runs and reports.

**Independent Test**: Replace the specification while plans and runs exist; they remain (quickstart scenario 8).

- [ ] T052 [P] [US6] Tests in `frontend/tests/unit/SourceStep.test.tsx`: replace asks first with the message from FR-024, confirm resets the selection to the new specification's operations, cancel keeps the current specification, plans and runs unchanged
- [ ] T053 [US6] Implement the replace flow in `SourceStep.tsx` with `ConfirmDialog` and `uploadQuickTest(file, true)`; reset the selection and the draft's operations on confirm; restore any assertion deferred from T023

**Checkpoint**: All six stories are independently functional.

---

## Phase 9: Polish and cross-cutting

- [ ] T054 [P] Accessibility pass over the new components: keyboard operation of the stepper, dialogs and panel, focus placement and return, Escape, `aria-current`, status never by colour alone; assert with role queries in the existing test files (FR-031, SC-008)
- [ ] T055 [P] Responsive and dark-mode review of `PerformanceHome`, the path and the panel at phone width in light and dark using theme tokens only (no inline styles, no `dark:` overrides on stepper); note in `validation.md` that this is a manual browser check and whether it was done
- [ ] T056 Documentation and version: update `docs/USER_MANUAL.md` (one Performance tab, the path, Change operations, Reset to seed, drafts), `docs/architecture.md` (path, hook extraction, reselect), add the AP-047 entry to `specs/ROADMAP.md`, and bump the version in the root, `backend`, `frontend` and `packages/shared-domain` `package.json` files with npm updating `package-lock.json` (project rule: finish features with docs and a version bump); do not commit
- [ ] T057 Remove dead code left by the merge (`SeedPlanDialog.tsx` and `SeedFromSource` if unused, unused imports, unused test fixtures in `frontend/tests/unit/performanceFixtures.ts`) and confirm no `eslint-disable` was added
- [ ] T058 Run `npm test`, `npm run lint`, `npm run build`, then walk `quickstart.md` scenarios 1 to 11; record results, what was not exercised (SC-009 usability check, screen reader, real k6 run) and the review of the final diff against spec.md and plan.md in `specs/047-unified-performance-tab/validation.md`

---

## Dependencies and Execution Order

- **Phase 1** has no dependency. **Phase 2** follows it and blocks every story.
- Inside Phase 2: T003 then T004; T005 and T006 in parallel; T007 after T005; T008 after T002; T009 after T008. T004 and T005 to T007 are independent of the catalogue work (T008, T009).
- **US1** (Phase 3) needs all of Phase 2. **US2** needs US1 (the path and panes). **US3** needs US2 (a plan can be opened) and has its own backend chain: T034 → T035 → T036, with T030 to T033 written first. **US4** needs US1; its T047 also needs T009. **US5** needs US1 and the home from US2 (T026). **US6** needs US1 (T015).
- Nothing ships before US1 and US2 are both done, because removing the two old tabs requires the saved-plan list and open flow.

### Parallel opportunities

- Phase 2: T005 ∥ T006; T008 ∥ T003/T004 until T009.
- US1: T010 ∥ T011 ∥ T012; T014 ∥ T015 ∥ T016.
- US3: T030 ∥ T031 ∥ T032 ∥ T033 (tests), later T037 ∥ T038. Backend (T034 to T036) and frontend (T037 to T040) proceed in parallel once T034 is merged.
- US4: T042 ∥ T043; T044 ∥ T045. US5 and US6 can run in parallel with US4 once the home exists.

### Parallel example: User Story 1

```text
Together: T010 SourcePicker test, T011 SourceStep test, T012 OperationSelection test
Together: T014 SourcePicker.tsx, T015 SourceStep.tsx, T016 OperationSelection filters
Then:     T017 OperationsStep -> T018 PlanStep, T019 LoadStep, T020 RunStep (parallel) -> T021 PerformancePath
```

## Implementation Strategy

1. **MVP = US1 + US2** (Phases 1 to 4): one Performance tab that creates, opens, edits and runs plans from a specification or an empty plan. No backend change except the reworded message (T022). Stop and validate quickstart scenarios 1 to 3 and 11 before continuing.
2. **Increment 2 = US3**: the reselect endpoint and the merge experience. This is the only change that alters backend behaviour; validate quickstart scenarios 4 to 6 and run the contract tests.
3. **Increment 3 = US4**: collection and workflow sources and the hand-over wiring (the largest risk is T046, extracting the selection from a large panel).
4. **Increment 4 = US5, then US6**: drafts and replacement.
5. Polish (Phase 9) once per increment that ships, and in full at the end.

## Notes and open points

- **Recent runs (T027)** have no cross-plan endpoint today; the fan-out over 10 plans is a deliberate simplification. If it proves slow or inaccurate, add a read endpoint in a follow-up spec.
- **T003 and T004** are the highest-risk refactor; keep `ChainPlanEditor.test.tsx` green after each, and only then build on them.
- Do not run `git commit`; leave all changes uncommitted for review (project rule).
