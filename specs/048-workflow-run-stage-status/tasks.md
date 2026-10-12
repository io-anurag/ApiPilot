---

description: "Task list for Guided Workflow Run Stage Status"
---

# Tasks: Guided Workflow Run Stage Status

**Input**: Design documents from `/specs/048-workflow-run-stage-status/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/changes-to-existing-apis.md](contracts/changes-to-existing-apis.md), [quickstart.md](quickstart.md)

**Tests**: Included. The repository treats tests as part of every feature, and the plan lists them. The AI provider is not involved, so no mock provider is needed.

**Organization**: Grouped by user story. US1 (Execution) and US2 (Performance Testing) each deliver a visible stage change on their own; US3 (freshness) makes either change appear in the hidden guided workflow without a reload.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1, US2 or US3; none for Setup, Foundational and Polish
- Paths are from the repository root. Constitution: no run content is copied into the workflow (FR-015); a failed stage update is logged and never fails the run (research D6).

---

## Phase 1: Setup

- [ ] T001 Confirm the starting point: run `npx vitest run backend/tests/unit/testGenerationWorkflow frontend/tests/unit/TestGenerationWorkflowPage.test.tsx frontend/tests/unit/ExternalCollectionUpload.test.tsx` and note any failure that exists before this feature, so later results can be compared (spec SC-006).

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the pure completion rules, the one new stage transition, and the failure-safe applier that both run paths call.

- [ ] T002 [P] Add `not-yet-reached -> complete` for `performanceTesting` only to `isValidTransition` in `backend/src/testGenerationWorkflow/workflowStore.ts`, as a per-stage set beside `EXECUTION_ONLY_TRANSITIONS`, with a comment citing specs/048 research D4. Leave every other transition unchanged.
- [ ] T003 [P] Write failing unit tests for the two rules in `backend/tests/unit/testGenerationWorkflow/runCompletion.test.ts`, one test per row of the tables in [data-model.md](data-model.md): execution (status not `completed`, no or different `sourceWorkflowId`, `active`, and each non-active status) and performance (`in-progress`, `null` and `collection` seeds, workflow seed with the same and a different title, specification seed with the same and a different filename, Postman Generation not complete, already complete, `not-yet-reached`, `active`). Include an idempotence case: applying the rule twice changes `completedAt` once.
- [ ] T004 Create `backend/src/testGenerationWorkflow/runCompletion.ts` exporting two pure functions, `shouldCompleteExecution(workflow, upload, runStatus)` and `shouldCompletePerformance(workflow, runStatus, seedSource)`, returning a boolean, so T003 passes. No store access in these functions.
- [ ] T005 In `backend/src/testGenerationWorkflow/runCompletion.ts` add the appliers `completeExecutionForUpload(uploadSourceWorkflowId, runStatus)` and `completePerformanceForRun(sessionId, runStatus, seedSource)`. Each reads the session's current workflow, evaluates the rule, calls `updateStage(stage, "complete")` when it returns true, and logs `stage_complete` with stage, workflow id and outcome. The performance applier runs inside `runWithSession(sessionId, …)`. Wrap the update in try/catch that logs `stage_update_failed` (stage, workflow id, error category) and returns, never throwing (research D6).
- [ ] T006 [P] Add tests for the appliers in `backend/tests/unit/testGenerationWorkflow/runCompletion.test.ts`: no current workflow does nothing and does not throw; a store error is logged and not rethrown; a session with no request context works for the performance applier.

**Checkpoint**: the rules and appliers exist and are tested; no run path calls them yet.

---

## Phase 3: User Story 1 — Execution shows Complete once the generated collection has been run (Priority: P1)

**Goal**: a completed run of an upload made through Continue to Import & Run completes Execution.

**Independent Test**: generate a collection in a guided workflow, continue to Import & Run, submit the pre-filled upload, run it to completion, then read the workflow: Execution is Complete. A cancelled run, an unrelated upload and a hand-picked copy leave it Active.

### Tests for User Story 1

- [ ] T007 [P] [US1] Add a failing integration test in `backend/tests/integration/externalCollections/workflowLink.test.ts`: `POST /api/external-collections` with a valid `workflowId` returns `201` without `sourceWorkflowId` in the body; with a malformed one returns `400 invalid_request` and creates nothing; without it behaves as before.
- [ ] T008 [P] [US1] Add a failing integration test in `backend/tests/integration/workflowRunStageStatus.test.ts` that drives a workflow to Postman Generation, uploads with that workflow's id, starts and settles a run as `completed`, and expects `execution` `complete`. Add cases for a `cancelled` run, a run that stopped on an error (recorded as `completed`, so it completes), an upload without `workflowId`, an upload with another workflow's id, a skipped Execution (stays `skipped`), a second run (completion time unchanged), the upload deleted while its run is in progress (still completes), and a discarded workflow (no error, new workflow unchanged). Also assert FR-015 and FR-013: after a qualifying run the workflow differs from before only in the stage status, `completedAt` and `updatedAt`, and repeating the same sequence of uploads and runs in a fresh session gives the same stage statuses.
- [ ] T009 [P] [US1] Extend `frontend/tests/unit/ExternalCollectionUpload.test.tsx`: with a preload carrying a workflow id and both files untouched, submit sends `workflowId`; replacing either file, or no preload, sends none.

### Implementation for User Story 1

- [ ] T010 [P] [US1] Add `sourceWorkflowId?: string` to `UploadedCollectionSet` in `packages/shared-domain/src/externalCollections.ts` and confirm it is excluded from `UploadedCollectionSummary`.
- [ ] T011 [US1] Add a nullable `source_workflow_id` column to `uploaded_collections` through the existing `addColumn` helper in `backend/src/persistence/connection.ts`, and read and write it in `backend/src/persistence/uploadedCollectionRepository.ts` (rows from before the column read as absent).
- [ ] T012 [US1] Carry `sourceWorkflowId` through `createUploadedCollection` in `backend/src/externalCollections/uploadedCollectionStore.ts`.
- [ ] T013 [US1] In `backend/src/api/externalCollections.ts` read the optional `workflowId` text field of `POST /external-collections`, validate it against `^wf-\d+-\d+$` (`400 invalid_request` otherwise), pass it to the store, and leave `toSummary` unchanged. Keep the handler thin: validation only.
- [ ] T014 [US1] In the start handler in `backend/src/api/externalCollections.ts`, pass the uploaded collection's `sourceWorkflowId` as an in-memory argument to `runUploadedCollectionExecution` in `backend/src/externalCollections/runUploadedCollectionExecution.ts` (do not add it to the persisted run snapshot). Where that function settles a run as `completed` (the normal end and the error path, both via `settleRun` in `uploadedCollectionExecutionStore.ts`), call `completeExecutionForUpload` from `backend/src/testGenerationWorkflow/runCompletion.ts` with that value. Do nothing for `cancelled`. The run's return value and record must not depend on the call.
- [ ] T015 [P] [US1] Add `workflowId` to `ImportPreload` and `toImportPreload` in `frontend/src/services/importPreload.ts`, and search `toImportPreload` for every caller (today `handleHandoffToExecution` in `frontend/src/App.tsx`, which receives the artifact and spec title from `TestGenerationWorkflowPage`'s `onHandoffToExecution`; extend that callback to carry the workflow id) and pass the id at each.
- [ ] T016 [US1] Add an optional `workflowId` to `createUploadedCollection` in `frontend/src/services/externalCollectionsClient.ts`, appended to the FormData only when given.
- [ ] T017 [US1] In `frontend/src/components/ExternalCollectionUpload.tsx`, send the preload's `workflowId` only when the selected collection and environment files are the preload's own `File` objects (compare by identity), and send nothing otherwise.
- [ ] T018 [US1] Run the T007 to T009 tests and `backend/tests/unit/testGenerationWorkflow/runCompletion.test.ts`; fix until they pass.

**Checkpoint**: Execution completes for a linked completed run; US1 is shippable alone (the tracker shows it after a reload or a new session read).

---

## Phase 4: User Story 2 — Performance Testing shows Complete once a run from this workflow has finished (Priority: P2)

**Goal**: any final state of a request-chain run seeded from this workflow's specification completes Performance Testing.

**Independent Test**: with Postman Generation complete, run a plan seeded from the Guided workflow (or from the same specification) to any final state, then read the workflow: Performance Testing is Complete. A plan from another specification, a collection plan and a plan built from nothing change nothing.

### Tests for User Story 2

- [ ] T019 [P] [US2] Add failing cases to a new `backend/tests/integration/workflowPerformanceStageStatus.test.ts` (kept separate from T008's file so US1 and US2 can proceed in parallel): settling a chain run seeded from `workflow` (same title) completes `performanceTesting`; the same for a `specification` seed with the workflow's `specificationFilename`; `completed`, `failed` and `cancelled` each count and `in-progress` does not; a different title or filename, a `collection` seed and a `null` seed do not; Postman Generation not complete does not; a second run leaves the completion time unchanged.
- [ ] T020 [P] [US2] Add a unit test in `backend/tests/unit/performance/runPerformanceTest.test.ts` (extend the existing file if present, else create it) that `startPerformanceRun`'s settle calls the applier for a final status and not for `in-progress`, and that an applier error does not change the run's settled status.

### Implementation for User Story 2

- [ ] T021 [US2] In `backend/src/performance/runPerformanceTest.ts`, in the `settle` closure of `startPerformanceRun`, after `repository.settle`, call `completePerformanceForRun(sessionId, settled.status, run.planSource === "chain" ? run.snapshot.seedSource : null)` when the status is not `in-progress`. Legacy runs pass `null` and so never match (plan, Risks).
- [ ] T022 [US2] Run the T019 and T020 tests and the existing performance run tests (`npx vitest run backend/tests/unit/performance backend/tests/integration/performance`); fix until they pass, with no existing expectation changed (SC-006).

**Checkpoint**: both stages complete from the backend; US1 and US2 work independently.

---

## Phase 5: User Story 3 — Status updates appear wherever the engineer is looking (Priority: P2)

**Goal**: the guided workflow page, mounted but hidden, shows the new status when the engineer returns and within 5 seconds while it is on screen.

**Independent Test**: finish a run while the guided workflow tab is hidden, switch to it without reloading, and read the tracker, the stage chips and the Execute group count; then finish a run from a second tab while the first is on screen and see it update.

### Tests for User Story 3

- [ ] T023 [P] [US3] Extend `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx` with fake timers and a mocked `fetchCurrentWorkflow`: when `isVisible` turns true the page refetches and shows an Execution that is now Complete; with `isVisible` false, or the browser tab hidden, it does not fetch; while visible and waiting it refetches every 5 seconds and stops once Execution is complete or skipped and Performance Testing is complete; a `null` or failed fetch leaves the screen unchanged; the tracker, chips, step counter and Execute group summary agree (FR-012).

### Implementation for User Story 3

- [ ] T024 [US3] Add an `isVisible` prop to `TestGenerationWorkflowPage` in `frontend/src/pages/TestGenerationWorkflowPage.tsx`. When it turns true, call `fetchCurrentWorkflow` and replace the page's workflow when `updatedAt` differs. While visible and the browser tab is not hidden (`document.visibilityState`), with `postmanGeneration` complete, repeat every 5 seconds until `execution` is `complete` or `skipped` and `performanceTesting` is `complete`; clear the interval on hide, on that condition, and on unmount. Performance Testing is optional, so a workflow that never runs it keeps this slow poll only while its page is on screen. Keep the polling in a small hook file under `frontend/src/hooks/` if the page grows past its current structure.
- [ ] T025 [US3] In `frontend/src/App.tsx` pass `isVisible={started && activeTab === "guided-workflow"}` to `TestGenerationWorkflowPage`.
- [ ] T026 [US3] Run the T023 tests and the existing page and tracker tests (`npx vitest run frontend/tests/unit/TestGenerationWorkflowPage.test.tsx frontend/tests/unit/WorkflowStageTracker.test.tsx`); fix until they pass.

**Checkpoint**: all three stories work together; the quickstart manual steps 1 to 8 can be followed.

---

## Phase 6: Polish and Cross-Cutting

- [ ] T027 [P] Amend `specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md` and `data-model.md` (stage model: the new `performanceTesting` transition and the run-completion rules), and `specs/026-external-collection-execution/contracts/external-collections-api.md` (the `workflowId` field), pointing to specs/048.
- [ ] T028 [P] Update `docs/USER_MANUAL.md` (Execute stages: when Execution and Performance Testing show Complete, and that a hand-picked copy of the collection does not count) and `docs/architecture.md` (the settle-time hooks and the visibility refetch).
- [ ] T029 Run the full validation: `npm test`, `npm run lint`, `npm run build`. Record the results honestly, including anything not run.
- [ ] T030 Walk the manual steps in [quickstart.md](quickstart.md) in a browser if one can be driven; otherwise record that they were not exercised.
- [ ] T031 Add the ROADMAP entry for AP-048 in `specs/ROADMAP.md` and bump the version with `npm run version:bump -- feature` (updates root, backend, frontend and shared-domain together). Leave every change uncommitted for review.

---

## Dependencies and Order

- Phase 2 blocks everything. T002 and T003 are parallel; T004 needs T003; T005 needs T004; T006 needs T005.
- US1 needs Phase 2. Within US1: T007 to T009 first (they fail until implemented), then T010 → T011 → T012 → T013 (backend upload chain), T014 after T005 and T012, T015 to T017 (frontend) after T013's contract is fixed. T015 and T010 are independent.
- US2 needs Phase 2 only and does not depend on US1; T021 needs T005.
- US3 needs only the page and App; it can be built in parallel with US1 and US2, and is verified once either has landed.
- Polish needs all stories.

## Parallel Opportunities

- T002 with T003; T006 with nothing blocking after T005.
- T007, T008, T009 together; T010 with T015; T019 with T020; T023 with any backend task.
- US1, US2 and US3 can be worked by different people after Phase 2.

## Implementation Strategy

- **MVP**: Phase 1, Phase 2 and US1. It fixes the reported Execution status for real runs; a reload or a refetch shows it.
- **Next**: US3, so the status appears without a reload (the other half of the original complaint), then US2.
- Each phase ends at a checkpoint where the relevant tests pass and nothing outside this feature's tests has changed.
