---

description: "Task list template for feature implementation"
---

# Tasks: Test Execution & Results

**Input**: Design documents from `specs/018-test-execution-results/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/execution-api.md,
quickstart.md (all present)

**Tests**: Included as required tasks, not optional — this repository's constitution (XXI,
Testability at Every Boundary) and `.claude/CLAUDE.md` §51-53 treat tests as part of every
feature, not an afterthought.

**Organization**: Tasks are grouped by user story (spec.md priorities P1-P5) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Every task names its exact file path

## Path Conventions

Web application layout already established by this repository: `backend/src/`, `backend/tests/`,
`frontend/src/`, `packages/shared-domain/src/` (see plan.md's Project Structure).

---

## Phase 1: Setup

**Purpose**: Bring in the one new dependency and the shared domain types every later task needs.

- [X] T001 Add `newman` to `backend/package.json` dependencies (research.md D1); run `npm install`
      and confirm it resolves cleanly alongside the existing workspace dependencies.
- [X] T002 Create `packages/shared-domain/src/execution.ts` with `EnvironmentTier`,
      `Environment`, `ExecutionRunStatus`, `NotAttemptedReason`, `FailureCategory`,
      `AssertionOutcome`, `RequestResult`, `ExecutionRunSummary`, `ExecutionRun`, and
      `ExecutionConfirmationRequirement`, exactly per data-model.md; add
      `export * from "./execution"` to `packages/shared-domain/src/index.ts`.
- [X] T003 [P] Create the local target-server test fixture `backend/tests/fixtures/execution/
      targetServer.ts` — a small Express app exposing a handful of routes that can be configured
      per-test to return specific status codes/bodies, be slow (to exercise timeout), or be
      unreachable (by not starting it) — used by every integration test below so none require
      real external network access (constitution XXI).
- [X] T004 [P] Scaffold `backend/src/execution/errors.ts` with `EnvironmentNotFoundError`,
      `DuplicateEnvironmentNameError`, `MissingVariableValuesError`, `ConfirmationRequiredError`,
      `ExecutionInProgressError`, `NoRunInProgressError`, and `RunNotFoundError` (typed errors,
      mirroring the existing convention in `backend/src/testGenerationWorkflow/errors.ts`).

**Checkpoint**: Domain types and error vocabulary exist; nothing is wired up yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Environment definition/storage is needed by every user story from US1 onward.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Implement `backend/src/execution/environmentStore.ts` — session-scoped CRUD
      (`AsyncLocalStorage`-keyed `Map`, mirroring `backend/src/testGenerationWorkflow/
      workflowStore.ts`'s existing pattern per research.md D3): `listEnvironments()`,
      `createEnvironment(input)`, `updateEnvironment(id, input)`, `getEnvironment(id)`. Enforces
      unique `name` per session (throws `DuplicateEnvironmentNameError`).
- [X] T006 [P] Unit tests for `environmentStore.ts` in `backend/tests/unit/execution/
      environmentStore.test.ts`: create/list/update, duplicate-name rejection, and session
      isolation (two session contexts never see each other's environments — reuse the existing
      `sessionContext.enterTestSession` test helper from `specs/017-session-workflow-isolation`).
- [X] T007 Add `GET /api/test-generation-workflow/environments`, `POST .../environments`, and
      `PUT .../environments/:environmentId` to `backend/src/api/testGenerationWorkflow.ts`, per
      contracts/execution-api.md's request/response/error shapes exactly (400 `invalid_request`,
      409 `duplicate_environment_name`, 404 `environment_not_found`).
- [X] T008 [P] Integration tests for the environments routes in `backend/tests/integration/
      execution/environments.test.ts` (Supertest): create, list, update, duplicate-name 409,
      not-found 404, invalid-body 400.
- [X] T009 Implement `backend/src/execution/executionRunStore.ts` — session-scoped run history
      (`createRun`, `getRun(id)`, `listRuns()`, `appendResult(runId, result)`,
      `settleRun(runId, status)`, `getInProgressRun()`), same keying pattern as T005.
- [X] T010 [P] Unit tests for `executionRunStore.ts` in `backend/tests/unit/execution/
      executionRunStore.test.ts`: create/append/settle/list, and that only one run can be
      "in-progress" at a time per session.

**Checkpoint**: Environments can be defined, listed, and updated; run storage exists and is
ready to hold results. Nothing executes a request yet.

---

## Phase 3: User Story 1 - Run an Approved Test Suite Against a Chosen Environment (Priority: P1) 🎯 MVP

**Goal**: Start a run against a selected environment, execute every approved scenario's request
strictly in order, and see a clear pass/fail summary plus per-request outcomes, with
connectivity failures reported as their own category.

**Independent Test**: Take an approved collection and one environment (a bare `baseUrl` is
enough), start execution, and confirm a single clear execution summary is produced once it
completes.

### Tests for User Story 1

- [X] T011 [P] [US1] Unit tests for `mapNewmanResult.ts` in `backend/tests/unit/execution/
      mapNewmanResult.test.ts`, against constructed (not real-Newman) result shapes covering
      every `FailureCategory`: passed, `assertion-failed` (status-code and schema-conformance
      test names both), `unexpected-status`, `connectivity-failure`, `timeout`,
      `could-not-evaluate` (research.md D5).
- [X] T012 [P] [US1] Integration test in `backend/tests/integration/execution/
      executionRuns.test.ts`: full run against `targetServer.ts` with a mix of scenarios that
      pass and fail; poll `GET .../execution/runs/:runId` until `status: "completed"` and assert
      the summary counts match `results.length` and each result names its own operation.
- [X] T013 [P] [US1] Integration test in the same file: `targetServer.ts` not started (or
      stopped) for the run's environment; assert every result is `outcome: "failed"`,
      `failureCategory: "connectivity-failure"` — never `assertion-failed`.

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement `backend/src/execution/mapNewmanResult.ts` (research.md D5):
      given one Newman single-item run result, produce a `RequestResult` (outcome, category,
      duration, response status code, `AssertionOutcome[]`), matching on the stable `pm.test`
      names `backend/src/postman/assertionScripts.ts` already gives each assertion.
- [X] T015 [P] [US1] Implement `backend/src/execution/newmanRunner.ts`: given one Postman
      collection item (with its embedded scripts) plus the accumulated collection-variable state
      from prior items in the same run, invoke Newman's Node API for just that one item and
      return its raw per-item result plus the updated variable state.
- [X] T016 [US1] Implement `backend/src/execution/runExecution.ts` (depends on T014, T015): the
      orchestration loop — calls `generateCollection()` with the selected environment's
      `baseUrl`/`variableValues` to obtain a live artifact, reuses `backend/src/postman/
      workflowRendering.ts`'s `planApprovedWorkflows()` for item order (research.md D2), and for
      each item in turn invokes `newmanRunner`, maps the result via `mapNewmanResult`, and
      appends it to the run via `executionRunStore.appendResult`. Requests execute strictly one
      at a time (FR-010); the run settles `completed` once every item has an outcome.
- [X] T017 [US1] Wire `POST /api/test-generation-workflow/execution/start` into
      `testGenerationWorkflow.ts` (depends on T016): validates `postmanGeneration` is complete
      (409 `stage_not_active`) and the approved TestModel is non-empty (409
      `empty_approved_test_model`), creates the run via `executionRunStore.createRun`, kicks off
      `runExecution.ts` without awaiting its completion, and returns the newly-created
      `in-progress` run immediately (research.md D4 — never block the response on the whole run).
- [X] T018 [US1] Wire `GET /api/test-generation-workflow/execution/runs/:runId` into
      `testGenerationWorkflow.ts` (404 `run_not_found`), returning the run's current state
      (growing `results` while in progress, per FR-013/FR-014).
- [X] T019 [US1] Frontend: `frontend/src/services/executionClient.ts` calling
      `execution/start` and `execution/runs/:runId`.
- [X] T020 [US1] Frontend: minimal execution trigger and results view — a "Run" action and a new
      `frontend/src/components/ExecutionResultsPanel.tsx` rendering the summary and per-request
      list, visibly distinguishing in-progress from completed (FR-013), wired into
      `frontend/src/pages/TestGenerationWorkflowPage.tsx`.

**Checkpoint**: A QA engineer can run an approved collection against one environment and see
clear pass/fail results. This is independently demoable.

---

## Phase 4: User Story 2 - Configure and Select the Right Target Environment (Priority: P2)

**Goal**: Require explicit environment selection, validate completeness before starting, and
make the environment's risk tier visible.

**Independent Test**: Define two environments with different base URLs, run the same collection
against each, and confirm requests reached the URL configured for whichever was selected.

### Tests for User Story 2

- [X] T021 [P] [US2] Integration test: two environments with distinct `baseUrl`s against
      `targetServer.ts` instances on different ports; confirm each run's requests reached the
      port configured for the environment that run selected (quickstart Scenario 2).
- [X] T022 [P] [US2] Integration test: an environment missing a variable the approved collection
      declares; `POST .../execution/start` against it returns `400 missing_variable_values`
      naming the specific missing variable(s), and no request is sent (confirm
      `targetServer.ts` recorded zero requests).
- [X] T023 [P] [US2] Unit tests for the variable-completeness check (module introduced by T024)
      in `backend/tests/unit/execution/variableCompleteness.test.ts`.

### Implementation for User Story 2

- [X] T024 [US2] Add variable-completeness validation to the `execution/start` route (FR-004):
      before creating a run, compute the approved collection's declared variables (reuse
      `generateCollection()`'s existing declared-variable computation rather than re-deriving
      it) and compare against the selected environment's `variableValues`; refuse with `400
      missing_variable_values` and the specific missing names if any are absent.
- [X] T025 [US2] Enforce `duplicate_environment_name` at both `POST` and `PUT .../environments`
      (T007 already covers `POST`; extend `PUT` the same way if not already handled there).
- [X] T026 [US2] Frontend: environment selection control in `EnvironmentForm.tsx` /
      `TestGenerationWorkflowPage.tsx` requiring an explicit choice whenever more than one
      environment exists (no silent default, FR-003) and visibly labeling the selected
      environment's tier before and during a run (FR-002).

**Checkpoint**: Environment selection is explicit, validated, and tier-visible.

---

## Phase 5: User Story 3 - Diagnose a Failed Run Without Wading Through Noise (Priority: P3)

**Goal**: Make individual failures immediately understandable — which assertion, why, and what
the API actually returned — without exposing sensitive values, and let an engineer jump straight
to the failures in a large run.

**Independent Test**: Run a collection against a target producing at least one assertion failure
and one unexpected-status-code failure; confirm the two are distinguishable and the specific
failing assertion is visible.

### Tests for User Story 3

- [X] T027 [P] [US3] Unit test (extend `mapNewmanResult.test.ts`): a scenario whose request or
      response carries a header/body value the platform already treats as sensitive never
      appears in the resulting `RequestResult`/`AssertionOutcome.detail` (FR-017).
- [X] T028 [P] [US3] Integration test: a run whose results include both an `assertion-failed`
      (schema-conformance) and an `unexpected-status` outcome; confirm the response distinguishes
      them and names the specific failing assertion for the former.

### Implementation for User Story 3

- [X] T029 [US3] Audit `mapNewmanResult.ts` (from Phase 3) against `backend/src/testDesign/
      sensitiveValueDetection.ts`'s existing rules and redact any matching value before it is
      ever placed into `AssertionOutcome.detail` or logged (FR-017) — reuse that existing
      detection rather than inventing a second one; this is a hardening pass on already-shipped
      Phase 3 code, not new orchestration logic.
- [X] T030 [US3] Frontend: failure-only filter control in `ExecutionResultsPanel.tsx` (FR-021 —
      client-side filtering over the already-returned full result list per contracts/
      execution-api.md; no new server endpoint).
- [X] T031 [US3] Frontend: per-request diagnostic detail view in `ExecutionResultsPanel.tsx` —
      failure category, the specific assertion(s) evaluated and their outcome, duration, and
      operation identifier, reusing this project's existing status/severity presentation
      conventions (`.claude/CLAUDE.md` §26-43) rather than introducing new visual patterns.

**Checkpoint**: Failures are self-explanatory and safe to look at; large runs are navigable.

---

## Phase 6: User Story 4 - Be Stopped From Accidentally Running Destructive Requests Unattended (Priority: P4)

**Goal**: Require an explicit confirmation step for Staging/Production or destructive-request
runs, prevent two concurrent runs, and support cancelling an in-progress run safely.

**Independent Test**: Attempt to execute a collection with a destructive request against a
Staging/Production-tagged environment; confirm the run does not proceed without an explicit,
distinct confirmation beyond the ordinary start action.

### Tests for User Story 4

- [X] T032 [P] [US4] Integration test: starting a run against a `staging`-tagged environment (or
      one containing a destructive request) without `confirmed: true` returns `409
      confirmation_required` naming the tier and destructive operations, and no request is sent;
      resubmitting with `confirmed: true` proceeds (quickstart Scenario 3).
- [X] T033 [P] [US4] Integration test: a second `POST .../execution/start` while one run is
      `in-progress` returns `409 execution_in_progress` naming the already-running run, and does
      not start a second run.
- [X] T034 [P] [US4] Integration test: cancel a run mid-flight (against a `targetServer.ts`
      configured with a deliberate per-request delay so the timing is controllable); confirm the
      already-dispatched request completes with its real outcome, every remaining request is
      `not-attempted`/`"cancelled"`, and the run settles `status: "cancelled"` (quickstart
      Scenario 4).
- [X] T035 [P] [US4] Unit tests for `destructiveOperations.ts` (module introduced by T036) in
      `backend/tests/unit/execution/destructiveOperations.test.ts`.

### Implementation for User Story 4

- [X] T036 [P] [US4] Implement `backend/src/execution/destructiveOperations.ts`: given the
      approved `ApiModel`'s operations, return every operation whose method is `POST`/`PUT`/
      `PATCH`/`DELETE` (spec.md Assumptions — HTTP-method heuristic for v1); given an
      `Environment`, produce an `ExecutionConfirmationRequirement` when its tier is `staging`/
      `production` or the destructive-operation list is non-empty.
- [X] T037 [US4] Wire the `confirmation_required` 409 + `confirmed` request-body handling into
      `execution/start` (depends on T036): skip straight to run creation when no confirmation is
      required or `confirmed === true`; otherwise refuse with the computed requirement.
- [X] T038 [US4] Add the `execution_in_progress` 409 guard to `execution/start`, using
      `executionRunStore.getInProgressRun()` (FR-008).
- [X] T039 [US4] Add a cancellation flag to `ExecutionRun`/`executionRunStore` and check it in
      `runExecution.ts`'s loop immediately before starting each item (research.md D6): once set,
      let any already-dispatched item finish, then mark every remaining item `not-attempted`/
      `"cancelled"` and settle the run as `cancelled` (FR-015).
- [X] T040 [US4] Wire `POST /api/test-generation-workflow/execution/cancel` (202, mirroring the
      existing `ai-enhancement/cancel` convention; 409 `no_run_in_progress` if none is active).
- [X] T041 [US4] Frontend: confirmation step UI naming the environment and destructive
      operations, required before the start action proceeds for Staging/Production or
      destructive collections (FR-007).
- [X] T042 [US4] Frontend: cancel action and in-progress/cancelled state display in
      `ExecutionResultsPanel.tsx`.

**Checkpoint**: Destructive/Production runs require deliberate confirmation; only one run is
ever in progress at a time; a run in progress can be safely stopped.

---

## Phase 7: User Story 5 - Come Back Later and Still See What Happened (Priority: P5)

**Goal**: Let a completed or in-progress run's results be retrieved again later in the same
session without re-running anything, with every run individually distinguishable.

**Independent Test**: Complete a run, navigate away, and confirm its summary and per-request
results are still retrievable afterward.

### Tests for User Story 5

- [X] T043 [P] [US5] Integration test: complete two runs (different environments), then `GET
      .../execution/runs` lists both with distinct ids/summaries, and `GET .../execution/runs/
      :runId` for the earlier one still returns its unchanged full results (quickstart
      Scenario 5).

### Implementation for User Story 5

- [X] T044 [US5] Wire `GET /api/test-generation-workflow/execution/runs` (summaries only, newest
      first, per contracts/execution-api.md) using `executionRunStore.listRuns()`.
- [X] T045 [US5] Frontend: run history list view; selecting a past run renders it through the
      existing `ExecutionResultsPanel.tsx` (no separate results UI needed).

**Checkpoint**: All five user stories are independently functional.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [X] T046 [P] Run `npm test`, `npm run lint`, and `npm run build` across all workspaces; fix
      any failures before considering the feature done.
- [X] T047 [P] Accessibility/responsive/dark-mode pass over `EnvironmentForm.tsx` and
      `ExecutionResultsPanel.tsx` (constitution XXXIII; `.claude/CLAUDE.md` §26-43).
- [X] T048 Walk through every scenario in `quickstart.md` manually against a real local dev
      server and record the outcome.
- [X] T049 Update `specs/ROADMAP.md`'s Implementation Status table to record AP-017's
      implementation status once the above is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — blocks every user story.
- **User Story 1 (Phase 3)**: Depends on Phase 2 only. This is the MVP slice.
- **User Story 2 (Phase 4)**: Depends on Phase 2; its integration tests (T021/T022) additionally
  depend on User Story 1's execution engine (T016-T018) already existing, per this feature's own
  User-Story priority ordering (spec.md) — its own new code (validation, selection UI) is
  otherwise self-contained.
- **User Story 3 (Phase 5)**: Depends on Phase 2 and the `mapNewmanResult`/`ExecutionResultsPanel`
  building blocks Phase 3 already created (it hardens and extends them, per T029-T031).
- **User Story 4 (Phase 6)**: Depends on Phase 2 and Phase 3's `execution/start` route and
  `runExecution.ts` loop, which it extends with the confirmation/concurrency/cancellation checks.
- **User Story 5 (Phase 7)**: Depends on Phase 2's `executionRunStore` and Phase 3's runs already
  being created — purely additive (a new list endpoint + a history view).
- **Polish (Final Phase)**: Depends on every user story phase intended for this delivery.

### Within Each User Story

- Tests are listed, and should be written, before the implementation task(s) they cover.
- Domain/store logic before routes; routes before frontend wiring.

### Parallel Opportunities

- All Phase 1 `[P]` tasks (T003, T004) run in parallel once T001/T002 land.
- Phase 2: T006 parallel with T007/T008 (different files); T010 parallel with T009's own tests.
- Phase 3: T011, T012, T013 (tests) and T014, T015 (implementation) are each internally `[P]`
  (different files); T016 depends on T014+T015; T017/T018 depend on T016; T019 (frontend client)
  can start as soon as contracts/execution-api.md is stable (immediately) rather than waiting on
  the backend implementation, since it only needs the documented shapes.
- Phase 4: T021/T022/T023 (`[P]`) can be written alongside T024's implementation once the
  contract is fixed.
- Phase 6: T032-T035 (`[P]`) are independent of each other; T036 is independent of T038/T039/T040
  until T037 needs T036's output.

---

## Parallel Example: User Story 1

```bash
# Launch in parallel once Phase 2 is complete:
Task: "Unit tests for mapNewmanResult.ts in backend/tests/unit/execution/mapNewmanResult.test.ts"
Task: "Implement mapNewmanResult.ts in backend/src/execution/mapNewmanResult.ts"
Task: "Implement newmanRunner.ts in backend/src/execution/newmanRunner.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1).
3. **STOP and VALIDATE**: run quickstart.md Scenario 1 manually against a real local target.
4. Demo: a QA engineer can define one environment, run an approved collection, and see pass/fail
   results with connectivity failures correctly distinguished from assertion failures.

### Incremental Delivery

1. Setup + Foundational → environments can be configured.
2. + User Story 1 → core execution and results (MVP).
3. + User Story 2 → safe, explicit, validated environment selection.
4. + User Story 3 → results are diagnosable, not just pass/fail counts.
5. + User Story 4 → destructive/Production runs require deliberate confirmation; runs are
   cancellable.
6. + User Story 5 → nothing is lost when you look away.

Each increment is independently demoable per its own "Independent Test" above, without breaking
any increment that shipped before it.
