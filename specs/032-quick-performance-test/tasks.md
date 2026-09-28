---

description: "Task list for AP-032 Quick Performance Test from a Specification"
---

# Tasks: Quick Performance Test from a Specification (AP-032)

**Input**: Design documents from `specs/032-quick-performance-test/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (Q1 to Q19),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done, and research Q18
defines the test plan. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md US1 to US5) so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US5)
- Paths are relative to the repository root. Workspaces: `backend/`, `frontend/`, `packages/shared-domain/`.

## Standing rules for every task

- Do not commit. The user reviews the diff and commits it.
- No AI in any quick-path code (FR-004). No new dependency. No new environment variable.
- Never log a filename, path, value, body or specification content (research Q17).
- Byte-identical output for the same specification and edits (FR-007). Never use `localeCompare` in
  ordering; use `compareCodeUnits` from `backend/src/postman/ordering.ts`.
- Existing AP-029 tests must keep passing after each foundational refactor (T005 to T012).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixtures that several stories' tests and the quickstart need.

- [X] T001 [P] Create `backend/tests/fixtures/openapi/quick-performance.yaml`: OpenAPI 3.0 with at least 12 operations covering GET, POST, PUT, PATCH and DELETE. Include:
  - bearer security whose token comes from an unauthenticated `POST /auth/login`, detected by `findCredentialProducers` in `backend/src/postman/credentialProducers.ts`, whose response documents a token field;
  - `POST /orders` and `GET /orders/{orderId}`, where no operation produces `orderId`;
  - one enum query parameter, so an operation has several positive scenarios;
  - one operation with no documented 2xx response;
  - one `format: email` field in a POST body.

  Add a comment header naming AP-032 and the quickstart. Confirm with a throwaway unit assertion (or in T020) that `findCredentialProducers` finds `POST /auth/login`.
- [X] T002 [P] Extend `backend/scripts/perfStubTarget.ts` so the stub target serves every path in `quick-performance.yaml` with its documented success status, and `POST /auth/login` returns a JSON token. Keep the existing `performance.yaml` routes unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The plan-source adapter, run source recording and the source-agnostic frontend client and plan screen. Every story builds on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add the source fields to `packages/shared-domain/src/performance.ts`. Export both types from the package index if it re-exports individually.
  - Add `export type PerformancePlanSourceKind = "guided" | "quick"`.
  - Add `PerformancePlan.source: PerformancePlanSourceKind` and `PerformancePlan.credentialProducerOperationKeys: string[]`, with a doc comment that it is derived and excluded from the fingerprint.
  - Add `PerformanceRun.planSource: PerformancePlanSourceKind`, which also flows into `PerformanceRunSummary`.
  - Do not remove `scope` yet (US4, T063).
- [X] T004 Update the shared test builders with `source: "guided"`, `credentialProducerOperationKeys: []` and, on runs, `planSource: "guided"`:
  - `backend/tests/fixtures/performance/builders.ts`
  - `frontend/tests/unit/performanceFixtures.ts`
- [X] T005 Add `source: PerformancePlanSourceKind` to `PerformanceContext` in `backend/src/performance/plan/stepRequest.ts`, and set `source: "guided"` in `contextFromWorkflow` in `backend/src/performance/plan/buildPlan.ts`.
  - In `assemblePlan`, set `plan.source = context.source`, and set `credentialProducerOperationKeys: []` for now (filled in by T023).
  - In `planFingerprint`, add `source` to the hashed fields. Keep `credentialProducerOperationKeys` out, like `stepsNeedingExpectedStatus`, and update `finalizePlan`'s `Omit` accordingly.
- [X] T006 Add the `plan_source` column in `backend/src/persistence/connection.ts`: call the existing `ensureColumn("performance_runs", "plan_source", "TEXT NOT NULL DEFAULT 'guided'")` after the `performance_runs` `CREATE TABLE`, with a comment citing AP-032 research Q12.
- [X] T007 Read and write `plan_source` in `backend/src/persistence/performanceRunRepository.ts`: map it to `PerformanceRun.planSource`, reading a missing or empty value as `"guided"`. Add a `listBySessionAndSource(sessionId, source)` query, newest first.
- [X] T008 In `backend/src/performance/performanceRunStore.ts`, change `listPerformanceRuns()` to `listPerformanceRuns(source: PerformancePlanSourceKind)`, which filters through T007's query. `getPerformanceRun`, `getPerformanceInProgressRun` and cancel stay source-agnostic.
- [X] T009 Create `backend/src/api/performanceRoutes.ts` (research Q2).
  - Define `PerformancePlanSource` (`kind`, `require(): PlanHandle`) and `PlanHandle`: `context`, `plan()`, `savePlan(plan)`, `script()`, `saveScript(script)`, `onPlanChanged(before, after)`, `onPlanReset(plan)`, `onScriptGenerated()`.
  - Implement `registerPerformanceRoutes(router, base, source, deps)`. Move into it the route bodies of these routes from `backend/src/api/performanceTesting.ts`:
    - `GET /plan`, `PUT /plan`, `POST /plan/reset` and `GET /plan/values`;
    - `POST /script` and `GET /script/download`.
  - Replace every direct workflow, `scriptStore` or stage call with the handle's method. Move `fail`, `handleKnownError`, `scriptStatus` and the log helpers here, and export them.
  - `GET /plan` calls a new optional `handle.onOpen?()` before `plan()`; the guided source uses it for `enterStageIfNeeded`.
  - End `registerPerformanceRoutes` by calling `registerPerformanceRunRoutes(router, deps, base, source)` (T011), so every source gets the readiness and run routes. This replaces the call at the end of `performanceTesting.ts`.
- [X] T010 Rewrite `backend/src/api/performanceTesting.ts` as the guided source adapter, then `createPerformanceTestingRouter(deps)`, which calls `registerPerformanceRoutes(router, "/test-generation-workflow/performance", guidedSource, deps)`.
  - The adapter has `kind: "guided"`.
  - `require()` uses `requirePostmanGenerationComplete()` and keeps `PostmanGenerationIncompleteError` mapped to `409 postman_generation_incomplete`.
  - The plan comes from `currentPlan`, and `patchWorkflow` saves it.
  - The script uses `getGeneratedScript` and `setGeneratedScript`.
  - `onOpen` calls `enterStageIfNeeded`.
  - `onPlanChanged` moves the stage from complete to active when the fingerprint changed.
  - `onPlanReset` does the same when the script is out of date.
  - `onScriptGenerated` moves the stage from active to complete.

  Behaviour must be identical. `backend/tests/integration/performance/planRoutes.test.ts` must pass unchanged.
- [X] T011 Change `registerPerformanceRunRoutes` in `backend/src/api/performanceRuns.ts` to take the `PerformancePlanSource`.
  - `POST /runs` step 1 is `source.require()`, and step 2 reads `handle.plan()` and `handle.script()`.
  - Keep steps 3 to 5 and the synchronous check-then-insert unchanged.
  - Set `planSource: source.kind` on the new run.
  - `GET /runs` returns `listPerformanceRuns(source.kind)`.
  - Add `planSource` to the `performance_run_started` and `performance_run_settled` log fields (`backend/src/performance/runPerformanceTest.ts`).
  - Import `fail` and `handleKnownError` from `backend/src/api/performanceRoutes.ts`, not from `performanceTesting.ts`, and drop the `currentPlan` and `requirePostmanGenerationComplete` imports, so there is no circular import between the two route modules.
  - `backend/tests/integration/performance/runRoutes.test.ts`, `executionSlot.test.ts` and `restart.test.ts` must pass. Adjust only for the new `planSource` field.
- [X] T012 [P] In `frontend/src/services/performanceTestingClient.ts`, add `createPerformanceClient(base: string)`. It returns every existing function (`fetchPlan`, `updatePlan`, `resetPlan`, `fetchValueStatuses`, `generateScript`, `scriptDownloadUrl`, `fetchReadiness`, `startRun`, `fetchRuns`, `fetchRun`, `cancelRun`, `fetchReport`, `reportDownloadUrl`) bound to `base`.
  - Export the type `PerformanceClient`.
  - Keep the current named exports as the guided instance (`const guided = createPerformanceClient("/api/test-generation-workflow/performance")`), so `frontend/tests/unit/performanceTestingClient.test.ts` passes unchanged.
- [X] T013 Make `PerformanceRunPanel` and `PerformanceReportFrame` take a `client: PerformanceClient` prop and use it instead of the module imports:
  - `frontend/src/components/performance/PerformanceRunPanel.tsx`
  - `frontend/src/components/performance/PerformanceReportFrame.tsx`

  Update `frontend/tests/unit/PerformanceRunPanel.test.tsx` to pass a client.
- [X] T014 Create `frontend/src/components/performance/PerformancePlanScreen.tsx` by moving the body of `PerformanceTestingStage` into it: state, effects, `apply`, generate, reset and every panel.
  - Props: `client: PerformanceClient`, `title`, `lead` (text under the title), `scopeNote: ReactNode` (the content of the operations section above the removed and omitted lists), `emptyState?: ReactNode`, `onAdvanced?`, and `testId`.
  - `frontend/src/components/performance/PerformanceTestingStage.tsx` renders it with the guided client and today's copy, keeping the scope radios in `scopeNote` until US4.
  - `frontend/tests/unit/PerformanceTestingStage.test.tsx` must pass unchanged.

**Checkpoint**: Foundation ready. The guided path behaves as before, and the plan and run routes and the frontend screen are source-agnostic.

---

## Phase 3: User Story 1 - From a specification to a performance plan in one step (Priority: P1) 🎯 MVP

**Goal**: A "Quick performance test" start-screen entry uploads a specification and opens a plan of single-step journeys, one per operation with a positive scenario. Credential producers start removed. Each step's request can be previewed. The script generates byte-identically.

**Independent Test**: With no k6 installed, upload a specification of at least ten operations through the quick path. Check that:
- the plan appears with no review stage;
- every operation with a positive scenario is a single-step journey, and the rest are listed with a reason;
- generating twice across two uploads gives byte-identical files with no secrets.

These are quickstart scenarios 1 and 2.

### Tests for User Story 1 ⚠️

- [X] T015 [P] [US1] Add tests for `generatePositiveScenarios` in `backend/tests/unit/testDesign/generatePositiveScenarios.test.ts`. Check that:
  - every scenario has `category: "positive"`, and no rule outside positive, enum-positive and minimal-positive is invoked (spy on one negative rule module or assert categories over `quick-performance.yaml`);
  - duplicates merge with `duplicateOfRules`;
  - `generateTestModel`'s output for the same model is unchanged.
- [X] T016 [P] [US1] Add tests for quick scenario ids in `backend/tests/unit/performance/quickScenarioIds.test.ts`. Check that ids:
  - match `^q\d{2}-[0-9a-f]{24}$`;
  - are identical across two generations from two separate parses of the same file;
  - are unique;
  - sort with the positive-scenario rule lowest, so that `selectPerformanceScenario` picks the full happy-path scenario for the enum operation.
- [X] T017 [P] [US1] Add credential-producer tests to `backend/tests/unit/performance/buildPlan.test.ts` (FR-003a, US1 AS6). Check that:
  - `credentialProducerOperationKeys` is `["POST /auth/login"]` for `quick-performance.yaml`;
  - a quick context starts with it in `excludedOperationKeys` and the secured steps have `auth.kind: "chained-login"`;
  - a guided context starts with no exclusions;
  - restoring the producer (`excludedOperationKeys: []`) makes it a journey;
  - an operation named `logout` is not excluded;
  - `source` changes the fingerprint.
- [X] T018 [P] [US1] Add tests for `requestPreview` in `backend/tests/unit/performance/requestPreview.test.ts` (FR-008). Check that:
  - `GET /orders/{orderId}` shows `orderId` as an `environment` value;
  - the enum query parameter shows its generated value;
  - the email body field is a `unique-per-iteration` reference;
  - the bearer token is a `credential` reference;
  - a static API-key scheme shows an `environment` reference with `secret: true`;
  - a value that mixes text and a reference (for example a header `Bearer {{name}}` or a path segment built from text and a variable) is a `template` value listing its references.

  Seed `SEEDED_CLIENT_SECRET` into an environment and assert that it appears nowhere in the serialized preview.
- [X] T019 [P] [US1] Add a parity test to `backend/tests/unit/performance/renderScript.test.ts`. For every step of a plan, the request that `stepRequestFor` returns must equal the request embedded for that step in the rendered script. Assert that the golden script is byte-identical to before the T027 refactor.
- [X] T020 [P] [US1] Add route tests in `backend/tests/integration/performance/quickRoutes.test.ts` (Supertest, fake runner, per `contracts/quick-performance-api.md`):
  - **Upload success:** `POST /api/quick-performance` with `quick-performance.yaml` returns 200 with `plan.source: "quick"`, single-step journeys only, no workflow journey, and `script: null`. `GET /` returns the same view.
  - **Upload errors:**
    - no file, `invalid-yaml.txt` and `unsupported-version.yaml` each return the same status and body as `POST /api/test-generation-workflow`;
    - an oversized file returns 413 `file_too_large`;
    - after each, `GET /` returns `404 quick_test_not_found`.
  - **Replacement:** a second upload returns `409 quick_test_exists`; with `?replaceExisting=true` it returns 200 with a new plan.
  - **Gating:** every plan and script route returns `404 quick_test_not_found` without a quick test.
  - **Nothing to test:** a specification with no positive scenario gives a plan with no journeys, and `POST /script` returns `422 nothing_to_test`.
  - **Step preview:** `GET /plan/steps/:stepId/request` returns 200, and an unknown step returns `404 step_not_found`.
  - **Run routes registered:** `GET /api/quick-performance/readiness` returns 200 and `GET /api/quick-performance/runs` returns `200 {runs: []}` (checks T009's call to `registerPerformanceRunRoutes`).
- [X] T021 [P] [US1] Add determinism and isolation tests in `backend/tests/integration/performance/quickDeterminism.test.ts`:
  - **SC-004:** two sessions (or a replace) upload `quick-performance.yaml` and apply the same `PUT /plan` edits. The downloads of `?file=script` and `?file=environment-template` are byte-identical, and `scriptSha256` matches. Neither file contains `SEEDED_CLIENT_SECRET` after it is set in an environment.
  - **FR-021:** with a guided workflow in progress in the same session, creating and replacing a quick test leaves `GET /api/test-generation-workflow` unchanged (deep-equal). Discarding the guided workflow and uploading a new one leaves `GET /api/quick-performance` unchanged.
- [X] T022 [P] [US1] Add frontend tests for the entry and quick page:
  - `frontend/tests/unit/App.test.tsx`: three entries are offered, with the FR-001 sentence, and choosing "Quick performance test" shows the quick page.
  - New `frontend/tests/unit/QuickPerformancePage.test.tsx`:
    - uploading shows the plan with no review stage;
    - an upload error shows the server message and no plan;
    - a second upload asks for confirmation, and cancelling sends nothing;
    - the no-journeys case shows the empty state, the left-out list and "Back to start";
    - "Back to start" calls `onExit`;
    - the removed list shows "used to acquire the run's credentials" for `POST /auth/login`, and Restore sends `excludedOperationKeys` without it;
    - with every operation removed, the plan says "The plan has no operations", Generate is disabled with that reason, and restoring one operation enables it again (spec Edge Cases).
  - New `frontend/tests/unit/StepRequestPreview.test.tsx`: the preview loads on first open, lists each parameter kind, and never renders a value for an `environment` entry.

### Implementation for User Story 1

- [X] T023 [US1] Record credential producers (research Q5). In `backend/src/performance/plan/stepRequest.ts`, add `producerOperationKey?: string` to `TokenSource`, and set it to the producer's `operationKeyOf(operation)` for `chained-login` sources in `planAuth`. In `backend/src/performance/plan/buildPlan.ts`:
  - set `credentialProducerOperationKeys` from the token sources, deduplicated and sorted with `compareCodeUnits`;
  - in `defaultChoices(context)`, start `excludedOperationKeys` from those keys when `context.source === "quick"`, and empty otherwise.
- [X] T024 [P] [US1] Add `generatePositiveScenarios(apiModel: ApiModel): TestScenario[]` in `backend/src/testDesign/generateTestModel.ts`.
  - Define `POSITIVE_RULES = [positiveScenario, enumPositiveScenarios, minimalPositiveScenario]` and use it for the first three entries of `RULES`, so the order has one definition.
  - Run it over every operation, then call `deduplicate`.
  - Log `positive_generation_complete` with counts and duration.
- [X] T025 [P] [US1] Create `backend/src/performance/quick/quickScenarioIds.ts` with `withQuickScenarioIds(scenarios: TestScenario[]): TestScenario[]` (research Q4, data-model "Quick scenario identifiers").
  - Map each scenario to a copy with `id = "q" + rank + "-" + sha256Hex(canonicalJson({operationKey, rule, request, assertions})).slice(0, 24)`.
  - `rank` is the two-digit index of `provenance.rule` in `["positive-scenario", "enum-positive-variant", "minimal-positive-scenario"]`. Read the rule names from the rule modules; do not hard-code a mismatched name.
  - Throw on an unexpected rule, and on a duplicate id.
  - Use `canonicalJson` and `sha256Hex` from `backend/src/performance/plan/identifiers.ts`.
- [X] T026 [US1] Create `backend/src/performance/quick/quickTestStore.ts` (research Q1, Q13). Export:
  - `interface QuickPerformanceTest` (data-model.md);
  - `getQuickTest()`, `hasQuickTest()`, `setQuickTest(test)` and `updateQuickTest(patch)`;
  - `contextFromQuickTest(test): PerformanceContext`, which returns `{apiModel, approvedScenarios: scenarios, workflows: [], relationships: [], selectedOperationKeys: undefined, source: "quick"}`.

  Use a `Map<sessionId, QuickPerformanceTest>` keyed by `getSessionId()` and cleared by `onExpire`. Add a unit test in `backend/tests/unit/performance/quickTestStore.test.ts` for session isolation and expiry.
- [X] T027 [US1] Extract `stepRequestFor(plan, context, auth, stepId): {step, operation, scenario, built: BuiltStepRequest, consumes, produces, workflow}` into `backend/src/performance/plan/stepRequest.ts` or a new `backend/src/performance/plan/planStepRequest.ts` (research Q8).
  - Move into it the per-step input computation now inline in `renderScript` (`backend/src/performance/k6/renderScript.ts:94-127`): workflow lookup, positions, consumes and produces, and unique-field tokens.
  - Make `renderScript` call it. The rendered output must not change (T019).
- [X] T028 [US1] Create `backend/src/performance/plan/requestPreview.ts` with `buildStepRequestPreview(plan, context, stepId): StepRequestPreview`, from `stepRequestFor`.
  - Split the template URL into the path template (`operation.path`) and the query entries.
  - Classify each parameter and header value, and each `{{name}}` in auth and body.
    - A value that is exactly one reference is `environment` (secret from `built.secretNames`), `workflow-variable` (from `consumes`), `unique-per-iteration` (the `UNIQUE_TOKEN_PREFIX` tokens, with their format from `plan.uniqueValueFields`) or `credential` (the token source's `tokenVariable`).
    - A value with no reference is `generated`.
    - A value that mixes text and references is `template`, with each reference classified the same way.
  - Never read an environment. Throw `StepNotFoundError` (new, in `backend/src/performance/errors.ts`) for an unknown step.

  First add the `StepRequestPreview`, `PreviewParameter`, `PreviewValue`, `PreviewReference` and `PreviewAuth` types to `packages/shared-domain/src/performance.ts`, exactly as in data-model.md.
- [X] T029 [US1] Add `GET <base>/plan/steps/:stepId/request` to `registerPerformanceRoutes` in `backend/src/api/performanceRoutes.ts`. It calls `source.require()` and returns `200 {request}`. Map `StepNotFoundError` to `404 step_not_found` in `handleKnownError`. This serves both paths (FR-012a).
- [X] T030 [US1] Create `backend/src/performance/quick/createQuickTest.ts` with `async createQuickTest(fileBuffer, filename, replaceExisting): Promise<QuickPerformanceTest>` (research Q14, Q15).
  - Throw `QuickTestExistsError` (in `backend/src/performance/errors.ts`) when `hasQuickTest() && !replaceExisting`.
  - Then run `parseYaml`, `validateSpec` and `buildApiModel` exactly as `backend/src/testGenerationWorkflow/startWorkflow.ts` does, then `withQuickScenarioIds(generatePositiveScenarios(apiModel))`, then `buildPlan(contextFromQuickTest(...))`.
  - Call `setQuickTest` only after every step succeeds.
  - Log `quick_performance_test_created` with operationCount, journeyCount, leftOutCount, credentialProducerCount and replaced.
  - Import nothing from `backend/src/testGenerationWorkflow/` except the pure pipeline functions (none live there), so FR-021 holds by construction.
- [X] T031 [US1] Create `backend/src/api/quickPerformance.ts` with `createQuickPerformanceRouter(deps)`.
  - `POST /quick-performance` uses `upload.single("file")` and `reaffirmSession`:
    - no file returns `400 invalid_yaml` with the guided route's message;
    - `?replaceExisting=true` is passed through;
    - `QuickTestExistsError` returns `409 quick_test_exists`;
    - anything else goes to `next(err)`, so `app.ts` maps `invalid_yaml`, `unsupported_version` and `file_too_large`;
    - on failure, log `quick_performance_upload_failed`;
    - success returns `200 {quickTest: QuickPerformanceTestView}`.
  - `GET /quick-performance` returns 200, or `404 quick_test_not_found`.
  - The quick source adapter:
    - has `kind: "quick"`;
    - `require()` throws `QuickTestNotFoundError`, mapped to `404 quick_test_not_found` in `handleKnownError`;
    - its plan, script and `savePlan` read and write the quick store;
    - `onPlanChanged`, `onPlanReset` and `onScriptGenerated` do nothing;
    - `POST /plan/reset` rebuilds with `rebuildPlan(plan, context, {keepOrder: false})`.
  - Call `registerPerformanceRoutes(router, "/quick-performance", quickSource, deps)`.

  Add the `QuickPerformanceTestView` type to `packages/shared-domain/src/performance.ts`.
- [X] T032 [US1] Mount the router in `backend/src/app.ts` with `app.use("/api", createQuickPerformanceRouter({...defaultPerformanceDependencies(), ...options?.performance}))`, next to the AP-029 router. Add a comment that runs start only on `POST .../runs`, under the XVII exception as extended 2026-09-27.
- [X] T033 [P] [US1] Create `frontend/src/services/quickPerformanceClient.ts`.
  - `uploadQuickTest(file: File, replaceExisting = false)`: multipart `file`, the same shape as `startWorkflow` in `frontend/src/services/testGenerationWorkflowClient.ts`.
  - `fetchQuickTest()`: 404 maps to `{ok: true, quickTest: null}`.
  - Export `quickPerformanceClient = createPerformanceClient("/api/quick-performance")`.
  - Use the `{ok}` result union and the logger, as the other clients do.
- [X] T034 [P] [US1] Add a third choice to `frontend/src/components/EntryChooser.tsx`: extend `EntryChoice` with `"quick-performance"`, and add a button labelled "Quick performance test" with the sentence "Load-tests every operation of an uploaded specification with generated requests that no one reviews." (FR-001). Match the existing two buttons' structure and accessible names.
- [X] T035 [P] [US1] Create `frontend/src/components/performance/StepRequestPreview.tsx`: a disclosure ("Request") per step, loaded through a `loadPreview(stepId)` prop on first open, with loading, error and ready states.
  - Show the method badge and path template in monospace, then a table of path, query and header parameters: name, location, and value or "from environment: <name>" (with "secret" when `secret`), "from step <label>", "unique per virtual user and iteration" or "token acquired by the plan".
  - Show the body in the existing `CodeBlock`, with horizontal scroll.
  - Never render a value for an `environment` entry.
- [X] T036 [US1] Add the preview disclosure under each step in `frontend/src/components/performance/JourneyList.tsx`, and wire `client` (add `fetchStepRequest(stepId)` to `createPerformanceClient` in T012's file) through `PerformancePlanScreen`.
- [X] T037 [US1] Update the removed list and empty states in `frontend/src/components/performance/PerformancePlanScreen.tsx`.
  - Render the removed list with each operation's reason: "used to acquire the run's credentials" when the key is in `plan.credentialProducerOperationKeys`, otherwise "Removed". Give each a "Restore" button that sends `excludedOperationKeys` without that key. Keep "Restore all".
  - Distinguish the two empty-plan cases (spec Edge Cases):
    - With no journeys but at least one removed operation, show `EmptyState` "The plan has no operations", and set the disabled Generate button's reason to the same text (visible text next to the button, not only a tooltip).
    - With no journeys and nothing removed, keep the path's own `emptyState`. The guided default stays "No operation in scope has a positive scenario."
- [X] T038 [US1] Create `frontend/src/pages/QuickPerformancePage.tsx` with an `onExit` prop.
  - **Resume on mount:** call `fetchQuickTest()`; when a quick test exists, show it.
  - **Upload panel:** a file input with the same accepted types and error presentation (`ErrorState`) as the guided upload. On `409 quick_test_exists`, show `ConfirmDialog` ("Replace the current quick test? Runs and reports are kept.") and re-send with `replaceExisting`.
  - **After upload:**
    - a "← Back to start" button matching `frontend/src/pages/ExternalCollectionsPage.tsx:289-300`;
    - a "New specification" action;
    - the specification's title or filename and operation count;
    - `PerformancePlanScreen` with `quickPerformanceClient`;
    - lead text "Every operation of the specification, with generated requests that no one reviewed.", and a note that requests are not chained and the guided workflow is the way to chain them;
    - with no journeys, `emptyState` of `EmptyState` "Nothing can be load-tested", plus "Back to start".
- [X] T039 [US1] Wire the page in `frontend/src/App.tsx`.
  - Add `{ id: "quick-performance", label: "Quick Performance Test" }` to `TABS`.
  - Add a `quickPerformanceMounted` flag and a hidden-toggled `<QuickPerformancePage onExit={handleExitToStart} />` block, as for Import & Run.
  - Update `handleSelect` and `handleTabChange` to mount it, and make `setTabsVisible` true for `"quick-performance"`, as for `"import-collection"`.
  - Update the `TABS` comment, which says "two views".

**Checkpoint**: The quick path goes from upload to plan and script on its own (quickstart 1 and 2). Running needs US3.

---

## Phase 4: User Story 2 - See clearly what write operations will do (Priority: P1)

**Goal**: A write-operation summary above the journeys and beside the run trigger, effect markers on write steps, and one-action removal by method or of all writes. This applies on both paths (FR-012a).

**Independent Test**: Build a quick plan from `quick-performance.yaml`. Check the summary above the journeys and beside the run trigger, the per-step markers, and that bulk removal, single removal and restore each update the summary (quickstart 3).

### Tests for User Story 2 ⚠️

- [X] T040 [P] [US2] Add tests for `summarizeWriteOperations` in `packages/shared-domain/tests/unit/performance-write-summary.test.ts`. Check:
  - counts per method in the order POST, PUT, PATCH, DELETE, with zero counts omitted;
  - an operation in two journeys counted once, with two `stepIds`;
  - entries in plan order;
  - GET, HEAD and OPTIONS never counted;
  - a read-only plan gives `total: 0`;
  - `WRITE_EFFECT_LABELS` values.
- [X] T041 [P] [US2] Add tests for `WriteOperationSummary` in `frontend/tests/unit/WriteOperationSummary.test.tsx`.
  - The plan variant shows "15 write operations will be sent", per-method counts, each operation, and the FR-009 sentence. With 15 entries every operation's method and path is visible without expanding anything (SC-002).
  - The trigger variant shows per-method counts and every write operation's method and path, with no collapsed section (FR-011, SC-002, constitution XVII extension of 2026-09-27).
  - A read-only plan shows "This plan sends only read requests".
  - The status is conveyed by text, not only by colour or class.
- [X] T042 [P] [US2] Extend `frontend/tests/unit/PerformanceTestingStage.test.tsx`, or add `frontend/tests/unit/PerformancePlanScreen.test.tsx`. Check:
  - each write step shows "Creates", "Replaces", "Updates" or "Deletes" beside its method badge;
  - "Remove all DELETE operations" sends one `PUT` with the DELETE keys added, and "Remove all GET operations" does the same for GET (FR-014 covers every method present);
  - "Remove all write operations" sends one `PUT` with every write key;
  - the summary updates and an announcement is made.
- [X] T043 [P] [US2] Extend `frontend/tests/unit/PerformanceRunPanel.test.tsx` to check that the trigger area shows the write summary next to the environment's name, tier and base URL (FR-011). The per-method counts and the method and path of every write operation in the fixture plan must be present in the run panel without any interaction.

### Implementation for User Story 2

- [X] T044 [US2] Add the write-summary types and function to `packages/shared-domain/src/performance.ts` (data-model.md):
  - `WriteMethod`, `WriteEffect`, `WriteOperationEntry`, `WriteOperationSummary`;
  - `WRITE_EFFECT_LABELS`, and `writeEffectOf(method): WriteEffect | null`;
  - the pure `summarizeWriteOperations(journeys: readonly PerformanceJourney[]): WriteOperationSummary`.
- [X] T045 [P] [US2] Create `frontend/src/components/performance/WriteOperationSummary.tsx` with a `variant: "plan" | "trigger"` prop, a `summary` prop and an optional `listId` for the plan list's anchor.
  - The plan variant has the heading "<n> write operations will be sent", per-method `HttpMethodBadge` counts, the list of each operation (method badge and monospace path), and the FR-009 sentence: every virtual user sends each one on every iteration for the whole run, so it creates, changes or deletes data on the target each time, and ApiPilot does not clean up after the run.
  - The trigger variant has the per-method counts and every write operation's method badge and monospace path, as a dense list that is never collapsed. It can sit in a scrollable box of bounded height, but every entry must be in the DOM and reachable without an expand action. This is the constitution XVII condition that every write operation is listed at the run trigger (FR-011, SC-002).
  - Neither variant collapses its operation list, at any length.
  - Use the `warning` semantic tokens with a text label.
  - A read-only plan shows "This plan sends only read requests."
- [X] T046 [US2] Add the effect marker in `frontend/src/components/performance/JourneyList.tsx`: next to each step's method badge, render a text marker from `WRITE_EFFECT_LABELS` for write methods ("Creates", "Replaces", "Updates" or "Deletes"), styled as a `StatusBadge` with the warning tone.
- [X] T047 [US2] In `PerformancePlanScreen`, compute `summarizeWriteOperations(plan.journeys)` on each render.
  - Render the plan variant above the journeys, with an `id` for the trigger link.
  - Add "Remove all write operations" to the write summary.
  - Add one "Remove all <METHOD> operations" action per HTTP method present in the journeys, GET included (FR-014), to the journeys section header.
  - Each sends one `apply({excludedOperationKeys: [...plan.excludedOperationKeys, ...keys]}, "<n> operations removed.")`.
  - Pass the summary to `PerformanceRunPanel`.
- [X] T048 [US2] Render `<WriteOperationSummary variant="trigger" />` beside the run trigger in `frontend/src/components/performance/PerformanceRunPanel.tsx`, next to the existing environment name, tier and base URL, and the load-origin statement, so the full write list is in view when the user triggers the run.

**Checkpoint**: Write operations are visible and removable in bulk on both paths.

---

## Phase 5: User Story 3 - Supply values and run without a guided workflow (Priority: P1)

**Goal**: Environments can be created and chosen from a quick plan with no guided workflow, and are shared with it. Quick runs behave like AP-029 runs, share the execution slot, and are reported as coming from the quick path.

**Independent Test**: In a fresh session with no guided workflow, open a quick plan, create an environment, enter the listed values, and run with k6. Check the checklist, the run and the report (quickstart 4 to 6).

### Tests for User Story 3 ⚠️

- [X] T049 [P] [US3] Extend `backend/tests/integration/execution/environments.test.ts` (FR-016 to FR-018, SC-006). `GET`, `POST` and `PUT /api/test-generation-workflow/environments` must return:
  - `409 stage_not_active` with neither a completed Postman generation nor a quick test;
  - 200 or 201 with only a quick test;
  - 200 or 201 with only a completed guided workflow.

  Also check that an environment created in one path is listed in the other within the session (US3 AS2), that it is never listed in another session, and that `POST /api/test-generation-workflow/execution/start` still requires Postman generation.
- [X] T050 [P] [US3] Add quick run tests in `backend/tests/integration/performance/quickRunRoutes.test.ts` (fake runner).
  - `POST /api/quick-performance/runs` runs its checks in the order `quick_test_not_found`, then `script_not_generated`/`script_out_of_date`, then `k6_unavailable`, then `environment_not_found`, then `execution_in_progress`.
  - A started run has `planSource: "quick"`.
  - `GET /api/quick-performance/runs` lists only quick runs, and the guided `GET .../performance/runs` lists only guided runs.
  - Run-by-id, cancel and report work from either base.
  - Replacing the quick test keeps earlier runs and their reports.
  - `GET /plan/values?environmentId=` returns presence booleans only.
- [X] T051 [P] [US3] Add slot tests to `backend/tests/integration/performance/quickRunRoutes.test.ts`, next to the quick-run helpers (US3 AS4; the AP-029 slot tests in `executionSlot.test.ts` are unchanged). A quick run in progress blocks the guided performance run, a functional run and an uploaded-collection run, with `409 execution_in_progress`, and each of those in progress blocks a quick run.
- [X] T052 [P] [US3] Extend `backend/tests/unit/performance/report.test.ts` (FR-013). A run whose `planSnapshot.source` is `quick` renders the line "Plan built by the quick performance test from generated positive scenarios that were not reviewed." A `guided` snapshot, or one without `source`, renders no such line. The output stays deterministic and escaped.
- [X] T053 [P] [US3] Extend `frontend/tests/unit/QuickPerformancePage.test.tsx`. With no guided workflow, the environment picker lists environments and creates one through `EnvironmentForm`. The values checklist shows present and missing entries. The run panel uses `quickPerformanceClient` (its `startRun` targets `/api/quick-performance/runs`).

### Implementation for User Story 3

- [X] T054 [US3] Add `requireEnvironmentAccess()` in `backend/src/api/testGenerationWorkflow.ts`, next to `requireCompletedWorkflow()` (research Q6).
  - It passes when `getCurrentWorkflow()?.stages.postmanGeneration.status === "complete"` or `hasQuickTest()` (from `backend/src/performance/quick/quickTestStore.ts`), and otherwise throws the same `StageNotActiveError`. Word the message so it names both paths.
  - Use it in the three environments routes only (`GET`/`POST /test-generation-workflow/environments`, `PUT /test-generation-workflow/environments/:environmentId`).
  - Leave every other `requireCompletedWorkflow()` call unchanged.
  - Add a comment citing AP-032 FR-016 to FR-018.
- [X] T055 [US3] Add the provenance line in `backend/src/performance/report/renderHtmlReport.ts`: in `provenance(plan)`, when `plan.source === "quick"`, add "Plan built by the quick performance test from generated positive scenarios that were not reviewed.", escaped like the rest. Treat a missing `source` as `guided`.
- [X] T056 [US3] In `PerformancePlanScreen`, keep the environment panel working for both paths: `fetchEnvironments` from `frontend/src/services/environmentsClient.ts` is shared, and the value statuses and run use `client`. On `409 stage_not_active` from `fetchEnvironments`, show an `ErrorState` explaining that environments open once a quick test exists or Postman generation is complete, rather than an empty list (CLAUDE.md §39).
- [X] T057 [US3] Add one quick-path run to `backend/tests/integration/performance.k6.real.test.ts` (opt-in, `K6_TEST_REAL=1`): upload `quick-performance.yaml` through `/api/quick-performance`, set the values against the stub target, generate and run a smoke profile, and check the run completes with `planSource: "quick"`. Do not run it as part of `npm test`.

**Checkpoint**: A quick test runs end to end, and environments are shared with the guided workflow.

---

## Phase 6: User Story 4 - The guided workflow uses its own selection only (Priority: P2)

**Goal**: The guided Performance Testing stage has no scope choice. It always uses the API review's selection, or every operation when there is none, and never lists operations outside the selection as left out.

**Independent Test**: Complete a guided workflow with five of twenty operations selected. Check that the stage offers no scope choice, the plan has the five, none of the other fifteen is listed as left out, and the stage explains how to include others (quickstart 7).

### Tests for User Story 4 ⚠️

- [X] T058 [P] [US4] Extend `backend/tests/unit/performance/buildPlan.test.ts` (FR-022, FR-023, SC-005).
  - With `selectedOperationKeys` of 5 of 20, only those 5 are in journeys or `omitted`.
  - With no selection, every operation is in scope.
  - The plan has no `scope` property.
  - `planFingerprint` does not hash a `scope`.
- [X] T059 [P] [US4] Extend `backend/tests/integration/performance/planRoutes.test.ts`. `PUT /api/test-generation-workflow/performance/plan` with `{scope: "all"}` returns `400 invalid_request` and leaves the plan unchanged. The same body on `/api/quick-performance/plan` returns `400 invalid_request`.
- [X] T060 [P] [US4] Extend `frontend/tests/unit/PerformanceTestingStage.test.tsx`. No "API review selection" or "All analyzed operations" control is rendered. The note on widening the selection in API review or using the quick performance test is shown (US4 AS3). The write summary, markers and preview disclosure are present (US4 AS4).

### Implementation for User Story 4

- [X] T061 [US4] In `backend/src/performance/plan/buildJourneys.ts`, change `operationsInScope(context)` to take no `scope`, filtering by `context.selectedOperationKeys` when it is set. Drop the `scope` parameter of `buildJourneys`, and update its doc comment.
- [X] T062 [US4] In `backend/src/performance/plan/buildPlan.ts`, remove `scope` from:
  - `PlanChoices`;
  - `defaultChoices`, `assemblePlan`, `rebuildPlan` and `choicesOf`;
  - `planFingerprint`.

  Replace `operationsInScope(context, "all")` for the status pre-fill with a lookup over `context.apiModel.operations`.
- [X] T063 [US4] In `packages/shared-domain/src/performance.ts`, remove `PerformanceScope` and `PerformancePlan.scope`, and remove any index re-export. Fix every compile error:
  - `backend/tests/fixtures/performance/builders.ts`
  - `frontend/tests/unit/performanceFixtures.ts`
  - `frontend/src/services/performanceTestingClient.ts` (`PlanUpdate.scope`)
  - any other reference found with `grep -rn "scope" --include=*.ts` in the performance modules.

  Do not touch unrelated uses of the word "scope".
- [X] T064 [US4] In `backend/src/performance/plan/planUpdate.ts`, replace the `scope` branch with `throw new InvalidPlanUpdateError("The operations in scope follow the API review selection.")` whenever `"scope" in body`. It maps to `400 invalid_request`.
- [X] T065 [US4] In `frontend/src/components/performance/PerformanceTestingStage.tsx`, replace the scope radios in `scopeNote` with the text: "The plan covers the operations selected in API review, or every operation when none were selected. To include others, widen the selection in API review and regenerate, or use the quick performance test." (FR-023).
- [X] T066 [P] [US4] Check `backend/src/performance/report/renderHtmlReport.ts:154` ("A single operation in scope") and any other report text that reads `plan.scope`. Keep the wording where it only describes a journey, and remove any read of the field.

**Checkpoint**: The guided stage has no scope toggle, and the plan and its left-out list follow the selection.

---

## Phase 7: User Story 5 - Readable lists at real scale (Priority: P3)

**Goal**: Left-out, removed, write-operation and needs-status lists are counted, one operation per line with a method badge, and collapsed when longer than ten entries, on both paths.

**Independent Test**: Build a quick plan from `paypal-invoicing-v2.yaml`. Check the counted, collapsible lists and one-per-line rows, and that bulk removal works (quickstart 8).

### Tests for User Story 5 ⚠️

- [X] T067 [P] [US5] Add tests for `CountedOperationList` in `frontend/tests/unit/CountedOperationList.test.tsx`.
  - 30 entries render collapsed, with the summary "30 operations left out".
  - 10 entries render open.
  - Each row shows the method badge, the path and the reason, or a Restore button.
  - The disclosure works with the keyboard, using native `<details>`/`<summary>`.
  - With `collapseAbove={Infinity}`, 30 entries render as a plain list with no disclosure.
- [X] T068 [P] [US5] Extend the plan-screen test file used in T042. With more than ten steps needing an expected status, the needs-status list is counted, and activating a row moves focus to that step's expected-status editor.

### Implementation for User Story 5

- [X] T069 [US5] Create `frontend/src/components/performance/CountedOperationList.tsx` (research Q11). Props:
  - `label: (count: number) => string`;
  - `entries: {operationKey, method, path, detail?: ReactNode, action?: ReactNode}[]`;
  - `collapseAbove = 10` (`Infinity` renders a plain list with no disclosure);
  - `testId`.

  It renders a native `<details>` that is open when there are 10 entries or fewer, with a `<summary>` count, and one `<li>` per entry: `HttpMethodBadge`, monospace path, and the detail or action. Split `operationKey` into method and path at the first space.
- [X] T070 [US5] In `PerformancePlanScreen`, use `CountedOperationList` for:
  - the left-out list ("<n> operations left out", reason "No positive scenario");
  - the removed list (T037's reasons and Restore buttons);
  - the steps needing an expected status: each row is a button that focuses the step's editor. Add `id`s to the editors in `JourneyList.tsx`.

  In both `WriteOperationSummary` variants, use it with `collapseAbove={Infinity}`, so the write list keeps its one-per-line rows but never collapses (SC-002, T045).

**Checkpoint**: Every story is independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, version, contracts, and the definition of done (constitution XXXI).

- [X] T071 [P] Update `docs/USER_MANUAL.md`.
  - Add a new section after §4 (Import & Run Collection), "Quick performance test". Cover:
    - the entry and upload, with errors;
    - what is and is not generated;
    - login operations starting removed;
    - the write summary and bulk removal;
    - the request preview;
    - environments shared with the guided workflow;
    - running and the report's provenance line;
    - replacing a quick test;
    - Back to start;
    - restart behaviour.
  - Update §3.11 Performance Testing: the removed toggle and how to include other operations, the write summary, markers, preview and counted lists.
  - Renumber later sections if needed.
- [X] T072 [P] Update `docs/architecture.md`.
  - In the k6 performance testing section (around line 596), describe:
    - the plan-source adapter (`api/performanceRoutes.ts`) and its two sources;
    - `performance/quick/` (the store, scenario ids, `createQuickTest`);
    - `generatePositiveScenarios`;
    - the `stepRequestFor` shared by the renderer and the preview;
    - the `plan_source` column.
  - In the environments and persistence text, describe the environment access gate.
  - In the frontend architecture section, describe the third entry and `PerformancePlanScreen`.
- [X] T073 [P] Add a note under "Plan" in `specs/031-k6-performance-testing/contracts/performance-api.md`. It records that AP-032 removed `scope` (`PUT /plan` with `scope` now returns `400 invalid_request`), added `GET /plan/steps/:stepId/request`, `plan.source`, `credentialProducerOperationKeys` and `run.planSource`, and filtered `GET /runs` by source. Link to `specs/032-quick-performance-test/contracts/changes-to-existing-apis.md`. Do not rewrite AP-029's history.
- [X] T074 [P] Update `specs/ROADMAP.md`: record AP-032's status and the removal of AP-029 FR-001's scope choice, and close or update any Next Actions entry that refers to AP-032.
- [X] T075 Bump the version from 19.5.3 to 19.6.0 in the root `package.json`, `backend/package.json`, `frontend/package.json` and `packages/shared-domain/package.json`, and update `package-lock.json` through npm, for example `npm version 19.6.0 --workspaces --include-workspace-root --no-git-tag-version`. Confirm no git tag or commit was created.
- [X] T076 Security review of the diff. Check that:
  - no route returns an environment value;
  - the preview, script, template and report are covered by a seeded-secret scan (T018, T021);
  - no log event carries a filename or content;
  - the quick path imports no AI provider (grep `backend/src/performance/quick` and `backend/src/api/quickPerformance.ts` for `ai/`);
  - there is no route that accepts script content;
  - `POST /runs` is the only run start on both paths.

  Record the findings in the final summary.
- [X] T077 Run `npm test`, `npm run lint` and `npm run build` from the repository root, and fix every failure without weakening configuration or disabling tests. Report the exact results.
- [ ] T078 Walk through quickstart scenarios 1 to 8 in the browser (`npm run dev`, `npm run perf:stub -w backend`). Run scenario 9 (`npm run test:k6-real -w backend`) only when k6 is installed; otherwise state that it was not run. Record the outcomes in `specs/032-quick-performance-test/validation.md`, in the format of `specs/031-k6-performance-testing/validation.md`. Include the measured time from the start screen to a generated script for a specification of about 50 operations, against SC-001's 3 minutes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001 and T002 run in parallel.
- **Foundational (Phase 2)**: Depends on Phase 1 only for the tests that use the fixture. It blocks every story.
  - Order: T003, then T004 and T005; T006, then T007, then T008; then T009, then T010 and T011.
  - The frontend work runs in parallel with the backend: T012, then T013, then T014.
- **US1 (Phase 3)**: Depends on Phase 2.
- **US2 (Phase 4)**: Depends on Phase 2. It is independent of US1, and can be checked on the guided path, but its independent test uses the quick plan, so it is best done after US1.
- **US3 (Phase 5)**: Depends on US1 (it needs a quick test to exist: `hasQuickTest`, the quick router and the quick page).
- **US4 (Phase 6)**: Depends on Phase 2 only. It can run in parallel with US1 to US3, but T063 touches `performance.ts` and the fixtures, so merge it after the other edits to `performance.ts` (T028, T031, T044) to avoid conflicts.
- **US5 (Phase 7)**: Depends on T037 (US1) and T045 (US2) for the lists it replaces.
- **Polish (Phase 8)**: After every story. T075 to T078 run last, in order.

### Within Each User Story

- Tests first, and they must fail. Then shared types, then pure backend modules, then routes, then frontend services, then components, then pages.
- US1: T023, T024 and T025 are pure. T026 is the store. T027 feeds T028, which feeds T029. T030 feeds T031, which feeds T032. The frontend runs T033 and T034 in parallel, then T035, then T036 and T037, then T038, then T039.
- US2: T044, then T045, then T046 to T048.
- US3: T054 and T055 are independent. T056 needs T038.
- US4: T061, then T062, then T063, then T064. T065 and T066 are independent.

### Parallel Opportunities

- Phase 1: T001 and T002.
- Phase 2: the frontend chain (T012 to T014) runs alongside the backend chain (T005 to T011).
- US1 tests T015 to T022 all run in parallel. Implementation T024, T025, T033, T034 and T035 run in parallel.
- US2 tests T040 to T043, and T045 alongside T044 once the types exist.
- US3 tests T049 to T053, and T054 alongside T055.
- US4 tests T058 to T060, and T066 alongside T061 to T065.
- Polish: T071 to T074.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T015 generatePositiveScenarios tests in backend/tests/unit/testDesign/generatePositiveScenarios.test.ts"
Task: "T016 quick scenario id tests in backend/tests/unit/performance/quickScenarioIds.test.ts"
Task: "T018 request preview tests in backend/tests/unit/performance/requestPreview.test.ts"
Task: "T020 quick route tests in backend/tests/integration/performance/quickRoutes.test.ts"
Task: "T022 entry, quick page and preview tests in frontend/tests/unit/"

# Independent implementation pieces, together:
Task: "T024 generatePositiveScenarios in backend/src/testDesign/generateTestModel.ts"
Task: "T025 withQuickScenarioIds in backend/src/performance/quick/quickScenarioIds.ts"
Task: "T033 quickPerformanceClient in frontend/src/services/quickPerformanceClient.ts"
Task: "T034 third entry in frontend/src/components/EntryChooser.tsx"
Task: "T035 StepRequestPreview in frontend/src/components/performance/StepRequestPreview.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "T058 scope tests in backend/tests/unit/performance/buildPlan.test.ts"
Task: "T059 scope rejection tests in backend/tests/integration/performance/planRoutes.test.ts"
Task: "T060 stage without toggle in frontend/tests/unit/PerformanceTestingStage.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2. The guided path must be unchanged, and every existing test must pass.
2. Phase 3 (US1): from the start screen to a plan and a byte-identical script.
3. **Stop and validate**: quickstart 1 and 2, and `npm test`.

US1 alone cannot run a test (no environments) and does not yet show the write summary. The spec
ships US2 with US1 ("It ships with Story 1"), and US3 is needed to run. The first releasable
increment is therefore US1, US2 and US3 together.

### Incremental Delivery

1. Foundation, then US1, then US2 and US3: the releasable quick path (all P1 stories).
2. US4 (P2): removes the guided toggle. It can ship on its own.
3. US5 (P3): lists at scale.
4. Polish: docs, contract note, roadmap, version 19.6.0 and validation.

### Parallel Team Strategy

After Phase 2, one developer takes US1 then US3 (backend quick path, then environments and runs),
another takes US2 then US5 (frontend visibility and lists), and a third takes US4. US4's T063 is
merged last among the `performance.ts` edits.

---

## Notes

- [P] means a different file with no dependency on an incomplete task.
- Tests must fail before their implementation.
- Keep route handlers thin. Logic goes in `backend/src/performance/`, and shared rules in `packages/shared-domain/`.
- Do not change `backend/src/postman/` beyond exporting an existing helper if one is needed (AP-029 D3).
- Do not commit. Leave the changes in the working tree for review.
