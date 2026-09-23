---

description: "Task list for Test Execution Gap Closure (AP-030)"
---

# Tasks: Test Execution Gap Closure

**Input**: Design documents from `specs/029-execution-gap-closure/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/execution-api-delta.md, quickstart.md (all present)

**Tests**: Required, not optional. This repository's constitution (XXI, Testability at Every
Boundary) and `.claude/CLAUDE.md` §51–53 treat tests as part of every feature. research.md D8
names each test location.

**Organization**: Tasks are grouped by user story (spec.md P1–P3), so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1–US3)
- Every task names its exact file path

## Path Conventions

This follows the repository's existing web-application layout: `backend/src/`, `backend/tests/`,
and `packages/shared-domain/src/`. No `frontend/` file changes (spec.md FR-016).

---

## Phase 1: Setup

**Purpose**: Record the starting state so SC-006 ("existing tests pass unchanged") can be checked
against it.

- [ ] T001 Run `npm test -w backend` and `npm run build` from the repository root and record the
      pass/skip counts in this task's completion note. The expected baseline is the last recorded
      full-suite result in `specs/ROADMAP.md` Next Actions #23: 1392 passed, 2 skipped. Any failure
      that already exists is reported, not fixed, under this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared result vocabulary used by User Story 1 (unmet dependencies) and User
Story 2 (processing stage).

**⚠️ CRITICAL**: US1 and US2 cannot start until this phase is done. US3 does not depend on it.

- [ ] T002 In `packages/shared-domain/src/execution.ts`, add
      `export type RequestProcessingStage = "not-sent" | "no-response" | "response-received";`
      and `export interface UnmetDependency { scenarioId: string; operationPath: string;
      operationMethod: string; }`. Add two optional fields to `RequestResult`:
      `processingStage?: RequestProcessingStage` and `unmetDependencies?: UnmetDependency[]`.
      Give each a doc comment stating the rule from data-model.md (when it is present, and that
      it is absent on results stored before specs/029). Change no existing member. Confirm
      `packages/shared-domain/src/index.ts` already re-exports `./execution`, so no index change is
      needed. Run `npm run build -w packages/shared-domain`.

**Checkpoint**: The shared types compile. No behavior has changed yet.

---

## Phase 3: User Story 1 - Dependent Requests Are Not Sent After Their Prerequisite Fails (Priority: P1) 🎯 MVP

**Goal**: A request is not sent when an earlier request it takes a data value from, in an
approved workflow (AP-016) or automatic chain (AP-019), has a blocking outcome (spec.md FR-001).
It is recorded as `not-attempted` / `"dependency-not-met"` with `unmetDependencies`.
Credential hand-offs (AP-023) and OAuth2 token fetches (specs/024) are unaffected.

**Independent Test**: Run an approved two-step workflow against `TargetServer` with the first
step returning an unexpected status. The target receives no request for the second step, and the
second step's result names the first as its unmet dependency (spec.md User Story 1).

### Tests for User Story 1

- [ ] T003 [P] [US1] Create `backend/tests/unit/postman/executionDependencies.test.ts` for
      `generateExecutableCollection()` (research.md D1/D2). Build hand-made `ApiModel`/`TestModel`/
      `WorkflowExportContext` inputs the way `backend/tests/unit/postman/workflowRendering.test.ts`
      and `automaticChaining.test.ts` already do, and assert:
      (a) an approved two-step workflow maps the consumer step's item id
      (`itemIdForWorkflowStep`) to the producer step's item id;
      (b) a path-parameter automatic chain maps the consumer's `itemIdForScenario` id to the
      producer's;
      (c) an auth-credential chain (specs/023) adds no entry;
      (d) an OAuth2 token-fetch item (specs/024) appears in no entry, as key or value;
      (e) `generateExecutableCollection(...).result` deep-equals `generateCollection(...).result`
      for the same inputs;
      (f) calling it twice with the same inputs gives equal maps (constitution XVI);
      (g) two approved workflows that share a step scenario produce two distinct workflow-step
      item ids. Each has its own entry naming only the producer from its own workflow (spec.md
      Edge Cases, "same scenario in more than one approved workflow").
- [ ] T004 [P] [US1] Extend `backend/tests/unit/execution/runExecution.test.ts`, following its
      existing pattern (a hand-built `ApiModel`/`TestModel`, a real `TargetServer`, and
      `runExecution()` called directly inside `enterTestSession`). Add a `describe` block for
      FR-001–FR-007, with a `WorkflowExportContext` holding one approved two-step workflow
      (`POST /orders` produces `id`, and `GET /orders/{orderId}` consumes it) and a case for each
      of these:
      (1) producer returns `500`: the target receives no `GET /orders/...`, and the GET's result is
      `not-attempted`, `"dependency-not-met"`, with `unmetDependencies` equal to the POST's
      `{ scenarioId, operationPath, operationMethod }`;
      (2) producer returns `201` with `id`: the GET is sent with that id;
      (3) producer returns `201` with `id` but a body that breaks its documented schema: the POST
      is `failed` / `"assertion-failed"`, and the GET is still sent (User Story 1, Scenario 6);
      (4) producer target unreachable (connectivity failure): the GET is withheld;
      (5) three-step chain where step 1 fails: steps 2 and 3 are withheld, and step 3's
      `unmetDependencies` names step 2, not step 1 (FR-003);
      (6) an unrelated standalone scenario in the same run still runs and passes (FR-004);
      (7) cancellation requested after the producer completes: the dependent is `"cancelled"`,
      not `"dependency-not-met"` (FR-005). Use `TargetServer`'s per-route delay, as
      `executionRuns.test.ts`'s cancel test does, to make the timing controllable;
      (8) an automatic path chain (AP-019) whose producer fails: its consumer is withheld;
      (9) an auth-credential chain (AP-023) whose producer fails: its consumer is still sent
      (FR-006);
      (10) a request that takes data values from two earlier requests, one of which returns `500`
      while the other passes: it is withheld, and `unmetDependencies` lists exactly the failed
      one (FR-002);
      (11) the same setup with both earlier requests failing: `unmetDependencies` lists both, in
      execution order.
      The existing OAuth2 cases in this file must pass unchanged (FR-007).

### Implementation for User Story 1

- [ ] T005 [US1] In `backend/src/postman/automaticChaining.ts`, add `kind: "data" | "credential"`
      to `AutomaticChain`, and set it in `applyChainGroup()` from the `isAuthChain` value that
      function already computes (`"credential"` when `true`, `"data"` otherwise). Record it on
      the returned `chain` object only. Change no other behavior, including the variable name,
      extraction, or substitution. Update any `AutomaticChain` literal in
      `backend/tests/unit/postman/automaticChaining.test.ts` that no longer type-checks by adding
      the matching `kind`.
- [ ] T006 [US1] In `backend/src/postman/generateCollection.ts` (depends on T005):
      - Export `type ExecutionDependencyMap = ReadonlyMap<string, readonly string[]>` and
        `generateExecutableCollection(apiModel, testModel, options?, workflowContext?)`, with a
        doc comment citing specs/029 research.md D1.
      - Move the existing body of `generateCollection()` into it. Its failure returns stay the
        same, and on success it returns `{ ok: true, result, dataDependencies }`.
      - Build `dataDependencies` from what is already in scope:
        - for each `workflowPlans.plans` entry without a `limitation`, and each
          `plan.variables` entry, link
          `itemIdForWorkflowStep(plan.workflowId, consumer.position, consumer.scenario.id)` to
          the producer step's id, taking the steps from `plan.steps[variable.consumerStepIndex]`
          and `plan.steps[variable.producerStepIndex]`;
        - for each `automaticChaining.chains` entry with `kind === "data"`, link each
          `itemIdForScenario(consumer.scenarioId)` to `itemIdForScenario(chain.producer.scenarioId)`.
      - De-duplicate each producer list and order it by the producers' execution order.
      - Reduce `generateCollection()` to a wrapper that calls `generateExecutableCollection()` and
        returns `{ ok: true, result }` or the failure unchanged.
      - Confirm `backend/tests/unit/postman/determinism.test.ts`, `reexportStability.test.ts`, and
        `generateCollection.test.ts` pass with no edits.
- [ ] T007 [US1] In `backend/src/execution/runExecution.ts` (depends on T002, T006):
      - Call `generateExecutableCollection()` instead of `generateCollection()`.
      - Keep a `blocked: Set<string>` of item ids.
      - In the loop, after the existing cancellation checks, and only for scenario-backed items
        (`scenarioId !== undefined`), look up `dataDependencies.get(item.id)`. If any producer id
        is in `blocked`, append a `not-attempted` result with
        `notAttemptedReason: "dependency-not-met"` and `unmetDependencies` built from each
        blocked producer's scenario (via `scenarioById`, in the producer list's order). Then add
        `item.id` to `blocked` and `continue`, without calling `runSingleItem()`.
      - After a scenario-backed item runs, add `item.id` to `blocked` when the mapped result is
        `outcome: "failed"` and `failureCategory !== "assertion-failed"` (spec.md FR-001,
        research.md D3).
      - Leave the synthesized (no-`scenarioId`) branch unchanged, so token-fetch items never
        enter `blocked`.
      - Reuse the existing not-attempted result shape from `appendNotAttempted()`, adding a small
        helper for a single result if that reads more clearly.
      - Keep the existing cancellation-first order and the `catch` fallback unchanged.
      - Update the function's doc comment to cite specs/029 FR-001.

**Checkpoint**: T003 and T004 pass. A failed producer no longer causes its data dependents to be
sent, and every other run behaves as before.

---

## Phase 4: User Story 2 - Every Result States Where Processing Ended (Priority: P2)

**Goal**: Every `RequestResult` produced after this feature has `processingStage`, consistent
with its outcome and failure category (spec.md FR-008, FR-009; data-model.md table). Stored
results without it are still read back (FR-015).

**Independent Test**: Run a collection producing a pass, an assertion failure, a connectivity
failure, and a cancellation. The stages are `"response-received"`, `"response-received"`,
`"no-response"`, and `"not-sent"` (quickstart.md Scenario 2).

### Tests for User Story 2

- [ ] T008 [P] [US2] Extend `backend/tests/unit/execution/mapNewmanResult.test.ts` so that every
      existing case also asserts `processingStage`: `"no-response"` for `connectivity-failure`
      and `timeout`, and `"response-received"` for `passed`, `assertion-failed`,
      `unexpected-status`, and `could-not-evaluate`. Also assert that a `"local"`-tier result with
      `rawCapture` still carries the same stage.
- [ ] T009 [P] [US2] Create `backend/tests/unit/persistence/executionRunRepository.test.ts`,
      following the setup in `backend/tests/unit/persistence/uploadedCollectionRepository.test.ts`.
      Store a run with one `RequestResult` that has neither `processingStage` nor
      `unmetDependencies`, as a pre-specs/029 row would. Assert that `get`/`listBySession` return
      it unchanged and without error, and that a later `appendResult` with the new fields keeps
      both results intact (FR-015, research.md D7).
- [ ] T010 [P] [US2] Extend `backend/tests/unit/execution/runExecution.test.ts` with a case that
      runs one passing request and one request to an unreachable target, then cancels before a
      third. Assert the three stages, and assert data-model.md's invariants over every result in
      the run.

### Implementation for User Story 2

- [ ] T011 [P] [US2] In `backend/src/execution/mapNewmanResult.ts`, set
      `processingStage: "no-response"` on the `requestError` branch, and
      `processingStage: "response-received"` on both the passed and failed returns of
      `mapNewmanResult()`. Do not change `buildRawCapture`, `isTimeoutError`, or
      `redactIfSensitive`, which `externalCollections/mapUploadedResult.ts` reuses (FR-016).
- [ ] T012 [US2] In `backend/src/execution/runExecution.ts` (depends on T007 if US1 is done
      first, since it is the same file), set `processingStage: "not-sent"` on every not-attempted
      result: `appendNotAttempted()` for `"cancelled"` and `"run-ended-before-reached"`, and the
      US1 `"dependency-not-met"` path.

**Checkpoint**: T008–T010 pass, and every new result carries a consistent stage.

---

## Phase 5: User Story 3 - The Confirmation Step Reflects What Will Actually Be Sent (Priority: P3)

**Goal**: `confirmation_required` counts and lists only destructive operations that have an
approved scenario, in `ApiModel` order, each once. The OAuth2 token request is never counted.
Staging and production always require confirmation (spec.md FR-010–FR-013).

**Independent Test**: With only GET scenarios approved, a `local` start returns `200` without
`confirmed`, and a `staging` start returns `409` with `destructiveOperations: []`
(quickstart.md Scenario 3).

### Tests for User Story 3

- [ ] T013 [P] [US3] Extend `backend/tests/unit/execution/destructiveOperations.test.ts` for the
      new signatures `destructiveOperations(apiModel, approvedTestModel)` and
      `confirmationRequirement(apiModel, approvedTestModel, environment)`, with these cases:
      (a) GET-only approved scenarios on `local`/`dev`/`qa` give `undefined`;
      (b) the same on `staging`/`production` gives a requirement with
      `destructiveOperations: []`;
      (c) a DELETE operation with no approved scenario is not listed;
      (d) two approved scenarios for the same POST list it once;
      (e) the order follows `ApiModel.operations`;
      (f) method and path match case-insensitively on the method.
      Keep the existing cases, supplying an approved model that covers every operation, and
      confirm their expected output is unchanged.
- [ ] T014 [P] [US3] Add an optional scenario filter to `driveToPostmanGenerationComplete()` in
      `backend/tests/fixtures/execution/driveWorkflow.ts` (for example
      `{ accept?: (scenario) => boolean }`), defaulting to today's accept-everything behavior and
      rejecting scenarios the filter excludes. Then add an integration test to
      `backend/tests/integration/execution/executionRuns.test.ts` that accepts only `get`
      scenarios from `valid.yaml`:
      - a `local` start without `confirmed` returns `200` and the run settles;
      - a `staging` start without `confirmed` returns
        `409 confirmation_required` with `destructiveOperations` equal to `[]`.
      The existing FR-007 tests in that file must pass unchanged, because `valid.yaml`'s
      `POST /pets` stays approved in them.

### Implementation for User Story 3

- [ ] T015 [US3] In `backend/src/execution/destructiveOperations.ts`, change
      `destructiveOperations(apiModel)` to `destructiveOperations(apiModel, approvedTestModel)`.
      It keeps only operations whose upper-cased method is in `DESTRUCTIVE_METHODS` and that
      match at least one `approvedTestModel.scenarios` entry on
      `operationMethod.toUpperCase()` + `operationPath`, in `apiModel.operations` order. Change
      `confirmationRequirement(apiModel, approvedTestModel, environment)` to use it. Keep the
      `DESTRUCTIVE_METHODS` and `DestructiveOperation` exports exactly as they are
      (`externalCollections/destructiveRequests.ts` imports them; FR-016). Update the doc
      comments to cite specs/029 FR-010 and research.md D6, including why the token-fetch POST is
      excluded without a special case.
- [ ] T016 [US3] In `backend/src/api/testGenerationWorkflow.ts`, `execution/start` handler
      (currently `confirmationRequirement(workflow.apiModel!, environment)`), pass
      `workflow.approvedTestModel!` as the new second argument (depends on T015). No other route
      change.

**Checkpoint**: T013 and T014 pass. Confirmation reflects approved scenarios only, and the tier
rule is unchanged.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T017 [P] In `backend/tests/integration/execution/executionRuns.test.ts`, add a shared
      assertion helper that checks data-model.md's invariants (`processingStage` present and
      consistent; `unmetDependencies` present if and only if `"dependency-not-met"`, with every
      entry's `scenarioId` found earlier in `results`). Call it from the existing full-run,
      unreachable-target, cancel, and history tests (SC-002, SC-003).
- [ ] T018 [P] In `specs/018-test-execution-results/contracts/execution-api.md`, add a note under
      the API-only paragraph pointing to `specs/029-execution-gap-closure/contracts/
      execution-api-delta.md` for the additive `processingStage`/`unmetDependencies` fields and
      the FR-007 correction. Do not rewrite the existing examples.
- [ ] T019 [P] In `specs/018-test-execution-results/spec.md`, add a Clarifications Session
      2026-09-23 bullet recording that FR-007, FR-016, and FR-018 gaps found by convergence are
      closed by `specs/029-execution-gap-closure` (AP-030). State explicitly that specs/029
      FR-001 supersedes this spec's FR-018 edge case ("never sent with a missing or empty
      value") for a producer whose only failure is a schema mismatch: that dependent is sent and
      fails visibly. Also summarize the approved-scenario destructive list, which excludes the
      OAuth2 token request. Add a one-line pointer to that bullet next to FR-018 and its edge case,
      without rewriting either.
- [ ] T020 [P] In `README.md`, update the generated-collection execution paragraph (the one
      beginning "The guided workflow's own execution endpoints"). Say that a request is withheld
      as "dependency not met" when an earlier request it takes a data value from has a blocking
      outcome, that each result reports its processing stage, and that destructive-request
      confirmation counts only approved requests. Leave `docs/USER_MANUAL.md` alone, since it
      covers the specs/026 UI path, which is unchanged.
- [ ] T021 [P] In `specs/ROADMAP.md`:
      - add an `AP-030 — Test Execution Gap Closure` entry
        (`specs/029-execution-gap-closure`) that states its relationship to AP-017 and the
        directory-number/AP-id divergence;
      - add a row to the Implementation Status table below the AP-029 row;
      - add a Next Actions item recording the convergence finding, this spec, and the final
        validation counts from T022.
- [ ] T022 Run `npm test`, `npm run lint`, and `npm run build` from the repository root. Record
      the counts, compare them with T001's baseline, and explain every test whose expectation
      changed (SC-006). Fix any failure before marking this done. Do not weaken lint or compiler
      settings.
- [ ] T023 Work through quickstart.md Scenarios 1–3 against the automated tests added above,
      mapping each quickstart step to the test case that covers it, and record any step with no
      coverage. The manual HTTP walkthrough is optional. If it is not performed, say so
      explicitly.
- [ ] T024 Review the final diff for the Definition of Done in `.claude/CLAUDE.md` §66:
      - no raw values or credentials in the new fields (FR-017);
      - no change under `frontend/` or `backend/src/externalCollections/` (FR-016);
      - no change to the exported collection bytes (constitution XVI);
      - no unrelated files touched.
      Leave all changes uncommitted for the user's review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None.
- **Foundational (Phase 2)**: Depends on Phase 1. Blocks US1 and US2.
- **US1 (Phase 3)**: Depends on Phase 2. This is the MVP.
- **US2 (Phase 4)**: Depends on Phase 2. T012 edits the same file as T007, so it runs after T007
  when both stories are delivered. Otherwise it is independent of US1.
- **US3 (Phase 5)**: Depends only on Phase 1 and can run in parallel with Phases 2–4.
- **Polish (Final Phase)**: Depends on every story intended for this delivery. T021's final
  counts come from T022.

### Within Each User Story

- Write tests before the implementation they cover, and expect them to fail first.
- Types come before generator changes, generator changes before the execution loop, and domain
  functions before the route.

### Parallel Opportunities

- T003 and T004 (US1 tests) run in parallel. T005 → T006 → T007 run in sequence.
- T008, T009, T010, and T011 run in parallel. T012 follows T007.
- All of US3 (T013–T016) can run alongside US1/US2, since it touches different files.
- T017–T021 are independent documentation and test-helper edits.

---

## Parallel Example: User Story 1

```bash
# Once T002 is complete:
Task: "Create backend/tests/unit/postman/executionDependencies.test.ts (T003)"
Task: "Extend backend/tests/unit/execution/runExecution.test.ts with FR-001–FR-007 cases (T004)"
# Meanwhile, User Story 3 in parallel:
Task: "Extend backend/tests/unit/execution/destructiveOperations.test.ts (T013)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2 (T001–T002).
2. Phase 3 (T003–T007).
3. **Stop and validate**: T003 and T004 pass, and `generateCollection()` determinism and golden
   tests are unchanged. This closes the only "missing" gap and the only one that sends requests
   that should not be sent.

### Incremental Delivery

1. Add US1: dependent requests are withheld (MVP).
2. Add US2: every result states its processing stage.
3. Add US3: confirmation matches the approved scenarios.
4. Polish: invariant checks, cross-references, README, ROADMAP, and full validation.

Each increment is additive and can be checked on its own using its Independent Test above.
