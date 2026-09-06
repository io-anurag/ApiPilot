---

description: "Task list for AI Enhancement Progress Visibility"
---

# Tasks: AI Enhancement Progress Visibility

**Input**: Design documents from `/specs/012-ai-enhancement-progress/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ai-enhancement-progress.md, quickstart.md (all present)

**Tests**: Included — this project's constitution (XXI: Testability at Every Boundary) and `.claude/CLAUDE.md` §51-53 treat tests as part of the feature, not optional.

**Organization**: Tasks are grouped by user story (spec.md) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

## Path Conventions

Existing web-application monorepo layout (`backend/`, `frontend/`, `packages/shared-domain/`) — see plan.md's Project Structure for the full file list this feature touches. `analyzeDependencies.ts` is explicitly untouched (FR-011) and has no task below.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before making any change.

- [X] T001 Run `npm test` (repo root — not per-workspace, which bypasses `vitest.workspace.ts`'s jsdom environment for frontend) and confirm the existing suite (including specs/011-ai-prompt-batching's coverage) is fully green before starting — no code changes in this task. Confirmed: 113 files / 604 tests passed, 1 file / 2 tests skipped.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and plumbing every user story below builds on.

**⚠️ CRITICAL**: No user story task can begin until this phase is complete.

- [X] T002 [P] Add `BatchProgress` and `AiEnhancementProgress` types, and extend `WorkflowStageState` with an optional `progress` field, in `packages/shared-domain/src/testGenerationWorkflow.ts` (data-model.md "BatchProgress"/"AiEnhancementProgress"/"WorkflowStageState (extended)")
- [X] T003 [P] Add optional `onBatchStart?: (index: number, total: number) => void` and `onBatchSettled?: (index: number, total: number, outcome: BatchOutcome) => void` callbacks to `runBatchedInference`'s options in `backend/src/ai/requestBatching.ts`, defaulting to no-ops; `BatchedInferenceSummary`'s return shape is unchanged (research.md Decision 3)
- [X] T004 [P] Extend `backend/tests/unit/ai/requestBatching.test.ts`: `onBatchStart`/`onBatchSettled` fire once per batch, in order, with the correct `index`/`total`/`outcome`; a call that omits both callbacks (matching `analyzeDependencies.ts`'s existing call site) behaves identically to today
- [X] T005 Add `AiEnhancementAlreadyRunningError` to `backend/src/testGenerationWorkflow/errors.ts`, following the existing error-class pattern in that file (e.g. `StageNotActiveError`)
- [X] T006 Add a `setAiEnhancementProgress(progress: AiEnhancementProgress | undefined): void` helper to `backend/src/testGenerationWorkflow/workflowStore.ts` that patches `stages.aiEnhancement.progress` directly (not through `updateStage()`'s transition validator, since it never changes `status` — data-model.md "State transitions")

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Live progress during a multi-batch enhancement run (Priority: P1) 🎯 MVP

**Goal**: While an AI enhancement run needing multiple batches is in progress, the user can see which batch is currently being processed, each finished batch's result, and newly-succeeded batches' scenarios as soon as they're available — instead of a single unchanging "Enhancing…" wait.

**Independent Test**: Run AI enhancement against a specification known to split into multiple batches (e.g. `buildLargeAiScenarioApiModel`); poll `GET /api/test-generation-workflow` while it runs and confirm `stages.aiEnhancement.progress` shows batch-level status and `reviewWorkspace.scenarios` grows before the run finishes.

### Tests for User Story 1

- [X] T007 [P] [US1] Extend `backend/tests/unit/testDesign/enhanceTestModel.test.ts`: the new `onBatchComplete` callback reports exactly the newly-retained scenarios per batch (not the whole accumulated set), and a scenario already retained from an earlier batch is never re-reported or removed by a later batch's incremental dedup pass (research.md Decision 4; FR-012 proof-in-practice)
- [X] T008 [P] [US1] Extend `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: `stages.aiEnhancement.progress` is populated and updated as batches start/settle during a multi-batch run; `reviewWorkspace.scenarios` contains an earlier-succeeded batch's scenarios before the run as a whole finishes; a review decision made on an early-revealed scenario is preserved after a later batch subsequently succeeds or fails (FR-012)
- [X] T009 [P] [US1] Extend `backend/tests/integration/testGenerationWorkflow.test.ts`: `GET /api/test-generation-workflow` returns `stages.aiEnhancement.progress` with the shape documented in `contracts/ai-enhancement-progress.md` while a run is active
- [X] T010 [P] [US1] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: once a run starts, the component polls workflow status on an interval (use fake timers, not real ones — constitution XXIV) and renders per-batch progress from a scripted sequence of workflow snapshots

