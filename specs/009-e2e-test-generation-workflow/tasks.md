---

description: "Task list for AP-009 End-to-End Test Generation Workflow"
---

# Tasks: End-to-End Test Generation Workflow

**Input**: Design documents from `/specs/009-e2e-test-generation-workflow/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/test-generation-workflow-api.md, quickstart.md

**Tests**: Test tasks ARE included. plan.md names the test surfaces explicitly (Vitest across backend/frontend/shared-domain, Supertest for the new routes, RTL for the new components), and contracts/test-generation-workflow-api.md lists guarantees to be asserted by contract tests.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently. Per plan.md, this feature touches all three workspaces (`backend`, `frontend`, `packages/shared-domain`) and reuses every AP-002–AP-008 function unmodified — new code is orchestration only (stage sequencing, staleness, and the two genuinely new decision types: workflow-review approval and AI-enhancement retry).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Web application in an npm-workspaces monorepo, per plan.md: `backend/src/`, `frontend/src/`,
`packages/shared-domain/src/`, with tests under each workspace's `tests/` directory.
`vitest.workspace.ts` already includes `tests/**/*.test.ts` in every workspace, so no test-runner
configuration is needed for the new folders.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the orchestration domain contract and shared test fixtures. No dependency is added — plan.md's Technical Context specifies zero new packages.

- [X] T001 Create the orchestration contract module in `packages/shared-domain/src/testGenerationWorkflow.ts` with the types from data-model.md: `WorkflowStageId`, `WORKFLOW_STAGE_ORDER`, `StageStatus`, `WorkflowStageState`, `TestGenerationWorkflow`, `WorkflowReviewState`, `WorkflowReviewDecision`; keep the module framework-agnostic and do not modify `ApiModel`, `TestModel`, `ReviewWorkspace`, or `DependencyAnalysisResult`
- [X] T002 Re-export the new contracts from `packages/shared-domain/src/index.ts` alongside the existing `export * from "./apiDependency"` line
- [X] T003 [P] Add workflow fixtures in `backend/tests/fixtures/testGenerationWorkflow/workflowFixtures.ts`: a multipart-upload buffer helper wrapping `backend/tests/fixtures/openapi/valid.yaml` (mirroring `backend/tests/integration/specifications.test.ts`'s upload pattern), and a small representative fixture whose deterministic generation yields at least one scenario per operation (so US1's finalize/empty-set edge case has both a non-empty and an emptiable fixture to exercise)
- [X] T004 [P] Contract shape test in `packages/shared-domain/tests/unit/test-generation-workflow.test.ts`, following the pattern of `packages/shared-domain/tests/unit/api-dependency.test.ts`: `WORKFLOW_STAGE_ORDER` has exactly the nine stage ids in spec.md's FR-001 order

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The stage-order/gating rules, the single in-memory store, and the route/app wiring every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Unit test for stage gating in `backend/tests/unit/testGenerationWorkflow/workflowStages.test.ts`: `WORKFLOW_STAGE_ORDER` matches spec.md's FR-001 list; `isStageEnterable` derives correctly from the "requires" column of data-model.md's stage-dependency table for every stage
- [X] T006 [P] Unit test for the store in `backend/tests/unit/testGenerationWorkflow/workflowStore.test.ts`: `getCurrentWorkflow()` returns `undefined` with nothing started; `startWorkflow` seeds a fresh instance with `apiReview` active and every other stage `not-yet-reached`; `updateStage` allows only the transitions in data-model.md's `StageStatus` table and rejects any other transition; a test-only `resetStore()` clears state between tests (mirrors `resetAIProvider` in `backend/src/ai/index.ts`)
- [X] T007 [P] Implement `backend/src/testGenerationWorkflow/workflowStages.ts`: `WORKFLOW_STAGE_ORDER`, `isStageEnterable(workflow, stageId)` (depends on T005)
- [X] T008 Implement `backend/src/testGenerationWorkflow/workflowStore.ts`: the single module-level `TestGenerationWorkflow | undefined` instance, `getCurrentWorkflow`, `startWorkflow`, `updateStage` (enforcing the valid-transition table), `resetStore` (depends on T006, T007)
- [X] T009 Implement the route skeleton in `backend/src/api/testGenerationWorkflow.ts`: `createTestGenerationWorkflowRouter(provider = getAIProvider())` following the factory pattern in `backend/src/api/enhancedTestModels.ts`; `GET /api/test-generation-workflow` (`200` with `{ workflow }` / `204` when none in progress); a shared `409 { error: "stage_not_active" }` response helper reused by every stage-transition route added in later phases (depends on T008)
- [X] T010 Register the router in `backend/src/app.ts` alongside the existing `/api` routers, following the `provider ? createXRouter(provider) : xRouter` pattern already used for `enhancedTestModelsRouter`/`apiDependenciesRouter` (depends on T009)

**Checkpoint**: Stage gating, the store, and the route skeleton exist — user story implementation can begin.

---

## Phase 3: User Story 1 - Go From Specification to Executable Tests in One Guided Flow (Priority: P1) 🎯 MVP

**Goal**: Walk the complete pipeline — upload, analysis, API review, deterministic generation, AI enhancement, scenario review, dependency analysis, workflow review/approval, Postman generation — as one guided sequence, ending in a downloadable, traceable Postman collection.

**Independent Test**: Upload the representative fixture, proceed through every stage using only the guided workflow's own navigation (no direct calls to the pre-existing stateless endpoints), and confirm the end result is a downloadable Postman collection/environment whose requests trace back to approved scenarios.

### Tests for User Story 1

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T011 [P] [US1] Integration test for workflow start in `backend/tests/integration/testGenerationWorkflow.test.ts`, using Supertest following `backend/tests/integration/specifications.test.ts`: `POST /api/test-generation-workflow` with the valid fixture succeeds with `apiReview` active; a second `POST` while one is in progress is refused `409 workflow_in_progress` unless `?discardExisting=true`; malformed YAML, an unsupported version, and an oversized upload map to the same `invalid_yaml`/`unsupported_version`/`file_too_large` codes AP-002 already defines (FR-001, FR-010)
- [X] T012 [P] [US1] Extend `testGenerationWorkflow.test.ts` with the full sequence: `apiReview/continue` → `deterministic-generation` → `ai-enhancement` (success path) → `scenario-review/decisions` (accept a subset) → `scenario-review/finalize` → automatic `dependencyAnalysis` → `workflow-review/decisions` + `workflow-review/continue` → `postman-generation`; assert each response's `activeStageId` advances correctly and the final response's collection/environment contain requests traceable to the approved scenarios (User Story 1 Acceptance Scenarios 1, 2, 4)
- [X] T013 [P] [US1] Unit test for `apiReviewStage.ts` in `backend/tests/unit/testGenerationWorkflow/apiReviewStage.test.ts`: continuing while `apiReview` is not `active` is refused `409 stage_not_active`; continuing while `active` completes the stage and advances `activeStageId` to `deterministicGeneration`
- [X] T014 [P] [US1] Unit test for `deterministicGenerationStage.ts` in `backend/tests/unit/testGenerationWorkflow/deterministicGenerationStage.test.ts`: wraps `generateTestModel` unchanged, stores the result as `deterministicTestModel`, advances to `aiEnhancement`
- [X] T015 [P] [US1] Unit test for `aiEnhancementStage.ts` (happy path only — skip/retry is US4) in `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts`: a successful `enhanceTestModel` call completes the stage and seeds `reviewWorkspace` from `aiEnhancement.enhancedTestModel`
- [X] T016 [P] [US1] Unit test for `scenarioReviewStage.ts` in `backend/tests/unit/testGenerationWorkflow/scenarioReviewStage.test.ts`: `decisions`/`edit`/`regenerate` wrap `applyReviewUpdates`/`applyReviewEdit`/`regenerateReviewScenario` against the workflow's stored `reviewWorkspace` (never a request-body snapshot); `finalize` commits `approvedTestModel` and advances to `dependencyAnalysis`; finalizing with zero approved scenarios is refused `409 empty_approved_scenarios` (FR-011)
- [X] T017 [P] [US1] Unit test for `dependencyAnalysisStage.ts` in `backend/tests/unit/testGenerationWorkflow/dependencyAnalysisStage.test.ts`: entering the stage automatically runs `analyzeDependencies(apiModel)` and stores the result, advancing to `workflowReview` with no separate trigger
- [X] T018 [P] [US1] Unit test for `workflowReviewStage.ts` in `backend/tests/unit/testGenerationWorkflow/workflowReviewStage.test.ts`: approve/reject decisions are recorded per `IntegrationWorkflow.id`; `continue` is refused `409 pending_workflow_decisions` while any discovered workflow is undecided; the stage auto-completes on entry when `workflows` and `manualConfirmationCandidates` are both empty (research.md D5)
- [X] T019 [P] [US1] Unit test for `postmanGenerationStage.ts` in `backend/tests/unit/testGenerationWorkflow/postmanGenerationStage.test.ts`: wraps `generateCollection(apiModel, approvedTestModel, options)` unchanged and never attaches `IntegrationWorkflow` data (research.md D2); refused `409 stage_not_active` unless `workflowReview` is `complete`

### Implementation for User Story 1

- [X] T020 [US1] Implement `backend/src/testGenerationWorkflow/startWorkflow.ts`: reuse `parseYaml`/`validateSpec`/`buildApiModel` (AP-002) to build the `ApiModel`, then create a fresh `TestGenerationWorkflow` via `workflowStore.startWorkflow`; refuse with `409 workflow_in_progress` unless `discardExisting=true` (depends on T008, T011)
- [X] T021 [US1] Implement `backend/src/testGenerationWorkflow/apiReviewStage.ts` (depends on T008, T013)
- [X] T022 [US1] Implement `backend/src/testGenerationWorkflow/deterministicGenerationStage.ts` calling the unmodified `generateTestModel` (depends on T008, T014)
- [X] T023 [US1] Implement `backend/src/testGenerationWorkflow/aiEnhancementStage.ts` happy-path wiring around `enhanceTestModel` (depends on T008, T015)
- [X] T024 [US1] Implement `backend/src/testGenerationWorkflow/scenarioReviewStage.ts`: `decisions`/`edit`/`regenerate`/`finalize` wired to `hydrateReviewWorkspace`/`applyReviewUpdates`/`applyReviewEdit`/`beginRegeneration`/`regenerateReviewScenario`/`applyRegeneratedScenario`/`projectApprovedTestModel` from `backend/src/testDesign/reviewTestModel.ts` (depends on T008, T016)
- [X] T025 [US1] Implement `backend/src/testGenerationWorkflow/dependencyAnalysisStage.ts` calling the unmodified `analyzeDependencies` (depends on T008, T017)
- [X] T026 [US1] Implement `backend/src/testGenerationWorkflow/workflowReviewStage.ts` (depends on T008, T018)
- [X] T027 [US1] Implement `backend/src/testGenerationWorkflow/postmanGenerationStage.ts` calling the unmodified `generateCollection` (depends on T008, T019)
- [X] T028 [US1] Wire `POST /api/test-generation-workflow` (start) and all seven stage-transition routes (`api-review/continue`, `deterministic-generation`, `ai-enhancement`, `scenario-review/decisions|edit|regenerate|finalize`, `workflow-review/decisions|continue`, `postman-generation`) into `backend/src/api/testGenerationWorkflow.ts` per contracts/test-generation-workflow-api.md (depends on T009, T020–T027)
- [X] T029 [P] [US1] Implement `frontend/src/services/testGenerationWorkflowClient.ts`: one function per endpoint in contracts/test-generation-workflow-api.md, following the existing client pattern in `frontend/src/services/reviewsClient.ts`
- [X] T030 [P] [US1] Implement `frontend/src/components/ApiReviewStage.tsx`: wraps `AnalysisSummary`/`OperationList`/`OperationDetail` unmodified, plus a "Continue" action (research.md D3)
- [X] T031 [P] [US1] Implement a minimal `frontend/src/components/WorkflowStageTracker.tsx`: lists the nine stages and the active stage only (the full status/error display is US2, T043)
- [X] T032 [P] [US1] Implement `frontend/src/components/AiEnhancementStage.tsx` happy-path UI: an "Enhance with AI" trigger and a success display (skip/retry UI is US4, T059)
- [X] T033 [P] [US1] Implement `frontend/src/components/ScenarioReviewStage.tsx`: wraps the existing `TestScenarioReviewList`/`TestScenarioReviewSummary`/`TestScenarioReviewDetail`/`TestScenarioReviewDecision`/`TestScenarioReviewRefinement` components unmodified, driven by `testGenerationWorkflowClient` instead of `reviewsClient`, plus a "Finalize Review" action
- [X] T034 [P] [US1] Implement `frontend/src/components/WorkflowReviewStage.tsx`: lists discovered `IntegrationWorkflow`s (steps, variables, and their relationships' evidence/explanation) with approve/reject controls and a "Continue" action
- [X] T035 [P] [US1] Implement `frontend/src/components/PostmanGenerationStage.tsx`, following `PostmanExportPanel.tsx`'s structure (base-URL/variable inputs, limitations list, download links) driven by `testGenerationWorkflowClient` instead of `postmanCollectionsClient` (research.md D10)
- [X] T036 [US1] Implement `frontend/src/pages/TestGenerationWorkflowPage.tsx`: fetch `GET /api/test-generation-workflow` on mount, render `WorkflowStageTracker` plus the component matching `activeStageId`, and an upload form when no workflow is in progress (depends on T029–T035)
- [X] T037 [US1] Update `frontend/src/App.tsx` to render `TestGenerationWorkflowPage` instead of `SpecificationUploadPage` (depends on T036)
- [X] T038 [US1] Remove `frontend/src/pages/SpecificationUploadPage.tsx`, `frontend/src/pages/TestScenarioReviewPage.tsx`, and `frontend/tests/unit/TestScenarioReviewPage.test.tsx`; rewrite `frontend/tests/unit/App.test.tsx` against `TestGenerationWorkflowPage` (research.md D10) (depends on T037)
- [X] T039 [P] [US1] Component test `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx` covering the full happy-path walk-through with RTL and a mocked `testGenerationWorkflowClient`, following the patterns in the removed `TestScenarioReviewPage.test.tsx` (depends on T036)

**Checkpoint**: The full guided path works end to end through the API and the UI. MVP is complete and independently testable.

---

## Phase 4: User Story 2 - Always Know Where I Am and What's Left (Priority: P2)

**Goal**: Make every stage's status, and any stage-level error/issue, visible at the workflow level, and guarantee the workflow resumes correctly on reload or from a different browser connection.

**Independent Test**: Start a workflow, complete a few stages, reload the page (or issue a fresh `GET`), and confirm the progress view and all prior decisions are exactly as left.

### Tests for User Story 2

- [X] T040 [P] [US2] Extend `workflowStore.test.ts` (T006): after a sequence of stage mutations, a fresh `getCurrentWorkflow()` call returns the exact same state a second caller would see — proving reload/second-connection resume is possible from the store alone (FR-014, FR-018)
- [X] T041 [P] [US2] Component test `frontend/tests/unit/WorkflowStageTracker.test.tsx`: every `StageStatus` value (`not-yet-reached`/`active`/`complete`/`stale`/`skipped`) renders with a distinguishable, non-color-only indicator; an AI-unavailable condition or an `ApiModel.summary.issues` entry is shown at the tracker level, not only inside the active stage's own view (FR-004, User Story 2 Acceptance Scenario 2)
- [X] T042 [US2] Integration test in `testGenerationWorkflow.test.ts`: after advancing past `scenarioReview`, a fresh `GET /api/test-generation-workflow` request returns the same `activeStageId` and committed stage data as the state just produced, simulating a reload or a second browser connection (User Story 2 Acceptance Scenario 3, FR-014)

### Implementation for User Story 2

- [X] T043 [US2] Extend `WorkflowStageTracker.tsx` (T031) into its full form: render every stage's `WorkflowStageState.status`, and surface `aiEnhancement.aiErrorCategory`/`aiErrorMessage`, `apiModel.summary.issues`, and `dependencyAnalysis.aiErrorCategory` at the tracker level (depends on T040, T041)
- [X] T044 [US2] Update `TestGenerationWorkflowPage.tsx` to always re-fetch `GET /api/test-generation-workflow` on mount rather than trusting any previously held client state, so a reload or new tab always resumes from server state (depends on T042, T036)

**Checkpoint**: Progress is fully visible and reload-safe. User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Revise an Earlier Decision Without Silently Invalidating Later Work (Priority: P2)

**Goal**: When a completed stage's decision is revised, mark every downstream `complete` stage `stale` instead of silently leaving outdated output in place, and block re-downloading a Postman collection until the stale stages are redone.

**Independent Test**: Complete the workflow through Postman generation, return to scenario review, change a decision that affects downstream output, and confirm the affected downstream stages are marked stale and Postman generation is refused until they are redone.

### Tests for User Story 3

- [X] T045 [P] [US3] Unit test for `staleness.ts` in `backend/tests/unit/testGenerationWorkflow/staleness.test.ts`: `computeDownstreamStaleness(workflow, revisedStageId)` returns exactly every stage after `revisedStageId` (in `WORKFLOW_STAGE_ORDER`) currently `complete`; never returns a stage at or before `revisedStageId`; returns the same result regardless of the order stage statuses were set in (data-model.md, SC-003)
- [X] T046 [P] [US3] Extend `scenarioReviewStage.test.ts` (T016): applying a decision, edit, or regeneration while `scenarioReview` is `complete` moves it back to `active` and marks every currently-`complete` downstream stage (`dependencyAnalysis`, `workflowReview`, `postmanGeneration`) `stale` (FR-006)
- [X] T047 [P] [US3] Extend `workflowReviewStage.test.ts` (T018): changing a decision while `workflowReview` is `complete` moves it back to `active` and marks `postmanGeneration` `stale` if it was `complete`
- [X] T048 [US3] Extend `postmanGenerationStage.test.ts` (T019): generation is refused `409 stage_not_active` whenever `workflowReview` is `stale` (not only when it is `not-yet-reached`/`active`) — since a stale stage is never `complete`, the existing "requires `workflowReview` complete" gate already covers this; the test locks in that this remains true once staleness exists (FR-007)
- [X] T049 [US3] Integration test in `testGenerationWorkflow.test.ts`: run the full sequence through `postmanGeneration`, then revise an already-accepted scenario via `scenario-review/decisions`, and confirm a subsequent `GET` reports `dependencyAnalysis`/`workflowReview`/`postmanGeneration` as `stale`, and a `postman-generation` retry is refused until `scenario-review/finalize` → `workflow-review/continue` are redone (User Story 3, SC-003)

### Implementation for User Story 3

- [X] T050 [US3] Implement `backend/src/testGenerationWorkflow/staleness.ts`: `computeDownstreamStaleness(workflow, revisedStageId)` (depends on T045)
- [X] T051 [US3] Wire staleness into `scenarioReviewStage.ts`'s `decisions`/`edit`/`regenerate` actions: when the stage is currently `complete`, transition it to `active` and apply `computeDownstreamStaleness` to mark dependents `stale` (depends on T046, T050, T024)
- [X] T052 [US3] Wire staleness into `workflowReviewStage.ts`'s `decisions` action the same way (depends on T047, T050, T026)
- [X] T053 [US3] Confirm/verify `postmanGenerationStage.ts`'s existing `workflowReview === "complete"` gate correctly refuses when the stage is `stale` (no new error code — reuses `stage_not_active`); add the test-locked comment referencing FR-007 (depends on T048, T027, T050)
- [X] T054 [US3] Extend `WorkflowStageTracker.tsx`, `ScenarioReviewStage.tsx`, `WorkflowReviewStage.tsx`, and `PostmanGenerationStage.tsx` to render a `stale` stage distinguishably from `complete`/`active` and show a "this stage needs to be redone" prompt (depends on T043, T051–T053)

**Checkpoint**: Revising an earlier decision correctly invalidates dependent downstream work rather than leaving it silently stale. User Stories 1–3 all work independently.

---

## Phase 6: User Story 4 - Continue the Workflow When Local AI Is Unavailable (Priority: P3)

**Goal**: When the local AI provider is unavailable during AI enhancement, proceed on the deterministic-only baseline with the condition visibly recorded, and allow retrying AI enhancement later — but only until scenario review is finalized.

**Independent Test**: Force the AI provider unavailable at the enhancement stage, confirm the workflow still reaches Postman generation on the deterministic-only baseline, then confirm a retry succeeds once the provider becomes available (as long as scenario review is not yet finalized) and is refused afterward.

### Tests for User Story 4

- [X] T055 [P] [US4] Extend `aiEnhancementStage.test.ts` (T015): an `aiProviderOutcome` other than `"success"` completes the transition with `StageStatus: "skipped"`, records `aiErrorCategory`/`aiErrorMessage` on the stage state, and still advances `activeStageId` to `scenarioReview`, seeded from the unchanged deterministic `TestModel` (FR-008)
- [X] T056 [P] [US4] Extend `aiEnhancementStage.test.ts`: calling the `ai-enhancement` transition again while the stage is `skipped` and `scenarioReview` is not `complete` re-attempts `enhanceTestModel` and, on success, folds any AI-derived scenarios into the still-live `reviewWorkspace` (FR-008a); calling it again after `scenarioReview` is `complete` is refused `409 stage_not_active` with a message naming scenario review as already finalized
- [X] T057 [US4] Integration test in `testGenerationWorkflow.test.ts` using a fake `AIProvider` test double (following the pattern in `backend/tests/unit/testDesign/enhanceTestModel.test.ts`) that reports unavailable and then success: covers the skip → proceed → retry → success sequence, and the after-finalize refusal (User Story 4 Acceptance Scenarios 1–4)

### Implementation for User Story 4

- [X] T058 [US4] Extend `aiEnhancementStage.ts` with the skip/retry gating from data-model.md's `StageStatus` transitions and contracts/test-generation-workflow-api.md's `ai-enhancement` endpoint (depends on T055, T056, T023)
- [X] T059 [P] [US4] Extend `AiEnhancementStage.tsx` (T032) with a skipped-state banner (showing the recorded error category/message) and a "Retry AI enhancement" action, hidden once `scenarioReview` is `complete` (depends on T057, T032)

**Checkpoint**: All four user stories are independently functional. AI unavailability never blocks the workflow, and a transient failure is recoverable without restarting.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T060 [P] No-network test in `backend/tests/unit/testGenerationWorkflow/noNetwork.test.ts`, following `backend/tests/unit/dependencies/noNetwork.test.ts`: no `/api/test-generation-workflow/*` endpoint issues a request to any host described by the workflow's `ApiModel` (FR-013, SC-007)
- [X] T061 [P] Diagnostics safety test in `backend/tests/integration/testGenerationWorkflowDiagnostics.test.ts`: no response body or logged message from any `/api/test-generation-workflow/*` endpoint contains specification content, generated payloads, or AI prompts/responses beyond an error category (FR-016)
- [X] T062 [P] Accessibility check for the new stage components in `frontend/tests/unit/TestGenerationWorkflowAccessibility.test.tsx`, following `frontend/tests/unit/TestScenarioReviewAccessibility.test.tsx`: keyboard reachability of every stage action, accessible names for stage-tracker status, and no status communicated by color alone
- [X] T063 [P] Document the capability in `README.md` alongside the existing AP-00x sections: the guided workflow's nine stages, the single-global-workflow-instance behavior (FR-018), and the explicit statement that approved integration workflows are retained for traceability but not yet rendered into the Postman artifact (research.md D2)
- [X] T064 Run the quickstart validation in `specs/009-e2e-test-generation-workflow/quickstart.md`, including the resume, staleness-cascade, AI-unavailable/retry, and exclusive-entry-point manual checks
- [X] T065 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and resolve every failure without weakening TypeScript/ESLint configuration and without disabling tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — no dependency on other stories; delivers the full pipeline on the happy path (AI succeeds, no revisions)
- **User Story 2 (Phase 4)**: Depends on Foundational; extends `WorkflowStageTracker.tsx` and `TestGenerationWorkflowPage.tsx` created in US1, so run after US1 when worked sequentially
- **User Story 3 (Phase 5)**: Depends on Foundational; extends `scenarioReviewStage.ts`, `workflowReviewStage.ts`, and `postmanGenerationStage.ts` from US1, and `WorkflowStageTracker.tsx` from US1/US2
- **User Story 4 (Phase 6)**: Depends on Foundational; extends `aiEnhancementStage.ts` and `AiEnhancementStage.tsx` from US1
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### Within Each User Story

- Tests are written first and must fail before implementation
- `workflowStages.ts`/`workflowStore.ts` (T007, T008) precede every stage module, which precedes route wiring, which precedes any frontend client/component work
- Backend stage-transition endpoints for a stage precede that stage's frontend component

### Story Independence Notes

US1 is fully independent and is the MVP; it deliberately defers AI-skip/retry (US4) and staleness-on-revision (US3) to their own stories, and a minimal stage tracker (US2 delivers the full one). US2, US3, and US4 each extend files US1 created (`WorkflowStageTracker.tsx`, `scenarioReviewStage.ts`, `workflowReviewStage.ts`, `postmanGenerationStage.ts`, `aiEnhancementStage.ts`, `AiEnhancementStage.tsx`) rather than replacing them, so they remain independently testable but touch shared files — do not run US2, US3, and US4 implementation tasks concurrently against the same file.

### Parallel Opportunities

- All Phase 1 tasks marked [P] run in parallel; T007 depends on T005, T008 depends on T006+T007
- Within each story, every test task marked [P] runs in parallel; the nine US1 stage-module unit tests (T013–T019, spread across two batches) are independent of each other
- All nine frontend component tasks in US1 (T030–T035) are independent files and run in parallel once T029 (the client) exists
- With multiple developers: after Phase 2, US1 can start immediately; US2's tracker work, US3's `staleness.ts`, and US4's retry-gating groundwork can be drafted in parallel with US1's later tasks since none depend on US1's route wiring (T028) being finished, though final integration into the stage modules must happen in story order

---

## Parallel Example: User Story 1

```bash
# Write all User Story 1 backend unit tests together, then confirm they fail:
Task: "Unit test for apiReviewStage.ts in backend/tests/unit/testGenerationWorkflow/apiReviewStage.test.ts"
Task: "Unit test for deterministicGenerationStage.ts in backend/tests/unit/testGenerationWorkflow/deterministicGenerationStage.test.ts"
Task: "Unit test for aiEnhancementStage.ts in backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts"
Task: "Unit test for scenarioReviewStage.ts in backend/tests/unit/testGenerationWorkflow/scenarioReviewStage.test.ts"
Task: "Unit test for dependencyAnalysisStage.ts in backend/tests/unit/testGenerationWorkflow/dependencyAnalysisStage.test.ts"
Task: "Unit test for workflowReviewStage.ts in backend/tests/unit/testGenerationWorkflow/workflowReviewStage.test.ts"
Task: "Unit test for postmanGenerationStage.ts in backend/tests/unit/testGenerationWorkflow/postmanGenerationStage.test.ts"

# Then, once the client exists, launch all frontend stage components together:
Task: "Implement ApiReviewStage.tsx in frontend/src/components/ApiReviewStage.tsx"
Task: "Implement AiEnhancementStage.tsx in frontend/src/components/AiEnhancementStage.tsx"
Task: "Implement ScenarioReviewStage.tsx in frontend/src/components/ScenarioReviewStage.tsx"
Task: "Implement WorkflowReviewStage.tsx in frontend/src/components/WorkflowReviewStage.tsx"
Task: "Implement PostmanGenerationStage.tsx in frontend/src/components/PostmanGenerationStage.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — stage gating and the store block everything
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: walk the full guided path against the representative fixture end to end in the browser; confirm the downloaded collection traces to approved scenarios
5. Demo the guided upload-to-Postman journey

### Incremental Delivery

1. Setup + Foundational → stage gating and store ready
2. Add US1 → full guided happy path, minimal progress indicator (MVP)
3. Add US2 → rich, resumable progress visibility
4. Add US3 → safe revision handling via the staleness cascade
5. Add US4 → graceful, recoverable AI unavailability

---

## Notes

- [P] tasks = different files, no dependencies
- Every task in Phases 3–6 carries its story label for traceability
- No new dependency is introduced anywhere in this feature (plan.md Technical Context) — no router, no database, no session store
- `SpecificationUploadPage.tsx` and `TestScenarioReviewPage.tsx` are removed in US1 (T038) as superseded orchestration, per research.md D10; their presentational children are reused unmodified
- `PostmanExportPanel.tsx` and every pre-existing stateless `/api/test-models*`/`/api/api-models/dependencies` endpoint are left completely unchanged and keep their own existing tests (research.md D9)
- Approved integration workflows are never rendered into the Postman artifact in this feature (research.md D2, T019/T027) — that rendering remains unimplemented pending a future feature
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
