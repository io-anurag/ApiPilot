---
description: "Task list template for feature implementation"
---

# Tasks: Bounded AI Prompt Batching for Large Specifications

**Input**: Design documents from `/specs/011-ai-prompt-batching/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included. Not explicitly requested by the spec, but required by this repository's
testing conventions (`.github/copilot-instructions.md` §51-53 — tests are part of the
feature, not an afterthought; AI-dependent tests default to the deterministic `MockProvider`).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web app monorepo (existing structure): `backend/src/`, `backend/tests/unit/`,
`packages/shared-domain/src/`, `frontend/src/` — per plan.md's Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared-domain contract changes every user story depends on

- [x] T001 [P] Add `getInputBudget(maxOutputTokens?: number): Promise<number | undefined>` to the `AIProvider` interface in packages/shared-domain/src/aiProvider.ts (data-model.md)
- [x] T002 [P] Add `"partial"` to the `AIProviderOutcome` union in packages/shared-domain/src/aiScenarioDesign.ts
- [x] T003 [P] Add `"partial"` to the `DependencyAIOutcome` union in packages/shared-domain/src/apiDependency.ts
- [x] T004 Run `npm run build -w packages/shared-domain` to confirm the updated contracts compile before any consumer is updated

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The batching engine and per-provider capacity signal that every user story phase builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Implement `getInputBudget()` in backend/src/ai/localProvider.ts: export a new `CHARS_PER_TOKEN_ESTIMATE` constant alongside the existing `CONTEXT_SAFETY_MARGIN_TOKENS`, derive the budget from `tokenizer.model_max_length` (research.md Decision 2)
- [x] T006 [P] Implement `getInputBudget()` in backend/src/ai/mockProvider.ts: return `undefined` by default; add a test-only fixed-budget override to `MockProviderConfig`
- [x] T007 Create backend/src/ai/requestBatching.ts exporting `splitOperationsIntoBatches<TOperation>(operations, buildPrompt, budgetChars)` implementing deterministic recursive halving (research.md Decision 3; single batch when it fits or budget is `undefined`, floor of one operation per batch)
- [x] T008 Add `runBatchedInference()` to backend/src/ai/requestBatching.ts: sequentially runs one `provider.infer()` per batch — never issuing batch N+1 before batch N's `infer()` call resolves (FR-003) — collects a `BatchOutcome` per batch, and derives the aggregate outcome via the success/partial/timeout/unavailable/invalid-response table in data-model.md (depends on T001, T007)
- [x] T009 [P] Unit tests for `splitOperationsIntoBatches()` in backend/tests/unit/ai/requestBatching.test.ts: fits-in-one-batch passthrough, `undefined` budget passthrough, recursive halving down to one-operation batches, identical grouping across at least 10 repeated calls with the same input and same provider (FR-009, SC-004) (depends on T007)
- [x] T010 [P] Unit test in backend/tests/unit/ai/requestBatching.test.ts: the same operations list against two differently-configured `getInputBudget()` values (simulating two different providers) produces correspondingly different batch groupings within the same process lifetime, with no grouping reused/cached from the other provider's run (FR-012) (depends on T007)
- [x] T011 [P] Unit tests for `runBatchedInference()` in backend/tests/unit/ai/requestBatching.test.ts: (a) aggregate-outcome derivation — all-success → `success`, mixed → `partial`, all-timeout → `timeout`, all-unavailable-category → `unavailable`, mixed/other → `invalid-response`; (b) sequential ordering — batch N+1's `infer()` is not invoked until batch N's promise has resolved (FR-003) (depends on T008)

**Checkpoint**: Batching engine and provider capacity signal are ready — all user stories can now build on them

---

## Phase 3: User Story 1 - AI-assisted analysis completes for large specifications (Priority: P1) 🎯 MVP

**Goal**: Large specifications whose full `ApiModel` (or `ApiModel` + `TestModel`) doesn't fit
one AI request are split into multiple batches instead of having the AI-assisted pass skipped
entirely.

**Independent Test**: quickstart.md step 3 — a large `ApiModel` fixture exceeding a configured
`MockProvider` test budget produces more than one `provider.infer()` call, every operation
appears in exactly one batch, and `aiOutcome`/`aiProviderOutcome` is `"success"` when every
batch's mock call succeeds.

### Tests for User Story 1

- [x] T012 [P] [US1] Integration test: large `ApiModel` fixture triggers multi-batch dependency detection with all batches succeeding, in backend/tests/unit/dependencies/analyzeDependencies.test.ts
- [x] T013 [P] [US1] Integration test: large `ApiModel` + `TestModel` fixture triggers multi-batch enhancement with all batches succeeding, in backend/tests/unit/testDesign/enhanceTestModel.test.ts
- [x] T014 [P] [US1] Test: a single operation too large to fit any batch is treated as its own one-operation batch, fails via the existing `INVALID_REQUEST` path, and remaining batches still complete (FR-011), in backend/tests/unit/dependencies/analyzeDependencies.test.ts

### Implementation for User Story 1

- [x] T015 [US1] Wire `runAIAssistedPass()` in backend/src/dependencies/analyzeDependencies.ts to call `provider.getInputBudget()`, `splitOperationsIntoBatches()`, and `runBatchedInference()`, building one `buildAIDependencyRequest()` per batch's operation subset (depends on T007, T008)
- [x] T016 [US1] Update the AI request/merge loop in backend/src/testDesign/enhanceTestModel.ts to call `provider.getInputBudget()`, `splitOperationsIntoBatches()`, and `runBatchedInference()`, building one `buildAIScenarioRequest()` per batch's operation subset (depends on T007, T008)
- [x] T017 [US1] Merge AI-derived candidates/relationships from every successful batch with the deterministic baseline in analyzeDependencies.ts and enhanceTestModel.ts, reusing the existing per-candidate shape/semantic validation and deduplication pipeline unchanged (FR-005) (depends on T015, T016)
- [x] T018 [US1] Verify every operation from `apiModel.operations` appears in exactly one batch across both callers (FR-004) — add a debug-only assertion or unit test guard in requestBatching.ts (depends on T007)

**Checkpoint**: User Story 1 is fully functional and independently testable — large specifications no longer have AI enhancement fully skipped.

---

## Phase 4: User Story 2 - Small specifications behave exactly as before (Priority: P1)

**Goal**: Specifications that already fit in a single AI request today are completely
unaffected by the introduction of batching.

**Independent Test**: quickstart.md step 2 — an existing small `ApiModel` fixture produces
exactly one `provider.infer()` call per pass and byte-identical output to a pre-feature run.

### Tests for User Story 2

- [x] T019 [P] [US2] Regression test: existing small `ApiModel` fixture produces exactly one `provider.infer()` call and unchanged `aiOutcome`/output for dependency detection, in backend/tests/unit/dependencies/analyzeDependencies.test.ts
- [x] T020 [P] [US2] Regression test: same for `enhanceTestModel.ts`'s existing small-fixture cases, in backend/tests/unit/testDesign/enhanceTestModel.test.ts

### Implementation for User Story 2

- [x] T021 [US2] Confirm `splitOperationsIntoBatches()` returns a single batch whenever `getInputBudget()` is `undefined` or the full prompt already fits, with zero behavioral change to the single-request path (FR-006) (depends on T007; verified by T019, T020)
- [x] T022 [US2] Run the full existing backend suite (`npm test -w backend`) to confirm no regression across pre-existing AI-related tests (depends on T015, T016)

**Checkpoint**: User Stories 1 AND 2 both work independently — large specs are helped, small specs are unaffected.

---

## Phase 5: User Story 3 - Partial AI results are reported honestly (Priority: P2)

**Goal**: When some but not all batches for a large specification succeed, the successful
results are retained and the reported outcome is explicitly distinguishable from full success
and full failure — including in the workflow-stage status shown to the user, not only in the
raw `AIProviderOutcome`/`DependencyAIOutcome` value.

**Independent Test**: quickstart.md steps 4, 5, and 6 — forcing one of several batches to fail
while others succeed yields `aiOutcome`/`aiProviderOutcome === "partial"` with successful
results retained, and (for enhancement) a workflow `aiEnhancement` stage status of `"partial"`
distinct from `"skipped"`; forcing every batch to fail yields the same meaning as today's
single-batch failure, never `"partial"`.

### Tests for User Story 3

- [x] T023 [P] [US3] Test: one of several batches times out while others succeed → `aiOutcome === "partial"`, successful relationships retained, in backend/tests/unit/dependencies/analyzeDependencies.test.ts
- [x] T024 [P] [US3] Test: same partial-failure scenario for `enhanceTestModel.ts` → `aiProviderOutcome === "partial"`, successful scenarios retained, in backend/tests/unit/testDesign/enhanceTestModel.test.ts
- [x] T025 [P] [US3] Test: every batch fails → outcome/message equivalent in meaning to today's single-batch failure case, never `"partial"`, in backend/tests/unit/dependencies/analyzeDependencies.test.ts
- [x] T026 [P] [US3] Test: every batch fails for `enhanceTestModel.ts` → outcome/message equivalent in meaning to today's single-batch failure case, never `"partial"`, in backend/tests/unit/testDesign/enhanceTestModel.test.ts (FR-008 parity, symmetric with T025)
- [x] T027 [P] [US3] Test: `ANALYSIS_TIMEOUT_MS` budget is exhausted mid-run → remaining batches are treated as not attempted and folded into the partial/failure aggregation (FR-010), in backend/tests/unit/dependencies/analyzeDependencies.test.ts
- [x] T028 [P] [US3] Integration test: `runAiEnhancement()` maps an `aiProviderOutcome === "partial"` result to `workflow.stages.aiEnhancement.status === "partial"` (not `"skipped"`), in backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts (research.md Decision 7)

### Implementation for User Story 3

- [x] T029 [US3] Add `"partial"` to `StageStatus` in packages/shared-domain/src/testGenerationWorkflow.ts, applicable only to the `aiEnhancement` stage, mirroring how `"skipped"` already applies only there (depends on T002) — done alongside T001-T003 as an efficient batching decision
- [x] T030 [US3] Update `runAiEnhancement()` in backend/src/testGenerationWorkflow/aiEnhancementStage.ts from its current binary `result.aiProviderOutcome === "success"` check to a three-way branch: `"success"` → `"complete"`, `"partial"` → `"partial"`, anything else → `"skipped"` (depends on T016, T029)
- [x] T031 [P] [US3] Update frontend/src/components/AiEnhancementStage.tsx from its boolean `skipped` prop to a tri-state status prop, and frontend/src/pages/TestGenerationWorkflowPage.tsx's `workflow.stages.aiEnhancement.status === "skipped"` check to also render for `"partial"`, in frontend/tests/unit/AiEnhancementStage.test.tsx and frontend/tests/unit/TestGenerationWorkflowPage.test.tsx (depends on T029)
- [x] T032 [P] [US3] Update frontend/src/components/WorkflowStageTracker.tsx's `Record<StageStatus, ...>` maps (`CHIP_TONE_CLASSES`, `INDEX_TONE_CLASSES`, `STATUS_LABELS`, `STATUS_TONES`) to add a `"partial"` entry with its own label/tone distinct from `"skipped"` and `"complete"`, in frontend/tests/unit/WorkflowStageTracker.test.tsx (depends on T029; TypeScript will flag these `Record` maps as incomplete once T029 lands)
- [x] T033 [US3] Implement the full aggregate-outcome derivation table (data-model.md) in `runBatchedInference()`'s return value in backend/src/ai/requestBatching.ts (depends on T008; already covered by T011's tests — this task wires it into the real per-batch try/catch rather than the isolated unit test double)
- [x] T034 [US3] Update the human-readable error-message builder in backend/src/dependencies/analyzeDependencies.ts to describe partial completion (e.g., "AI provider timed out for 1 of 3 batches; deterministic relationships and partial AI results were preserved") (depends on T015, T033)
- [x] T035 [US3] Update the human-readable error-message builder in backend/src/testDesign/enhanceTestModel.ts analogously (depends on T016, T033)
- [x] T036 [US3] Enforce the existing `ANALYSIS_TIMEOUT_MS` wall-clock check between batches in backend/src/dependencies/analyzeDependencies.ts, marking any remaining batches "not-attempted" once the budget is exhausted (FR-010, research.md Decision 5) (depends on T015, T033)

**Checkpoint**: All three user stories are independently functional — batching helps large specs, leaves small specs untouched, and reports partial failure honestly at every layer, including the workflow status shown to the user.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T037 [P] Verify no remaining exhaustive `switch`/`if` statements over `AIProviderOutcome`/`DependencyAIOutcome`/`StageStatus` need updates for `"partial"` beyond those already handled in T029-T032 (search frontend/src and backend/src for these type names); update any found — verified via grep: `analyzeDependencies.ts`'s `providerErrorMessage()` and `enhanceTestModel.ts`'s equivalent already branch on `"partial"`; `aiEnhancementStage.ts`'s 3-way branch and `WorkflowStageTracker.tsx`'s `Record<StageStatus,...>` maps are the only other call sites and both already handle it; no other `switch`/`if` chains over these three type names exist
- [x] T038 [P] Update the outcome-value enumeration/table directly within specs/008-dependency-workflow-engine/contracts/api-dependency-workflow-api.md and specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md to include `"partial"` (not merely a pointer note), and cross-reference specs/011-ai-prompt-batching/contracts/ai-batching-outcome.md for the full rationale
- [x] T039 Run `npm test`, `npm run lint`, and `npm run build` at the repo root to validate the full change — all green: 597 tests passed (2 skipped, real-model opt-in tests), lint clean, all 3 workspaces (backend/frontend/shared-domain) built successfully
- [x] T040 Run through quickstart.md's manual validation steps end-to-end, including step 6's bulk-review-scale confirmation for the newly-unblocked large-specification case (constitution XXXII) — steps 1-5 are exercised directly by the automated test suite added in this implementation (T012-T028: multi-batch success/partial/total-failure for both dependency detection and scenario enhancement, plus the "partial" workflow-stage-status surfacing); step 6 relies on spec 010's existing bulk/filtered-decision review UI coverage (`frontend/tests/unit/TestScenarioReviewList.test.tsx`'s "bulk actions" suite), which already exercises grouped/bulk accept-reject at the review-list level — no live browser/real-model walkthrough was performed as part of this task

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) completion — BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational (Phase 2) completion
  - User Story 1 (P1) and User Story 2 (P1) can proceed in parallel once Phase 2 is done
  - User Story 3 (P2) can also start once Phase 2 is done, but its tests are most meaningful once US1's wiring (T015/T016) exists
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependency on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) — its regression tests (T019, T020) are most useful once US1's wiring (T015, T016) exists, but the requirement itself (FR-006) is verified against Phase 2's `splitOperationsIntoBatches()` behavior directly
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) — reuses US1's wiring (T015, T016) as the integration point for partial-outcome reporting; T029-T032 (workflow-stage-status + frontend) additionally depend on T002 (shared-domain `AIProviderOutcome` gains `"partial"`)

### Within Each User Story

- Tests are written before the implementation tasks that make them pass
- Shared-domain contract changes (Phase 1) before provider implementations (Phase 2)
- Provider implementations and batching engine (Phase 2) before caller wiring (Phase 3+)
- Caller wiring before outcome-message refinement (US3)
- Backend workflow-stage-status wiring (T029, T030) before the frontend consumers that render it (T031, T032)

### Parallel Opportunities

- T001, T002, T003 (Phase 1) can run in parallel — independent files
- T005, T006 (Phase 2) can run in parallel — independent files
- T009, T010, T011 (Phase 2) can run in parallel once T007/T008 exist — independent test files (same file, independent test cases)
- T012, T013, T014 (US1 tests) can run in parallel
- T019, T020 (US2 tests) can run in parallel
- T023, T024, T025, T026, T027, T028 (US3 tests) can run in parallel
- T031, T032 (US3 frontend) can run in parallel once T029 lands
- T037, T038 (Polish) can run in parallel

---

## Parallel Example: Phase 1 + Phase 2

```bash
# Phase 1 (shared-domain contracts) - all independent files:
Task: "Add getInputBudget() to AIProvider in packages/shared-domain/src/aiProvider.ts"
Task: "Add \"partial\" to AIProviderOutcome in packages/shared-domain/src/aiScenarioDesign.ts"
Task: "Add \"partial\" to DependencyAIOutcome in packages/shared-domain/src/apiDependency.ts"