### Implementation for User Story 1

- [X] T011 [US1] Add an optional `onBatchComplete?: (index: number, total: number, outcome: BatchOutcome, newlyRetainedScenarios: TestScenario[]) => void` parameter to `enhanceTestModel()` in `backend/src/testDesign/enhanceTestModel.ts`: after each batch settles, recompute `deduplicate()` over the deterministic baseline plus every AI scenario from batches completed so far (research.md Decision 4), and invoke the callback with only the scenarios newly retained by this batch. `enhanceTestModel`'s own return value (`EnhancementResult`) is unchanged (depends on T002, T003)
- [X] T012 [US1] In `runAiEnhancement()` (`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`): before calling `enhanceTestModel`, initialize an `AiEnhancementProgress` (via `setAiEnhancementProgress()` from T006) with one `pending` `BatchProgress` per planned batch; pass an `onBatchComplete` callback to `enhanceTestModel` that updates that batch's status in progress and appends `newlyRetainedScenarios` to `reviewWorkspace.scenarios` (reusing the existing `newlyAddedReviewScenarios()` helper), recomputing `reviewWorkspace.summary` on each call (depends on T005, T006, T011)
- [X] T013 [US1] In `frontend/src/components/AiEnhancementStage.tsx`: while `running`, poll the existing `fetchCurrentWorkflow()` (`frontend/src/services/testGenerationWorkflowClient.ts` — already returns the full workflow, no client change needed) every 2 seconds and render `stages.aiEnhancement.progress` (total batches, current batch, per-batch status), stopping the poll when the component unmounts or a terminal state is reached (depends on T009)

**Checkpoint**: Live, batch-level progress and incremental scenario reveal work end-to-end for a multi-batch run.

---

## Phase 4: User Story 2 - An unambiguous final outcome (Priority: P1)

**Goal**: Once a run finishes, the user sees exactly one clear status — fully completed, partially completed, or not completed — distinct from the in-progress view, and cannot accidentally start a second overlapping run.

**Independent Test**: Run AI enhancement to completion under full success, partial success, and full failure; confirm each renders a distinct, unambiguous final status, and confirm a `POST .../ai-enhancement` sent while a run is already in progress is rejected rather than starting a second run.

### Tests for User Story 2

