---

description: "Task list for AI Enhancement Batch Retry"
---

# Tasks: AI Enhancement Batch Retry

**Input**: Design documents from `/specs/015-ai-batch-retry/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ai-enhancement-retry-batch.md](./contracts/ai-enhancement-retry-batch.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The project constitution (XXI. Testability at Every Boundary) and CLAUDE.md
§51-52 make automated tests a required part of every feature, not optional for this codebase.

**Organization**: Tasks are grouped by user story. Execution order follows the actual dependency
chain rather than spec.md's listed priority order: User Story 2 ("see which batches failed and
why") is a hard technical prerequisite for User Story 1 ("retry one batch") — spec.md's own "Why
this priority" for US2 says so explicitly — so US2 is built first even though both are P1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task includes an exact file path

## Path Conventions

Web app (existing monorepo): `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`,
`packages/shared-domain/src/` — per plan.md's Project Structure.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before any change (quickstart.md step 1).

- [X] T001 Run `npm test` at the repository root and record the pass count. Every existing test
      from `011`, `012`, `013`, and `014` must be green before proceeding — this feature must not
      start from an already-broken baseline. (Found and fixed one pre-existing regression from
      this session's earlier select-all-checkbox work in
      `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx` — unrelated to this
      feature's scope but blocking a clean baseline. 703 tests passing after the fix.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared-domain contracts every later phase depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add the `BatchOutcomeRecord` interface (data-model.md) and extend
      `WorkflowStageState` with an optional `batchOutcomes?: BatchOutcomeRecord[]` field in
      `packages/shared-domain/src/testGenerationWorkflow.ts`.
- [X] T003 [P] Add an optional `aiBatchIndex?: number` field to `AIProvenance` in
      `packages/shared-domain/src/testModel.ts` (data-model.md).

**Checkpoint**: Shared types exist; both user stories below can now be implemented.

---

## Phase 3: User Story 2 - See which batches failed and why, after the run has settled (Priority: P1)

**Goal**: Every batch's terminal status and (for failed/not-attempted batches) a human-readable
reason remain visible after a run settles — with no retry action required yet.

**Independent Test**: Settle a run (via `MockProvider`) with a mix of succeeded, failed, and
not-attempted batches. Confirm `stages.aiEnhancement.batchOutcomes` is populated and correct, and
that the frontend renders every batch's status and reason, entirely without any retry button
existing.

### Tests for User Story 2

> Write these first; confirm they fail before the implementation tasks below make them pass.

- [X] T004 [P] [US2] Backend unit test in
      `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` asserting: after a
      `partial` settle, `stages.aiEnhancement.batchOutcomes` has one record per batch with correct
      `status`/`errorCategory`/`failureExplanation`; after a `not-viable` pre-flight skip,
      `batchOutcomes` is absent (quickstart.md step 2).
- [X] T005 [P] [US2] Frontend test in `frontend/tests/unit/AiEnhancementOutcomeSummary.test.tsx`
      (create the file) asserting every batch's status and reason render, and a non-retryable
      batch's reason is visually/textually distinguishable from a retryable one's.

### Implementation for User Story 2

- [X] T006 [US2] Extend the `onBatchComplete` callback signature on `EnhanceTestModelOptions` in
      `backend/src/testDesign/enhanceTestModel.ts` to also pass the settling batch's
      `operationKeys` (derived via the existing `operationKey()` helper), so a caller can record
      which operations each batch covered without recomputing it later. (`onBatchStart` left
      unchanged — nothing consumes operation keys at batch-start time, only at settle.)
- [X] T007 [US2] Add a batch-outcome mutator to
      `backend/src/testGenerationWorkflow/workflowStore.ts` (`setAiEnhancementBatchOutcome`)
      that upserts one `BatchOutcomeRecord` into `stages.aiEnhancement.batchOutcomes` by `index`
      (creating the array on first use) — independent of `progress`, which keeps its existing
      clear-on-settle lifecycle unchanged.
- [X] T008 [US2] Wire `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`'s
      `onBatchComplete` handler to call the T007 mutator on every settle (first run and any
      future retry alike) via a new `buildBatchOutcomeRecord()` helper: maps to `status` using
      the existing succeeded/failed/not-attempted logic already at
      `aiEnhancementStage.ts:247-252`, and builds `failureExplanation` via the existing
      `explainFailure()` — `explainFailure(errorCategory)` for `"failed"`,
      `explainFailure(isAiEnhancementCancelRequested() ? "cancelled" : "run-budget-exhausted")`
      for `"not-attempted"` (research.md Decision 4).
- [X] T009 [US2] Render each `batchOutcomes` entry's status and `failureExplanation.summary` in
      `frontend/src/components/AiEnhancementOutcomeSummary.tsx`, reusing the existing
      `StatusBadge` component for status. Read-only — no retry control in this phase.

**Checkpoint**: User Story 2 is independently functional and testable — per-batch detail survives
a settled run and is visible in the UI.

---

## Phase 4: User Story 1 - Retry only the batch that failed (Priority: P1)

**Goal**: A user can retry one specific eligible batch; only that batch's outcome and scenarios
change, and the stage's aggregate status reflects the new state.

**Independent Test**: Settle a run with a mix of outcomes (built on Phase 3's `batchOutcomes`).
Retry one eligible batch. Confirm only that batch's record and scenarios change, and that
retrying the last outstanding batch moves the stage from `"partial"` to `"complete"`.

### Tests for User Story 1

- [X] T010 [P] [US1] Backend unit tests in
      `backend/tests/unit/testDesign/enhanceTestModel.test.ts` for the extracted `retryOneBatch`:
      validates against the full `ApiModel`, dedupes against the deterministic baseline only (not
      against other batches' prior output), and returns a structured failure on an invalid
      response — no behavior change to `enhanceTestModel`'s own existing tests.
- [X] T011 [P] [US1] Backend unit tests in new file
      `backend/tests/unit/testGenerationWorkflow/retryAiEnhancementBatch.test.ts` covering: a
      successful retry adds only that batch's scenarios and leaves every other batch's scenarios
      and review decisions untouched; a repeat failure updates only its own `BatchOutcomeRecord`;
      retrying a `"succeeded"` batch or one with `retryable: false` is rejected; a concurrent
      whole-stage run or another batch retry is rejected; retrying the last outstanding batch
      recomputes the stage status to `"complete"` (quickstart.md steps 3-5). Also includes the
      US3 finalization-guard test up front (see T021 note) since it lives naturally in this file.
- [X] T012 [P] [US1] Backend Supertest contract test for
      `POST /api/test-generation-workflow/ai-enhancement/retry-batch` in
      `backend/tests/integration/testGenerationWorkflow.test.ts`, asserting every response in
      contracts/ai-enhancement-retry-batch.md (`200`, `404 batch_not_found`,
      `409 batch_not_retryable`, `409 stage_not_active`, `409 ai_enhancement_already_running`,
      `400 invalid_request`). **Bug found and fixed**: the concurrency test caught a real
      ordering defect in T017 — the stage-status guard ran before the `progress`-presence guard,
      so once the first call's own `updateStage("aiEnhancement", "active")` had run, a concurrent
      call saw status `"active"` and was rejected as `stage_not_active` instead of
      `ai_enhancement_already_running`. Fixed by checking `progress` first, matching how
      `runAiEnhancement` avoids the same trap.
- [X] T013 [P] [US1] Frontend test in `frontend/tests/unit/AiEnhancementStage.test.tsx` confirming
      a retry control renders only for eligible batches, calls the client with the correct
      `batchIndex`, and reflects the returned workflow.

### Implementation for User Story 1

- [X] T014 [P] [US1] Add `BatchNotFoundError` and `BatchNotRetryableError` to
      `backend/src/testGenerationWorkflow/errors.ts`, matching the existing error-class pattern
      (`AiEnhancementAlreadyRunningError`, etc.).
- [X] T015 [US1] Add `retryOneBatch(operations, apiModel, testModel, provider, requestId,
      batchIndex)` in `backend/src/testDesign/enhanceTestModel.ts`, reusing `runOneBatch` and the
      same `deduplicate()`/`scenariosAreEquivalent()` utilities `enhanceTestModel`'s own final
      merge already uses (research.md Decision 5). **Deviation from the literal plan**:
      `enhanceTestModel`'s own normal-run merge is a single whole-run dedupe pass over baseline +
      every batch's combined candidates (so it also catches cross-batch AI-to-AI duplicates);
      rewiring it to call `retryOneBatch` per batch internally would have silently dropped that
      existing behavior. Left `enhanceTestModel`'s normal-run path untouched; `retryOneBatch` is
      an additional function for the new retry-only call path, reusing the same primitives rather
      than duplicating them — satisfies the decision's actual intent (no duplicated algorithm)
      without the regression risk of its literal wording.
- [X] T016 [US1] Thread each batch's index through `runOneBatch`/`retryOneBatch` into
      `candidateToScenario()` in `backend/src/testDesign/aiScenarioCandidate.ts`, setting
      `AIProvenance.aiBatchIndex` on every AI-derived scenario produced from this feature onward
      — including from an ordinary, non-retried run (FR-010).
- [X] T017 [US1] Implement `retryAiEnhancementBatch(batchIndex, provider)` in
      `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`: look up the target
      `BatchOutcomeRecord` (throw `BatchNotFoundError` if out of range), reject if `status` is
      `"succeeded"` or `failureExplanation.retryable` is `false` (throw
      `BatchNotRetryableError`), reject if `stages.aiEnhancement.progress` is already present
      (throw the existing `AiEnhancementAlreadyRunningError`, research.md Decision 8), resolve
      the batch's operations from `apiModel.operations` via its pinned `operationKeys`
      (research.md Decision 2), call `retryOneBatch`, merge a success into `reviewWorkspace` via
      the existing `newlyAddedReviewScenarios` path (FR-004, factored into
      `mergeRetriedScenariosIntoWorkspace`), update only that batch's `BatchOutcomeRecord` via
      T007's mutator (FR-005), recompute the stage's aggregate status from every current
      `batchOutcomes` entry via a new `recomputeAggregateStatus()` helper — transitioning
      `skipped`/`partial` → `active` → `complete`/`partial`, reusing the existing transition set
      unchanged (research.md Decision 3, FR-012) — and append the retry's own candidate tallies
      into `workflow.aiEnhancement.aiCandidates` rather than replacing it, via
      `appendRetryIntoEnhancementResult` (research.md Decision 7). Extended `RetryOneBatchResult`
      to also carry the full `AICandidateOutcomes` classification (reusing a new shared
      `classifyAgainstBaseline()` helper, also adopted by `enhanceTestModel`'s own final merge)
      so this append has real fidelity rather than reconstructed stand-in data.
- [X] T018 [US1] Add
      `POST /api/test-generation-workflow/ai-enhancement/retry-batch` in
      `backend/src/api/testGenerationWorkflow.ts`, mapping `BatchNotFoundError` →
      `404 batch_not_found`, `BatchNotRetryableError` → `409 batch_not_retryable`,
      `StageNotActiveError` → `409 stage_not_active`, `AiEnhancementAlreadyRunningError` →
      `409 ai_enhancement_already_running`, and a missing/non-integer `batchIndex` →
      `400 invalid_request` (contracts/ai-enhancement-retry-batch.md).
- [X] T019 [US1] Add `retryAiEnhancementBatch(batchIndex: number)` to
      `frontend/src/services/testGenerationWorkflowClient.ts`, following the existing
      `postJson`-based pattern used by `cancelAiEnhancement`.
- [X] T020 [US1] Extracted the per-batch row rendering from `AiEnhancementOutcomeSummary.tsx`
      (T009) into a new shared `frontend/src/components/BatchOutcomeList.tsx` (with an optional
      `renderAction` prop), imported by both it (read-only) and
      `frontend/src/components/AiEnhancementStage.tsx`'s skipped/partial banner (with a retry
      button per eligible batch, calling T019's client method and passing the result to
      `onAdvanced`). Wired the new `batchOutcomes` prop through
      `frontend/src/pages/TestGenerationWorkflowPage.tsx`'s existing `AiEnhancementStage` render
      call.

**Checkpoint**: User Stories 1 and 2 are both fully functional and independently testable.

---

## Phase 5: User Story 3 - Retry is unavailable once scenario review has moved on (Priority: P2)

**Goal**: A batch retry is rejected once `scenarioReview` has been finalized, matching the existing
guard on whole-stage retry.

**Independent Test**: Finalize `scenarioReview`, then attempt a batch retry on the still-visible
prior AI Enhancement run. Confirm rejection and that nothing in `reviewWorkspace` or
`batchOutcomes` changes.

### Tests for User Story 3

- [X] T021 [P] [US3] Backend test in
      `backend/tests/unit/testGenerationWorkflow/retryAiEnhancementBatch.test.ts` (extends T011)
      asserting `retryAiEnhancementBatch` throws `StageNotActiveError` once
      `stages.scenarioReview.status === "complete"`, and that `reviewWorkspace`/`batchOutcomes`
      are byte-for-byte unchanged by the rejected attempt. **Note**: written and passing already
      as part of T011 — it fit naturally alongside the other eligibility-check tests in the same
      file, rather than waiting for a separate phase.

### Implementation for User Story 3

- [X] T022 [US3] Add the `stages.scenarioReview.status === "complete"` guard to
      `retryAiEnhancementBatch()` in `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`,
      throwing the existing `StageNotActiveError` — mirrors the identical check already present
      in `runAiEnhancement` at `aiEnhancementStage.ts:158-161`. **Note**: implemented already as
      part of T017 — the guard belongs with the function's other eligibility checks (batch found,
      batch retryable, stage settled, no concurrent run), so building it in one pass was more
      coherent than artificially splitting one function's validation across two phases.

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 [P] Add per-batch-retry log lines (e.g. `logger.info("batch_retry_settled", {...})`) in
      `backend/src/testGenerationWorkflow/aiEnhancementStage.ts`, carrying batch index, status,
      and error category only — never prompt or response content (constitution XX; plan.md's XX
      gate). **Note**: implemented already as part of T017 (`batch_retry_settled` /
      `batch_retry_error` log lines), matching the existing `stage_complete`/`stage_error`
      pattern `runAiEnhancement` already uses.
- [X] T024 Ran quickstart.md's validation sequence: steps 1-7 are each covered by the
      corresponding automated test written during implementation (T001, T004, T011, T011, T017,
      T011/T012, T013); step 8 is T025 below. Regression checklist confirmed: `011`-`014` outcome
      semantics, guards, and incremental reveal all still pass their existing tests unchanged; no
      real model download or inference occurred anywhere in the suite.
- [X] T025 Ran `npm test`, `npm run lint`, and `npm run build` at the repository root — all three
      clean. 725 tests passing (0 failed, 2 pre-existing skips), lint clean, build clean across
      `backend`, `frontend`, and `packages/shared-domain` (constitution XXXI, Definition of Done).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks both user stories.
- **User Story 2 (Phase 3)**: Depends on Foundational only. Delivers independently.
- **User Story 1 (Phase 4)**: Depends on Foundational **and** Phase 3 (US2) — retrying a batch
  requires `batchOutcomes` to exist and be populated first. This is the one place story order is
  not "may proceed in parallel" (spec.md documents this dependency explicitly).
- **User Story 3 (Phase 5)**: Depends on Phase 4 (US1) — the guard it adds lives inside the
  function US1 builds.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written first and must fail before the corresponding implementation task.
- Shared-domain/backend-internal changes precede the route; the route precedes the frontend client
  call; the client call precedes the UI control.

### Parallel Opportunities

- T002 and T003 (Foundational) — different files.
- T004 and T005 (US2 tests) — different files (backend vs. frontend).
- T010, T011, T012, T013 (US1 tests) — four different files.
- T014 can run alongside T015/T016 (different files: `errors.ts` vs. `enhanceTestModel.ts` /
  `aiScenarioCandidate.ts`).
- T021 (US3 test) has no parallel partner in its own phase but does not block Phase 6.

---

## Parallel Example: User Story 1 tests

```bash
# Launch all four US1 test tasks together — each touches a distinct file:
Task: "Backend unit tests for retryOneBatch in backend/tests/unit/testDesign/enhanceTestModel.test.ts"
Task: "Backend unit tests for retryAiEnhancementBatch in backend/tests/unit/testGenerationWorkflow/retryAiEnhancementBatch.test.ts"
Task: "Backend contract test in backend/tests/integration/testGenerationWorkflow.test.ts"
Task: "Frontend test in frontend/tests/unit/AiEnhancementStage.test.tsx"
```

---

## Implementation Strategy

### MVP First

User Story 2 alone (Phases 1-3) is a legitimate, shippable increment on its own: it fixes the
"per-batch detail disappears the moment a run settles" gap even before any retry action exists,
directly serving a QA engineer deciding whether retrying is worth attempting at all. Stop after
Phase 3 to validate independently before proceeding to the retry action itself.

### Incremental Delivery

1. Setup + Foundational → shared types exist.
2. User Story 2 → per-batch visibility ships → validate independently.
3. User Story 1 → the actual retry capability ships → validate independently (this is the
   feature's primary point, per spec.md's own framing).
4. User Story 3 → the finalization guardrail closes the remaining gap.
5. Polish → logging, full quickstart pass, full validation suite.

## Notes

- [P] tasks touch different files and carry no unfinished dependency between them.
- User Story 2 is built before User Story 1 despite spec.md listing US1 first — this reflects an
  explicit, documented technical dependency, not an error in story numbering; task IDs and
  `[US#]` labels still map to spec.md's original story identities.
- Commit after each task or logical group; stop at either checkpoint to validate a story
  independently before continuing.