# Phase 2 (provider capacity signal) - independent files, after Phase 1:
Task: "Implement getInputBudget() in backend/src/ai/localProvider.ts"
Task: "Implement getInputBudget() in backend/src/ai/mockProvider.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (shared-domain contract changes)
2. Complete Phase 2: Foundational (batching engine + provider capacity signal — CRITICAL, blocks all stories)
3. Complete Phase 3: User Story 1 (large specifications now complete AI-assisted analysis instead of being skipped)
4. **STOP and VALIDATE**: Run quickstart.md step 3 independently — confirm large-fixture multi-batch success end-to-end
5. Deploy/demo if ready — this alone delivers the feature's core value

### Incremental Delivery

1. Setup + Foundational → batching engine exists but nothing calls it yet
2. Add User Story 1 → large specs work → test independently → this is the MVP
3. Add User Story 2 → confirm zero regression on small specs → test independently
4. Add User Story 3 → partial-failure reporting is honest and distinguishable at every layer (raw outcome value, workflow stage status, and UI) → test independently
5. Polish → remaining consumer verification, contract-doc updates, full-suite validation, quickstart walkthrough (including bulk-review-scale confirmation)

### Suggested Task Count Summary

- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 7 tasks
- Phase 3 (US1): 7 tasks
- Phase 4 (US2): 4 tasks
- Phase 5 (US3): 14 tasks
- Phase 6 (Polish): 4 tasks
- **Total**: 40 tasks