- [X] T014 [P] [US2] Extend `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: a second `runAiEnhancement()` call while `stages.aiEnhancement.progress` is present throws `AiEnhancementAlreadyRunningError`; `progress` is absent immediately once the stage reaches a terminal status (`complete`/`partial`/`skipped`), alongside the correct `status`/`aiErrorCategory`/`aiErrorMessage`
- [X] T015 [P] [US2] Extend `backend/tests/integration/testGenerationWorkflow.test.ts`: a `POST /api/test-generation-workflow/ai-enhancement` sent while a run is already in progress for the current workflow returns `409 ai_enhancement_already_running` per `contracts/ai-enhancement-progress.md`, and the original run's progress is unaffected by the rejected call
- [X] T016 [P] [US2] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: full success, partial success, and full failure each render a status distinctly different from the in-progress view and from each other (spec.md US2 acceptance scenarios 1-3)

### Implementation for User Story 2

- [X] T017 [US2] In `runAiEnhancement()` (`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`): throw `AiEnhancementAlreadyRunningError` (T005) when `stages.aiEnhancement.progress` is already present for the current workflow, before calling `enhanceTestModel`; call `setAiEnhancementProgress(undefined)` (T006) as part of every existing final `updateStage()` call (`complete`/`partial`/`skipped`) (depends on T005, T006, T012)
- [X] T018 [US2] In `backend/src/api/testGenerationWorkflow.ts`'s `ai-enhancement` route: catch `AiEnhancementAlreadyRunningError` alongside the existing `StageNotActiveError` catch and respond `409 ai_enhancement_already_running` per `contracts/ai-enhancement-progress.md` (depends on T017)
- [X] T019 [US2] In `frontend/src/components/AiEnhancementStage.tsx`: stop polling once `stages.aiEnhancement.progress` is absent and `status` is a terminal value; render the existing success/partial/skipped banner exactly as today, now reached only after the in-progress view from US1 (depends on T013, T017)

**Checkpoint**: Every run — success, partial, or full failure — ends in exactly one unambiguous, correctly-reached final state, and concurrent runs are prevented.

---

## Phase 5: User Story 3 - Small specifications feel exactly as fast as before (Priority: P2)

**Goal**: A specification whose enhancement completes in a single batch is completely unaffected by this feature.

**Independent Test**: Run AI enhancement against a specification known to complete in one batch today; confirm total time and information shown are unchanged, with no spurious "batch 1 of 1" progress step.

### Tests for User Story 3

- [X] T020 [P] [US3] Extend `backend/tests/unit/testDesign/enhanceTestModel.test.ts`: a single-batch run's `onBatchComplete` fires exactly once with `total: 1`, and `enhanceTestModel`'s output is byte-for-byte identical to a pre-feature run of the same fixture (regression, FR-005)
- [X] T021 [P] [US3] Extend `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: a single-batch run's `stages.aiEnhancement.progress`, if observed at all before the run completes, never implies a multi-step process (`totalBatches: 1`)
- [X] T022 [P] [US3] Extend `frontend/tests/unit/AiEnhancementStage.test.tsx`: a single-batch run renders the same "Enhancing…" experience as before this feature — no "batch 1 of 1" progress step shown (FR-005)

**Checkpoint**: All three user stories are independently verified; single-batch specifications show zero observable change.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 Run `npm test -w backend` and `npm test -w frontend` (full suite) and confirm everything passes, including specs/011-ai-prompt-batching's existing coverage
- [X] T024 Run `npm run lint` and `npm run build` and confirm both are clean
- [ ] T025 [P] Execute `quickstart.md`'s "Optional: real-model validation" step against a real, local multi-batch specification and confirm the described UI behavior
- [X] T026 Update `specs/ROADMAP.md`'s Implementation Status entry for `012-ai-enhancement-progress` from "Spec + plan complete; tasks not yet generated" to "Implemented" (only after T023-T024 pass)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. Independently testable and demoable on its own (MVP).
- **User Story 2 (Phase 4)**: Depends on Foundational; T017/T019 also depend on US1's T012/T013 (the same `runAiEnhancement()`/`AiEnhancementStage.tsx` changes are extended, not duplicated) — so in practice, complete US1 before US2.
- **User Story 3 (Phase 5)**: Depends on Foundational and US1's implementation (T011-T013) existing to regression-test against — purely test tasks, no new production code.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written first and should fail before the corresponding implementation task.
- Shared-domain/backend changes before frontend changes that consume them.
- Story complete before moving to the next priority.

### Parallel Opportunities

- T002, T003 (different files) can run in parallel; T004 depends on T003.
- Within Phase 3, T007-T010 (all test files) can run in parallel with each other, but each depends on its corresponding Foundational task, not on T011-T013.
- Within Phase 4, T014-T016 can run in parallel with each other.
- All of Phase 5 (T020-T022) can run in parallel with each other.
- T025 and T026 in Phase 6 can run in parallel with each other, but both depend on T023/T024.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch independent foundational tasks together:
Task: "Add BatchProgress/AiEnhancementProgress types in packages/shared-domain/src/testGenerationWorkflow.ts"
Task: "Add onBatchStart/onBatchSettled callbacks to runBatchedInference in backend/src/ai/requestBatching.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: confirm live progress and incremental reveal work end-to-end against a scripted multi-batch run.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → live progress + incremental reveal (MVP).
3. User Story 2 → unambiguous final outcome + concurrency guard.
4. User Story 3 → regression coverage confirming zero change for the existing single-batch case.
5. Polish → full suite, lint, build, quickstart validation, roadmap update.

## Notes

- [P] tasks touch different files with no unmet dependencies.
- Every task above names its exact file path — no task should require guessing where a change belongs.
- `analyzeDependencies.ts` and its tests are intentionally untouched (FR-011) — no task references them.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently before moving on.
