---

description: "Task list for AP-029 k6 Performance Testing"
---

# Tasks: k6 Performance Testing (AP-029)

**Input**: Design documents from `specs/031-k6-performance-testing/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/performance-api.md](./contracts/performance-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Included. `.claude/CLAUDE.md` §51–53 treats tests as part of the feature, and SC-001,
SC-003, SC-006, SC-009, SC-011 and SC-015 are verified by tests. `npm test` must never need k6:
backend tests use the fake runner from T005, which replays NDJSON lines built by T004. Backend
tests get a fresh in-memory database from `backend/tests/setup/testDb.ts` and a session context
from `backend/tests/setup/sessionTestContext.ts`, both loaded globally. Frontend tests stub
`fetch` with `vi.stubGlobal("fetch", …)` as `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx`
does; there is no `vi.mock` of service modules and no MSW. Within each story, write the tests first
and confirm they fail.

**Organization**: Tasks are grouped by user story. `D#` refers to decisions in research.md.

**Code facts used below** (verified 2026-09-27; re-check a line number before relying on it):
- Stage ids and order: `packages/shared-domain/src/testGenerationWorkflow.ts:16` (`WorkflowStageId`)
  and `:29` (`WORKFLOW_STAGE_ORDER`). The workflow type is at `:279`.
- Stage machinery: `backend/src/testGenerationWorkflow/workflowStore.ts` (`updateStage` :164,
  `advanceActiveStage` :314, `patchWorkflow` :327, `GENERAL_TRANSITIONS` :112) and
  `workflowStages.ts` (`isStageEnterable` :24). Staleness is in `staleness.ts:10`.
- Router conventions: `backend/src/api/testGenerationWorkflow.ts`, which has
  `logRequestReceived`/`logRequestSucceeded`/`logRequestFailed` (:93–115),
  `requireCompletedWorkflow()` (:143, which requires `postmanGeneration` to be `complete`) and
  `toWorkflowResponse` (:198). `createApp(provider?, options?: CreateAppOptions)` is in
  `backend/src/app.ts:40`.
- Existing slot checks: `testGenerationWorkflow.ts:754-761` and `externalCollections.ts:464-472`.
- Run persistence to mirror: `backend/src/persistence/executionRunRepository.ts`. Every method takes
  an explicit `sessionId`, and there is `markInterruptedRunsCancelled()` at :228. The store wrapper
  is `backend/src/execution/executionRunStore.ts`, and `server.ts:65` does the restart marking.
- Session: `getSessionId()` (`backend/src/session/sessionContext.ts:25`, AsyncLocalStorage) and
  `runWithSession` (:16); `touch`/`onExpire`/`getStatus` in `backend/src/session/sessionRegistry.ts`.
- Environments: `getEnvironment(id)` (`backend/src/execution/environmentStore.ts:33`, returns
  decrypted `variableValues`). The routes are at `testGenerationWorkflow.ts:654/669/699`.
- Postman reuse (all already exported, D3): `planSchemeVariables`/`mapOperationAuth`
  (`postman/authMapping.ts`), `findCredentialProducers`, `buildAuthCredentialRelationships`,
  `resolveParameterStyle`/`serializeQueryParameter`/`serializeSimpleValue`/`percentEncode`
  (`postman/parameterSerialization.ts`), `pathParameterVariableName` and `BASE_URL_VARIABLE`
  (`postman/artifactVariables.ts`), and `compareCodeUnits` (`postman/ordering.ts`). The OAuth2 token
  request shape is in `postman/oauth2TokenFetch.ts:124`.
- Workflow driver for integration tests: `driveToPostmanGenerationComplete(agent)`
  (`backend/tests/fixtures/execution/driveWorkflow.ts:19`). It ends exactly at this stage's gate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 to US4 from spec.md
- Paths are repository-relative (`backend/`, `frontend/`, `packages/shared-domain/`)

---

## Phase 1: Setup

**Purpose**: Directories and test fixtures shared by every story.

- [X] T001 Create the empty directories `backend/src/performance/plan/`, `backend/src/performance/k6/`, `backend/src/performance/report/`, `backend/tests/unit/performance/`, `backend/tests/integration/performance/`, `backend/tests/fixtures/performance/` and `frontend/src/components/performance/`, each with a `.gitkeep` that is removed once the first file lands.
- [X] T002 [P] Create the fixture specification `backend/tests/fixtures/openapi/performance.yaml` (OpenAPI 3.0.3, title "Performance Fixture"). No existing fixture has an operation without a documented 2xx response, and quickstart.md's prerequisites need one. It contains:
  - an OAuth2 `clientCredentials` scheme `OrdersAuth` with `tokenUrl: /oauth/token`, applied globally;
  - `POST /orders`: a JSON body with a required `customerEmail` (`format: email`) and `quantity` (integer), and a `201` response with `orderId` (`format: uuid`);
  - `GET /orders/{orderId}`: `200`. With `POST /orders` it forms the create-then-read dependency workflow;
  - `GET /warehouses/{warehouseId}`: `200`. No operation produces `warehouseId`, so it is a user-supplied value (FR-013);
  - `GET /status`: documents only `default` and `503`, with no 2xx (FR-012a);
  - `POST /oauth/token` must not be declared as an operation.

  Add a header comment naming AP-029 and what each operation is for. Then confirm that the existing dependency analysis (`backend/src/dependencies/`) gives exactly one CONFIRMED or LIKELY workflow, `POST /orders` → `GET /orders/{orderId}`, carrying `orderId`. The resemblance to `body-heavy.yaml` does not prove it. If analysis finds none, or more than one, adjust the fixture (field names, response schema) until it gives exactly that one, because T029 and T031 depend on it. Record the check in a unit test in `backend/tests/unit/performance/performanceFixture.test.ts`.
- [X] T003 [P] Create `backend/tests/fixtures/performance/builders.ts` with shared builders:
  - `stepFixture(overrides)`, `journeyFixture(overrides)` and `planFixture(overrides)`. They return valid `PerformanceStep`/`PerformanceJourney`/`PerformancePlan` values (types from T006), with content-derived ids and one `200` expected status from the specification.
  - `environmentFixture(overrides)`: an `Environment` named `perf-local`, tier `local`, base URL `http://127.0.0.1:4600`, and `variableValues` holding the seeded secrets `SEEDED-SECRET-CLIENT-9f1c` (`clientSecret`) and `SEEDED-SECRET-ID-77ab` (`clientId`). SC-003 tests search every artifact for these two strings.
- [X] T004 [P] Create `backend/tests/fixtures/performance/ndjson.ts`. It builds k6 JSON-output lines deterministically, in the documented k6 `--out json` format (`{"type":"Point","metric":…,"data":{"time":ISO,"value":n,"tags":{…}}}`, plus `{"type":"Metric",…}` declaration lines):
  - `httpReq({step, journey, status, method, durationMs, atMs, errorCode?})` emits an `http_reqs` line and an `http_req_duration` line.
  - `vus(n, atMs)`, `check({step, passed, atMs})` and `counter(metric, tags, atMs)` cover `apipilot_missing_data`, `apipilot_cut_short`, `apipilot_not_attempted` and `apipilot_token_refresh`.
  - `tokenRefreshReq({atMs, status})` emits a request tagged `apipilot_kind: token-refresh` with no `step` tag.
  - `stream(lines)` joins the lines with `\n`.

  The real-k6 test (T078) confirms the format against a real binary.
- [X] T005 [P] Create `backend/tests/fixtures/performance/fakeRunner.ts`. It exports `createFakeRunner({lines, lineIntervalMs, exitCode?, holdUntilCancelled?})`, which implements the `PerformanceRunner` interface from T021. It emits the lines on `setTimeout` so tests can drive it with fake timers, records every `start` input (so tests can assert argv and environment), resolves `done` with `{exitCode}`, and on `cancel()` stops emitting and resolves `{exitCode: null, cancelled: true}`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Shared types, the new stage, persistence, the execution slot, configuration and the
router skeleton.

**⚠️ No user story work can start until this phase is complete.**

### Shared contracts

- [X] T006 Create `packages/shared-domain/src/performance.ts` with every type in data-model.md, and nothing else. Add a file header naming AP-029 and `specs/031-k6-performance-testing`. The file must not import Express, React, Node APIs or anything k6-specific.
  - Plan types: `PerformancePlan` (including `upstreamFingerprint` and `stepsNeedingExpectedStatus`), `OmittedOperation`, `PerformanceJourney`, `PerformanceStep`, `ScenarioChoiceReason`, `ExpectedStatus`, `StepAuth`, `LoadProfileKind`, `LoadProfile`, `LoadStage`, `PerformanceThreshold`, `UserSuppliedValueRequirement`, `UserSuppliedValueStatus` and `UniqueValueField`.
  - `ScriptStatus` is `{planFingerprint, scriptSha256, stepCount, outOfDate}`.
  - `K6Readiness` and `K6UnavailableReason`.
  - Run types: `PerformanceRunStatus`, `PerformanceRunCancelReason`, `PerformanceRunFailureCategory`, `PerformanceRun`, and `PerformanceRunSummary`. The summary is `PerformanceRun` without `planSnapshot`, `result` and `progress`, as the contract's `GET /runs` requires.
  - Result types: `PerformanceResult`, `JourneyResult`, `StepResult`, `LatencyPercentiles`, `FailureCategory`, `PerformanceFinding`, `PerformanceFindingRuleId` and `PERFORMANCE_FINDINGS_RULESET_VERSION = 1`.
- [X] T007 Export the module from `packages/shared-domain/src/index.ts` (`export * from "./performance";`) after the `failureAnalysis` export.
- [X] T008 In `packages/shared-domain/src/testGenerationWorkflow.ts`:
  - Add `"performanceTesting"` to `WorkflowStageId` and to `WORKFLOW_STAGE_ORDER` after `"execution"`.
  - Add `performancePlan?: PerformancePlan` to `TestGenerationWorkflow`, with a doc comment citing AP-029 and research D1.

  Then update the tests that pin the stage list: `packages/shared-domain/tests/unit/test-generation-workflow.test.ts:12` and `backend/tests/unit/testGenerationWorkflow/workflowStages.test.ts:25`.

### Stage wiring (D1, amended 2026-09-27)

- [X] T009 [P] Add unit tests to `backend/tests/unit/testGenerationWorkflow/workflowStages.test.ts`:
  - `isStageEnterable(workflow, "performanceTesting")` is true when `postmanGeneration` is `complete`, whether `execution` is `active`, `skipped` or `complete`.
  - It is false when `postmanGeneration` is anything else.
  - `nextStageId("execution")` is `"performanceTesting"`, and `nextStageId("performanceTesting")` is `undefined`.
- [X] T010 In `backend/src/testGenerationWorkflow/workflowStages.ts`:
  - Add the `performanceTesting` special case to `isStageEnterable`: enterable when `stages.postmanGeneration.status === "complete"`.
  - Correct `nextStageId`'s comment, which still names `postmanGeneration` as the last stage.

  `performanceTesting` uses `GENERAL_TRANSITIONS` in `workflowStore.ts`, so it needs no transition set of its own; confirm this with a test in `backend/tests/unit/testGenerationWorkflow/workflowStore.test.ts` (create it if absent) that `active → skipped` is rejected for it. Depends on T008 and T009.
- [X] T011 [P] In `frontend/src/components/workflowStageViewModel.ts`:
  - Add `performanceTesting: "Performance Testing"` to `STAGE_LABELS`.
  - Make `getLockReason("performanceTesting", workflow)` return `"Complete Postman Generation first"` when `postmanGeneration` is not `complete`, and nothing otherwise. `execution`'s status never locks it.

  Test both cases in `frontend/tests/unit/workflowStageViewModel.test.ts`, creating the file if it does not exist. Depends on T008.

### Persistence (D18, D20)

- [X] T012 [P] Write `backend/tests/unit/persistence/performanceRunRepository.test.ts`, using the global in-memory database. It covers:
  - create then get round-trips every field, including the `planSnapshot` and `result` JSON;
  - `listBySession` is newest first (`started_at DESC, rowid DESC`), and excludes `plan_snapshot` and `result`;
  - `getInProgress`;
  - `checkpoint(sessionId, runId, {progress, result})`;
  - `settle` with each status, `cancelReason` and `failure` category;
  - `requestCancel`;
  - `deleteBySession` removes only that session's runs;
  - `markInterruptedRunsCancelled()` turns every `in-progress` row into `cancelled`/`backend-restart` and leaves the others alone;
  - no column contains an environment's `variableValues` (build the run from `environmentFixture` and assert that neither seeded secret appears in any stored column).
- [X] T013 In `backend/src/persistence/connection.ts`'s `initializeSchema()`, add a `CREATE TABLE IF NOT EXISTS performance_runs (…)` block after `failure_analyses` (D20):
  - columns `id TEXT PRIMARY KEY`, `session_id`, `status`, `cancel_reason`, `failure_category`, `cancel_requested INTEGER`, `environment_snapshot`, `plan_snapshot`, `script_sha256`, `k6_version`, `planned_duration_ms`, `started_at`, `ended_at`, `progress`, `result`;
  - an index on `(session_id, started_at)`.

  Nothing in it is encrypted.
- [X] T014 Create `backend/src/persistence/performanceRunRepository.ts`, mirroring `executionRunRepository.ts`:
  - interface `PerformanceRunRepository` and class `SqlitePerformanceRunRepository`;
  - every method takes an explicit `sessionId`;
  - JSON columns use `JSON.stringify`/`JSON.parse`, and booleans are stored as 0/1;
  - `getPerformanceRunRepository()` is a singleton rebuilt when the connection changes.

  Depends on T006, T012 and T013.
- [X] T015 Create `backend/src/performance/performanceRunStore.ts`, mirroring `executionRunStore.ts`:
  - session-scoped wrappers that call `getSessionId()`: `getPerformanceInProgressRun()`, `createPerformanceRun(input)`, `getPerformanceRun(runId)` (throws `PerformanceRunNotFoundError`), `listPerformanceRuns()` and `requestPerformanceCancel(runId)`;
  - `onExpire(sessionId => repository.deleteBySession(sessionId))`.

  Background code must not use these wrappers; it calls the repository with a captured session id (T034). Put `PerformanceRunNotFoundError` in `backend/src/performance/errors.ts`. Depends on T014.
- [X] T016 In `backend/src/server.ts`, after the existing `markInterruptedRunsCancelled()` calls (:65–68) and before `createApp`:
  - call `getPerformanceRunRepository().markInterruptedRunsCancelled()`;
  - call `removeLeftoverRunDirectories()` from `backend/src/performance/k6/runDirectory.ts` (created in T066).

  Until T066 lands, add only the first call. Add an integration test to `backend/tests/integration/performance/restart.test.ts`: seed an `in-progress` run through the repository, invoke the same startup function `server.ts` uses (extract it into `backend/src/performance/startup.ts` as `recoverPerformanceRunsAtStartup()` if it is not already a function), then assert that the run is `cancelled` with `backend-restart` and that nothing was started (FR-032, SC-006). Depends on T014.

### Execution slot (FR-029, D18)

- [X] T017 [P] Write `backend/tests/integration/performance/executionSlot.test.ts`:
  - Seed an `in-progress` performance run for the test session through the repository.
  - `POST /api/test-generation-workflow/execution/start` returns `409 execution_in_progress` with that `runId`, and the uploaded-collection start route in `backend/src/api/externalCollections.ts` does too. Use the uploaded-collection integration fixtures under `backend/tests/integration/externalCollections/` to get a collection ready.
  - With no performance run in progress, both routes behave as before.
- [X] T018 Extend both inline slot checks: `testGenerationWorkflow.ts:754-761` becomes `getInProgressRun() ?? getUploadedInProgressRun() ?? getPerformanceInProgressRun()`, and `externalCollections.ts:464-472` gets the same addition. Keep each check synchronous and ahead of the existing work, including `resolveRunOrder` in the uploaded route. Depends on T015 and T017.

### Configuration and router skeleton

- [X] T019 [P] Create `backend/src/performance/config.ts` with `resolveK6BinaryPath(env = process.env): string | undefined`. It returns the trimmed `K6_BINARY_PATH`, or `undefined` when that is empty or unset, mirroring `backend/src/persistence/config.ts`. Add a commented-out `# K6_BINARY_PATH=` entry with a `#` comment block to the root `.env.example`: optional; the path to a k6 1.0.0 or later that you installed; ApiPilot never downloads k6; when unset, the first `k6` on `PATH` is used. Unit test it in `backend/tests/unit/performance/config.test.ts`.
- [X] T020 Create `backend/src/performance/scriptStore.ts`, the backend-only store for generated scripts (data-model "Generated script"). It keeps a per-session `Map<sessionId, {workflowId, script: GeneratedScript}>` and exports:
  - `getGeneratedScript()`, which returns `undefined` when the stored `workflowId` differs from the current workflow's id;
  - `setGeneratedScript(script)`;
  - `clearGeneratedScript()`.

  It is cleared through `onExpire`. Define the `GeneratedScript` type here, not in shared-domain. Unit test it in `backend/tests/unit/performance/scriptStore.test.ts`.
- [X] T021 Create `backend/src/performance/k6/runnerTypes.ts`, containing only the interface:
  - `PerformanceRunner = {start(input: RunnerStartInput): RunnerHandle}`;
  - `RunnerStartInput = {runDir, scriptPath, binaryPath, env: Record<string, string>, onLine(line: string): void, onStderrLine(line: string): void}`;
  - `RunnerHandle = {cancel(): void, done: Promise<{exitCode: number | null, cancelled: boolean}>}`.

  The fake runner (T005) and the real one (T032) both implement it.
- [X] T022 Create `backend/src/api/performanceTesting.ts` with `createPerformanceTestingRouter(deps: PerformanceTestingDependencies = defaultPerformanceDependencies())`:
  - `deps` is `{runner: PerformanceRunner, probeReadiness: () => Promise<K6Readiness>, now: () => Date}`;
  - a local `requirePostmanGenerationComplete()` responds `409 {error: "postman_generation_incomplete", message}`;
  - use the same `logRequest*` helpers as `testGenerationWorkflow.ts` (export them from there if they are not exported).

  Routes are added per story. Mount it in `backend/src/app.ts` next to the workflow router (`app.use("/api", …)`), and add `performance?: Partial<PerformanceTestingDependencies>` to `CreateAppOptions` so integration tests can inject the fake runner and a fixed readiness. Depends on T006 and T021.

**Checkpoint**: The stage exists and is gated on Postman generation, runs persist and share the
execution slot, and the router is mounted. User stories can start.

---

## Phase 3: User Story 1 — Build a performance test from approved scenarios and workflows (Priority: P1) 🎯 MVP

**Goal**: From the approved test model and workflows, build an editable plan (scope, removal,
expected statuses, load profile, thresholds, user-supplied values per environment) and generate a
byte-identical k6 script and environment template with no secrets, downloadable with no k6
installed.

**Independent Test**: With no k6 installed, take `performance.yaml` through Postman Generation and
open the stage. Check the selected scenarios, the journey order, the user-supplied values, and the
`GET /status` step listed as needing an expected status. Then set that status and generate twice:
the scripts are byte-identical, and neither the script nor the template contains either seeded
secret.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T023 [P] [US1] Write `backend/tests/unit/performance/selectScenario.test.ts` (FR-002, FR-003, FR-005, D4):
  - only `positive` scenarios in `approvedTestModel` are considered;
  - `RULE` is preferred over `AI`, then the lowest id by `compareCodeUnits` (include ids where `localeCompare` would disagree);
  - the reasons are `rule-generated`, `only-positive` and `ai-enhanced-no-rule-alternative`, and `tieBrokenByLowestId` is set only when there was a tie;
  - an operation with no positive scenario yields `no-positive-scenario`.
- [X] T024 [P] [US1] Write `backend/tests/unit/performance/buildJourneys.test.ts` (FR-006, D5):
  - each approved workflow becomes one journey (workflows in id order, steps in `position` order);
  - the remaining operations become single-step journeys ordered by method then path in code-unit order;
  - an operation in two workflows appears in both;
  - `dependency.confidence` is `LIKELY` if any of the step's incoming relationships is `LIKELY`, and `CONFIRMED` otherwise (workflows carry no confidence of their own; it is read from `dependencyAnalysis.graph` relationships by `relationshipIds`);
  - journey and step ids are content-derived and stable across calls;
  - an operation the user excluded appears in no journey.
- [X] T025 [P] [US1] Write `backend/tests/unit/performance/userSuppliedValues.test.ts` (FR-013, D6):
  - `performance.yaml` yields `baseUrl` (`base-url`), `clientId` and `clientSecret` (`oauth2-client`, secret) and `warehouseId` (`path-parameter`, not secret). The name is whatever `pathParameterVariableName("/warehouses/{warehouseId}", "warehouseId")` returns; it returns `warehouseId`, because the parameter already names its resource. Assert against the function's result, not a hard-coded guess;
  - `orderId` is not listed, because `POST /orders` produces it;
  - the list is sorted by name, and `neededBySteps` is in plan order;
  - `valueStatuses(requirements, environment)` returns `present` booleans only. `baseUrl` is present when `environment.baseUrl` is non-empty. The result never contains a value: assert that neither seeded secret appears in its JSON.
- [X] T026 [P] [US1] Write `backend/tests/unit/performance/uniqueValueFields.test.ts` (FR-016, D13): `POST /orders`'s `customerEmail` is listed as `{location: "body", fieldPath: "customerEmail", format: "email"}`. `uuid` fields in POST bodies are listed. Other formats, other methods, and fields named like emails but without the format are not.
- [X] T027 [P] [US1] Write `backend/tests/unit/performance/expectedStatuses.test.ts` (FR-012, D26):
  - the pre-fill is every exact 2xx code plus `2XX`, in code-unit order, and never `default` or a non-2xx code;
  - `GET /status` pre-fills to `[]`;
  - `applyExpectedStatuses(step, ["201","200","201"])` deduplicates and sorts, marking each code `specification` or `user` against the pre-fill set;
  - the client can never set `source`;
  - an empty list, `"600"`, `"2xx"`, `"20"` and an unknown step id are rejected with `invalid_expected_status`;
  - `stepsNeedingExpectedStatus` lists empty steps in plan order.
- [X] T028 [P] [US1] Write `backend/tests/unit/performance/loadProfiles.test.ts` and `planUpdate.test.ts` (FR-017, FR-018, FR-019):
  - the five starting profiles match data-model.md's table exactly;
  - `plannedDurationMs` is the sum of the stage durations;
  - validation rejects zero stages, a duration of 0 or less, and a negative target (`invalid_load_profile`);
  - 100,000 virtual users and a 48-hour stage are accepted with no warning;
  - threshold validation (`invalid_threshold`) rejects latency of 0 or less, an error rate outside 0 to 100, and an unknown step;
  - the plan starts with no thresholds;
  - removing an operation (`excludedOperationKeys`) with an unknown key gives `unknown_operation`.
- [X] T029 [P] [US1] Write `backend/tests/unit/performance/buildPlan.test.ts`:
  - `buildPlan` over the `performance.yaml` model, with every scenario accepted and its discovered workflow approved (build the inputs with the existing analysis and generation functions, as `driveToPostmanGenerationComplete` does through the routes), has one two-step journey (`POST /orders` → `GET /orders/{orderId}`) and two single-step journeys, in that order (`GET /status`, `GET /warehouses/{warehouseId}`);
  - `fingerprint` is identical across two builds, changes when any plan field or expected status changes, and ignores `stepsNeedingExpectedStatus`;
  - `upstreamFingerprint` changes when the approved scenario ids, approved workflow ids or selection change;
  - `rebuildPlan(previous, …)` keeps the load profile, the thresholds and the expected statuses of steps that still exist, and recomputes their sources (D26).
- [X] T030 [P] [US1] Write `backend/tests/unit/performance/renderScript.test.ts` (FR-011, FR-020, FR-021, D7, D8, D11, D13, D14, D25, D26):
  - **Golden file:** the rendered script and template for the `performance.yaml` plan match `backend/tests/fixtures/performance/golden/script.js` and `environment-template.json`. Rendering twice gives byte-identical output (SC-001, 10 renders).
  - **No secrets:** neither seeded secret appears in the script or the template, even when the environment holds them (SC-003).
  - **Imports:** only `k6`, `k6/http` and `k6/metrics` are imported; any other `import` or a URL import fails the test.
  - **Tags:** `options.systemTags` is exactly `["status", "method", "error_code", "check", "group"]` (no `url`, no `name`), and each request carries `tags: {step, journey}`.
  - **Values:** they are read only as `__ENV.APIPILOT_V_<index>`, with indexes assigned by name in code-unit order. The name-to-index map is in the script, and no `-e`/`--env` usage appears.
  - **Iteration:** the default function is the plan's journeys in order, each in its own block. A failed extraction adds 1 to `apipilot_cut_short` and moves on to the next journey. Extracted values are reset between journeys.
  - **Missing value:** an absent `__ENV` value adds 1 to `apipilot_missing_data` with `{step, variable}`, sends nothing, and adds 1 to `apipilot_not_attempted` for each dependant in the journey.
  - **Status check:** each step's expected statuses are a constant, and the check matches exact codes and `NXX` ranges.
  - **Unique values:** `customerEmail` gets `+vu${__VU}-it${__ITER}` in its local part.
  - **Encoding:** the embedded percent-encoding helper, evaluated with `new Function`, agrees with `postman/parameterSerialization.ts`'s `percentEncode` on a fixture set of reserved, unicode and space characters (FR-011).
  - **Response bodies:** a step with no `produces` uses `responseType: "none"`, and a producer uses `"text"`.
  - **Auth (FR-009):** every token is acquired once in `setup()`, and each setup request is tagged `apipilot_kind: token-setup` with no `step` tag. The cases are:
    - **OAuth2 client credentials** (`performance.yaml`): a `POST` to the scheme's `tokenUrl`, resolved against the base URL when relative and used as-is when absolute (as `oauth2TokenFetch.ts` does), with `grant_type=client_credentials` and basic auth from `__ENV`.
    - **Chained login:** with `flagshipTokenApiModel` from `backend/tests/fixtures/postman/credentialFixtures.ts`, the token producer operation from `findCredentialProducers` runs in `setup()`, and its extracted token is applied to the consuming steps' scheme.
    - **Distinct per-role credentials (AP-021):** with an API model that has two schemes, each scheme gets its own credential variables (the `planSchemeVariables` stems) and its own `setup()` token, and each step uses the scheme `mapOperationAuth` gives it.
  - **Matches Postman (FR-011):** for each step, the method, the URL path and query (with `{{baseUrl}}` and the `__ENV` values substituted by the same fixed test values) and the headers other than auth match the item `generateCollection` (`backend/src/postman/generateCollection.ts:353`) produces for the same scenario. Evaluate the script's request-building function with `new Function` over a stubbed `k6/http`.
- [X] T031 [P] [US1] Write `backend/tests/integration/performance/planRoutes.test.ts` (contract "Plan" and "Script"), with `createApp(undefined, {performance: {runner: fakeRunner, probeReadiness: unavailable}})` and `request.agent(app)`:
  - before Postman generation, every plan and script route returns `409 postman_generation_incomplete`;
  - after `driveToPostmanGenerationComplete`, `GET /plan` returns the proposed plan, moves the stage to `active`, and sets `activeStageId`;
  - `PUT /plan` updates each field;
  - each validation error returns its code and leaves the plan unchanged;
  - `POST /plan/reset` behaves as in D26;
  - `GET /plan/values?environmentId=` gives presence booleans, and `404 environment_not_found` for an unknown id; create the environment through `POST /environments`;
  - `POST /script` returns `422 expected_status_missing {stepIds: [<GET /status step>]}` until that step is set, then `200` with a stable `scriptSha256`, and moves the stage to `complete`;
  - a `PUT /plan` that changes the fingerprint marks `script.outOfDate` and moves the stage back to `active`;
  - `GET /script/download?file=script|environment-template` returns the right content type and `Content-Disposition`, `404 script_not_generated` before generation, and `409 script_out_of_date` after an edit;
  - re-finalizing workflow review rebuilds the plan on the next `GET /plan` (upstream fingerprint);
  - `GET /api/test-generation-workflow` includes `performancePlan` and never the script text;
  - no response body contains either seeded secret.
- [X] T032 [P] [US1] Write `frontend/tests/unit/performanceTestingClient.test.ts` for T046: each function's success mapping, the `{ok: false, error, message}` mapping of an error body (including the `stepIds` extra on `expected_status_missing` and `variable` on `dependency_order_violation`), and `network_error` on a thrown fetch.
- [X] T033 [P] [US1] Write `frontend/tests/unit/PerformanceTestingStage.test.tsx` for T047 to T052, stubbing `fetch`:
  - the plan renders each journey and step with `HttpMethodBadge`, the scenario and its reason, and the expected statuses, each labelled "from specification" or "set by you" in text;
  - the `GET /status` step shows "needs an expected status", and **Generate script** is disabled with that reason given in text;
  - after the status is set, **Generate script** is enabled;
  - removing an operation sends `excludedOperationKeys`;
  - choosing the **load** profile shows its stages as editable number inputs;
  - no threshold is shown until one is added;
  - the values checklist for the chosen environment shows each value's name, the steps that need it, "secret" when it is one, and "missing" or "present" as text (never colour alone);
  - **Download script** and **Download environment template** are shown once a current script exists, and an out-of-date script shows "Out of date — regenerate";
  - loading, empty and error states are distinct (CLAUDE.md §39).

### Implementation for User Story 1

- [X] T034 [P] [US1] Create `backend/src/performance/plan/selectScenario.ts` with `selectPerformanceScenario(scenarios, operation): {scenario, reason, tieBrokenByLowestId} | {omitted: "no-positive-scenario"}` (D4). It takes the operation's `positive` scenarios from the approved model, prefers `provenance.source === "RULE"`, then compares ids with `compareCodeUnits`. It has no k6-specific imports, so the Postman follow-up (ROADMAP Next Actions #30) can reuse it. Depends on T023.
- [X] T035 [P] [US1] Create `backend/src/performance/plan/buildJourneys.ts` (D5). It reads the approved workflows as `approvedWorkflowIds` plus `dependencyAnalysis.workflows`, and takes their relationships' confidence from `dependencyAnalysis.graph`. Content-derived ids use SHA-256 in the `backend/src/postman/identifiers.ts` style: `journeyId = hash("performance-journey", workflowId | "op:" + operationKey)` and `stepId = hash("performance-step", journeyId + " " + operationKey)`. Depends on T024.
- [X] T036 [P] [US1] Create `backend/src/performance/plan/userSuppliedValues.ts` with `listUserSuppliedValues(plan inputs)` and `valueStatuses(requirements, environment)` (D6). It uses `pathParameterVariableName`, `BASE_URL_VARIABLE`, and `planSchemeVariables(apiModel.securitySchemes)` for the credential and `oauth2` client variable names. A name is `secret` when it is a credential or OAuth2 client variable. Depends on T025.
- [X] T037 [P] [US1] Create `backend/src/performance/plan/uniqueValueFields.ts` (D13). Walk the POST request-body schema for `format: email`/`uuid` string fields and emit dotted `fieldPath`s in code-unit order. Depends on T026.
- [X] T038 [P] [US1] Create `backend/src/performance/plan/expectedStatuses.ts` with `prefillExpectedStatuses(operation)`, `applyExpectedStatuses(step, codes, prefill)` and `stepsNeedingExpectedStatus(plan)` (D26). Validation errors are a typed `InvalidExpectedStatusError {stepId}` in `backend/src/performance/errors.ts`. Depends on T027.
- [X] T039 [P] [US1] Create `backend/src/performance/plan/loadProfiles.ts`, with `STARTING_PROFILES` from data-model.md and `validateLoadProfile`, and `backend/src/performance/plan/planUpdate.ts`, with `applyPlanUpdate(plan, update, context)`. The update applies `scope`, `excludedOperationKeys`, `loadProfile`, `thresholds` and `expectedStatuses`. `journeyOrder`, `stepOrder` and `thinkTimeMs` are added in US4 (T087). Every field is validated before any is applied, so a rejected update changes nothing. Threshold ids are content-derived. The typed errors (`InvalidLoadProfileError`, `InvalidThresholdError`, `UnknownOperationError`) go in `errors.ts`. Depends on T028.
- [X] T040 [US1] Create `backend/src/performance/plan/buildPlan.ts` with:
  - `buildPlan(workflow): PerformancePlan`: scope `selection` when `selectedOperationKeys` is set, otherwise `all`; think time 0; the `smoke` profile; no thresholds;
  - `rebuildPlan(previous, workflow)`;
  - `planFingerprint(plan)`: SHA-256 over canonical JSON with keys sorted in code-unit order, covering every field except `fingerprint`, `upstreamFingerprint` and `stepsNeedingExpectedStatus`, plus the ids of the scenarios and workflows used;
  - `upstreamFingerprint(workflow)`.

  Log `performance_plan_built {journeyCount, stepCount}` only (D23). Depends on T034 to T039 and T029.
- [X] T041 [US1] Create `backend/src/performance/k6/renderScript.ts` with `renderScript(plan, apiModel, approvedTestModel): {script, environmentTemplate, valueIndex}`, rendering exactly what T030 asserts:
  - fixed header comment: AP-029, "generated by ApiPilot; do not edit — only the unmodified script can be run from ApiPilot", and the plan fingerprint. No timestamp.
  - `options` with `stages` and `systemTags`.
  - `setup()` for OAuth2 and chained-login tokens (FR-009).
  - one block per journey.
  - static request parts serialized at render time with `resolveParameterStyle`/`serializeQueryParameter`/`serializeSimpleValue`; runtime values encoded with the embedded helper.
  - expected-status constants, the extraction checks, and the missing-data and cut-short logic.
  - unique values.

  Every string literal goes through one `jsString()` escaper. The environment template is JSON with every value name mapped to `""`, keys in code-unit order, and a trailing newline. Leave think time (US4) and per-virtual-user refresh (US2, T063) out, but give the renderer an internal step-epilogue hook so they plug in without reshaping it. Add the golden files from T030 once they have been reviewed by hand for secrets and determinism. Depends on T040 and T030.
- [X] T042 [US1] Add the plan routes to `backend/src/api/performanceTesting.ts` (contract "Plan"):
  - **`GET /plan`:**
    - builds the plan on first call, or rebuilds it when `upstreamFingerprint` differs;
    - stores it with `patchWorkflow({performancePlan})`;
    - on the first entry, calls `advanceActiveStage("performanceTesting")`; from `stale` it moves to `active`. This side effect is part of the contract (`GET /plan`, "Stage transitions"); the frontend therefore calls `GET /plan` only when the user opens the stage, never to pre-fetch.
  - **`PUT /plan`:**
    - runs `applyPlanUpdate`;
    - when the fingerprint changes while the stage is `complete`, calls `updateStage("performanceTesting", "active")`.
  - **`POST /plan/reset`.**
  - **`GET /plan/values`:** uses `getEnvironment` and `valueStatuses`.

  Map each typed error to the contract's status and code. Responses return `{plan, script: ScriptStatus | null}`, with `ScriptStatus` computed from `scriptStore`. Depends on T040, T020, T022 and T031.
- [X] T043 [US1] Add the script routes to `backend/src/api/performanceTesting.ts` (contract "Script"):
  - **`POST /script`:**
    - returns `422 nothing_to_test` or `422 expected_status_missing {stepIds}`;
    - otherwise runs `renderScript` and stores `{planFingerprint, scriptSha256, environmentTemplateSha256, script, environmentTemplate, stepCount, valueIndex}` in `scriptStore`;
    - calls `updateStage("performanceTesting", "complete")`;
    - logs `performance_script_generated {sha256Prefix: first 12 hex, stepCount}`.
  - **`GET /script/download`:**
    - `file=script` is `text/javascript; charset=utf-8` with `filename="apipilot-performance.js"`;
    - `file=environment-template` is `application/json` with `filename="apipilot-performance-environment.json"`.

  Depends on T041 and T042.
- [X] T044 [US1] Confirm that `toWorkflowResponse` (`backend/src/api/testGenerationWorkflow.ts:198`) passes `performancePlan` through unchanged and that no path returns the script text. Add the assertion to T031 if it is not there. Depends on T042.
- [X] T045 [US1] Make T023 to T031 pass (`backend/tests/unit/performance/`, `backend/tests/integration/performance/`). Run `npm test -w backend -- performance` and `npm test -w packages/shared-domain`.
- [X] T046 [P] [US1] Create `frontend/src/services/performanceTestingClient.ts`. Use file-local `get`/`putJson`/`postJson` helpers and a `createLogger("performanceTestingClient")` in the style of `frontend/src/services/testGenerationWorkflowClient.ts`, with per-call result unions `{ok: true, …} | PerformanceErrorResult` (`{ok: false, error, message, stepIds?, variable?, runId?, readiness?}`). The functions are `fetchPlan`, `updatePlan`, `resetPlan`, `fetchValueStatuses(environmentId)`, `generateScript`, and `scriptDownloadUrl(file)`, which returns the download route's URL for an `<a download>`. The run and report functions are added in US2 and US3. Depends on T032.
- [X] T047 [P] [US1] Restore the environment UI removed in commit 32930ed:
  - Recover `EnvironmentForm.tsx` with `git show 32930ed^:frontend/src/components/EnvironmentForm.tsx`, and the environment functions of `executionClient.ts` (`fetchEnvironments`, `createEnvironment`, `updateEnvironment`).
  - Place the functions in a new `frontend/src/services/environmentsClient.ts` that follows the current client conventions, and place the form in `frontend/src/components/EnvironmentForm.tsx`.
  - Update its styling to the current AP-027 tokens and `BUTTON_STYLES` from `components/controlStyles.ts`. Secret variable values are entered in password inputs and are never echoed back.
  - Add `frontend/src/components/performance/EnvironmentPicker.tsx` (a labelled `<select>` of environments showing name, a text tier label via `StatusBadge` with `TIER_TONE` from `ExternalCollectionList.tsx`, and base URL; plus "New environment" and "Edit values" actions opening `EnvironmentForm` in a `Dialog`).
  - Test them in `frontend/tests/unit/EnvironmentForm.test.tsx` and `EnvironmentPicker.test.tsx`.
- [X] T048 [P] [US1] Create `frontend/src/components/performance/JourneyList.tsx`:
  - journeys as sections, each with a semantic table of steps: order, `HttpMethodBadge`, path in monospace, scenario and choice reason, dependency and confidence, auth method, and required values;
  - a **Remove operation** action per step.

  Reorder controls are added in US4 (T089).
- [X] T049 [P] [US1] Create `frontend/src/components/performance/ExpectedStatusEditor.tsx`:
  - per step, the codes as chips with a text source label ("from specification" / "set by you"), an input for adding a code, and remove buttons;
  - client-side format hints only; the server validates.
- [X] T050 [P] [US1] Create `frontend/src/components/performance/LoadProfileEditor.tsx` and `frontend/src/components/performance/ThresholdEditor.tsx`:
  - **Load profile:**
    - a profile `<select>` and a table of stages with number inputs for duration (seconds) and target virtual users, plus add and remove stage;
    - the planned duration is shown;
    - no maximum and no warning (FR-019).
  - **Thresholds:** rows of scope (run or step), metric, `<=` and limit; empty by default, with "No thresholds set" as text.
- [X] T051 [P] [US1] Create `frontend/src/components/performance/ValuesChecklist.tsx`. It takes `UserSuppliedValueStatus[]` and the chosen environment and shows a table of name, needed-by steps, secret, and a status as text plus a `StatusBadge`. Its **Edit values in <environment>** action opens `EnvironmentForm`. A missing value is explained as "not sent; the step will be reported as missing data" (FR-014).
- [X] T052 [US1] Create `frontend/src/components/performance/PerformanceTestingStage.tsx`:
  - it loads the plan on mount;
  - it composes `JourneyList`, `ExpectedStatusEditor`, `LoadProfileEditor`, `ThresholdEditor`, `EnvironmentPicker` and `ValuesChecklist`;
  - it shows `plan.omitted` with reasons and the `stepsNeedingExpectedStatus` list;
  - it has **Generate script**, the download links and the out-of-date state;
  - it uses `Skeleton` for loading, `ErrorState` for errors and `EmptyState` for a plan with no steps;
  - it keeps no business rules in JSX: status labels come from a small typed view-model in `frontend/src/components/performance/performanceViewModel.ts`.

  Depends on T046 to T051.
- [X] T053 [US1] Wire the stage into `frontend/src/pages/TestGenerationWorkflowPage.tsx`:
  - add `{displayStageId === "performanceTesting" && <PerformanceTestingStage …/>}` next to the execution block (:646);
  - exempt it from the read-only notice as `postmanGeneration` is exempt (:550–568);
  - pass `onAdvanced={handleAdvanced}` so stage status changes refresh the workflow.

  In `frontend/src/components/WorkflowStageTracker.tsx`, make the `performanceTesting` badge clickable to open the stage when `getLockReason` returns nothing, even while it is `not-yet-reached`. Confirm that `maybeHandoff` (:192) never fires once `activeStageId` is `performanceTesting`. Extend `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx` and `TestGenerationWorkflowAccessibility.test.tsx` to cover the new stage. Depends on T052 and T011.
- [X] T054 [US1] Make T032 and T033 pass (`frontend/tests/unit/`), and run `npm test -w frontend`.

**Checkpoint**: US1 works on its own with no k6: plan, edit, generate, download (quickstart 1).

---

## Phase 4: User Story 2 — Run the test from within ApiPilot and follow its progress (Priority: P2)

**Goal**: Show k6 readiness. On the user's explicit trigger, which names the environment, run the
unmodified script with the user-installed k6. Show live progress, allow cancelling, keep partial
results, share the execution slot, keep the session alive, and refresh tokens per virtual user.

**Independent Test**: With the fake runner (automated), or with k6 and the stub target (quickstart
3, 4, 7, 8): a run starts only on the trigger, progress updates, cancel stops it, and the run is
still listed after a restart. Nothing starts on its own.

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [X] T055 [P] [US2] Write `backend/tests/unit/performance/readiness.test.ts` (FR-027, D9), with an injected `execFile`:
  - `k6 v1.2.3 (…)` → `ready` with `1.2.3`;
  - `v0.49.0` → `unsupported-version` with `found 0.49.0, need ≥ 1.0.0`;
  - unparsable output → `version-unreadable`;
  - `ENOENT` → `not-found`;
  - `EACCES` → `not-executable`;
  - a 5-second timeout is passed, with no shell;
  - `K6_BINARY_PATH` is preferred over `PATH`, and the binary path never appears in the returned object;
  - the result is cached briefly and `recheck` bypasses the cache.
- [X] T056 [P] [US2] Write `backend/tests/unit/performance/runnerArgs.test.ts` (D7, D10):
  - `buildK6Args(runDir)` equals `["run", "--no-usage-report", "--quiet", "--no-color", "--out", "json=<runDir>/metrics.ndjson", "<runDir>/script.js"]`;
  - `buildChildEnv(processEnv, values)` contains only `PATH`, the platform temp and home variables (`SystemRoot`/`TEMP`/`TMP` on Windows, `HOME`/`TMPDIR` on POSIX) and `APIPILOT_V_<n>`, so no other backend variable (seed `APIPILOT_TEST_BACKEND_ONLY=x`) and no `.env` value leaks;
  - no value appears in the args.
- [X] T057 [P] [US2] Write `backend/tests/unit/performance/metricsStream.test.ts` (D11):
  - `parseMetricsLine` accepts T004's `Point` and `Metric` lines;
  - it ignores unknown metrics;
  - it returns `undefined` for a blank line;
  - it rejects malformed JSON as an unreadable line;
  - `LineSplitter` joins lines split across chunk boundaries.
- [X] T058 [P] [US2] Write `backend/tests/unit/performance/aggregate.test.ts` and `histogram.test.ts` (FR-012a, FR-030, FR-036, FR-036a, D11, D14, D25):
  - **Histogram:** p50/p90/p95/p99 are within 1% of exact values over three distributions, and the output is deterministic.
  - **Classification:** it is against each step's `expectedStatuses`, from the run's `planSnapshot`:
    - an expected 401 is not a failure;
    - an unexpected 401/403 is `authentication`;
    - 429 is `rate-limited`;
    - status 0 with `error_code` 1050 is `timeout`;
    - status 0 with any other `error_code` is `connection-error`;
    - any other unexpected status is `unexpected-status`;
    - `2XX` matches 204.
  - **Excluded counts:** `missing-data`, `extraction-failed` and `dependency-not-attempted` come from the custom counters, never counted as responses. Token-refresh requests (no `step` tag) never enter any step's figures.
  - **Journeys:** `runsCutShort` per journey, and `totals.journeysCutShort`.
  - **Write requests:** sent and succeeded per operation and method.
  - **Token refreshes (FR-015, SC-013):** `tokenRefreshes` is built from `apipilot_token_refresh` points by their `outcome` tag:
    - `ok` counts into `count`;
    - `failed` counts into both `count` and `failed`;
    - a `no-lifetime` point sets `lifetimeStated: false` (otherwise `true`);
    - `bucketOffsetsMs` holds each refresh's timeline bucket offset, sorted and deduplicated.

    Every refresh point in the input appears in the counts (100%).
  - **Progress (FR-030, amended 2026-09-27):** `progress(nowMs)` returns a `RunProgress`: `requestsSoFar`, `currentVirtualUsers`, `failuresSoFar`, `journeysCutShortSoFar`, `tokenRefreshesSoFar`, and per step `requests`, `failures` and `notSent` (`missingData`, `dependencyNotAttempted`) in plan order. After the last line, the progress totals equal `toResult`'s totals.
  - **Timeline:** buckets are `max(5 s, planned/200)`, with at most 200 points.
  - **Memory:** the aggregate's size does not grow with the request count (feed 100,000 requests and compare the serialized size with 1,000).
- [X] T059 [P] [US2] Write `backend/tests/unit/performance/runner.test.ts` for `backend/src/performance/k6/runner.ts`, with injected `spawn`, `execFile` and `fs`:
  - the integrity check re-reads the written script and aborts with `script-integrity-failed` before spawning on a mismatch;
  - `spawn` is called with `shell: false`, `cwd: runDir` and the T056 args and env;
  - lines appended to `metrics.ndjson` are delivered through `onLine` by tailing from the last offset;
  - **Cancel on POSIX:** `SIGINT`, then `SIGKILL` after 5 s if the process has not exited.
  - **Cancel on Windows:** `execFile("taskkill", ["/pid", pid, "/T", "/F"])`.
  - **Spawn failure:** a `spawn` `error` event with `ENOENT` or `EACCES` (k6 removed or made unusable after the readiness probe) resolves `done` with `{exitCode: null, cancelled: false, spawnError: "not-found" | "not-executable"}`. It never throws.
  - the run directory is created with mode `0o700` under `os.tmpdir()/apipilot-k6/<runId>`, and removed on settle.
- [X] T060 [P] [US2] Write `backend/tests/integration/performance/runRoutes.test.ts` (contract "Runs", FR-024 to FR-032, FR-034a; SC-006, SC-007, SC-008), using the fake runner, fake timers and `driveToPostmanGenerationComplete`:
  - **Pre-run checks:** the five `POST /runs` checks, in order, each return their code.
  - **Start:** the run starts only on `POST /runs`. Generating a script, `GET /plan`, and a simulated restart start nothing, and `runner.start` is never called otherwise.
  - **Recorded start input:** the fake runner's recorded env holds `APIPILOT_V_<n>` values from the environment, and the recorded args hold none.
  - **No blocking:** there is no confirmation for a `production` environment (FR-025), and a missing value does not block (FR-014).
  - **Progress:** `GET /runs/:id` shows a full `RunProgress` (including the per-step figures) within one poll, and it updates as lines arrive.
  - **Cancel:** it returns `202`. The run settles `cancelled`/`user-requested` with the results measured so far, and `409 run_not_in_progress` afterwards.
  - **Results:** a completed run has `result`. `GET /runs` is newest first, with no `result`.
  - **Slot:** a second trigger returns `409 execution_in_progress`.
  - **Failure:** an unreadable stream settles `failed`/`metrics-unreadable`, and a fake-runner spawn error settles `failed`/`k6-unavailable`.
  - **Gate during a run (C2):** start a run, then re-finalize workflow review so that `postmanGeneration` becomes `stale`. `GET /runs`, `GET /runs/:id`, `POST /runs/:id/cancel` and, once settled, `GET /runs/:id/report` all still work, and the cancel stops the run. A new `POST /runs` returns `409 postman_generation_incomplete`.
  - **Session keep-alive:** with a run in progress past the 60-minute idle timeout (use `sessionRegistry`'s `sweepForTest` with an advanced clock), `getStatus(sessionId)` stays `live`. After the run ends, the idle timeout counts from the last tick.
  - **No leaks:** no response and no log line contains a seeded secret, a resolved URL or the binary path.
- [X] T061 [P] [US2] Write `frontend/tests/unit/PerformanceRunPanel.test.tsx` for T069, with fake timers as in `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx:465`:
  - k6 unavailable disables the trigger and shows the reason, with **Check again** calling `?recheck=true`;
  - the trigger reads "Run on perf-local (local)" with the base URL and the load-origin statement next to it;
  - the configured stages are shown exactly as entered;
  - an out-of-date script disables the trigger with the reason;
  - progress polling every 2 s shows elapsed against planned time, virtual users, requests, failures, journeys cut short and token refreshes, plus the "Progress by step" table (requests, failures, and not sent with the reason as text);
  - **Cancel run** sends the cancel and shows "Cancelling…";
  - a `409 execution_in_progress` shows "Another run is in progress";
  - the environment's name, tier (as text) and base URL stay visible throughout the run.

### Implementation for User Story 2

- [X] T062 [P] [US2] Create `backend/src/performance/k6/readiness.ts` with `probeK6Readiness({recheck}, deps = {execFile, env, now})`: `execFile(binary, ["version"], {timeout: 5000, shell: false, windowsHide: true})`, where the binary is `resolveK6BinaryPath()` ?? `k6` (`k6.exe` on win32). It parses `k6 vX.Y.Z` and requires ≥ 1.0.0, and caches the result for 30 s for `GET /readiness` only. `recheck: true` always probes again, and `POST /runs` always passes it (T068). It logs `k6_readiness {state, version | reason}`. Depends on T055 and T019.
- [X] T063 [US2] Extend `backend/src/performance/k6/renderScript.ts` with per-virtual-user token refresh (FR-015, D12):
  - Each virtual user keeps `{value, acquiredAtMs, lifetimeS}` per scheme, starting from `setup()`'s data. Before a step that needs the token, it refreshes when `Date.now() - acquiredAtMs >= lifetimeS * 1000 * (0.70 + 0.01 * ((__VU - 1) % 11))`.
  - The refresh request is tagged `apipilot_kind: token-refresh` with no `step` tag, and adds to `apipilot_token_refresh` with `{outcome: "ok" | "failed"}`. A failed refresh keeps the old token.
  - When `expires_in` is absent, the token is never refreshed, and the script adds 1 to `apipilot_token_refresh` with `{outcome: "no-lifetime"}` once in `setup()`.

  Add the cases to T030's test, update the golden file, and review the diff by hand. Depends on T041.
- [X] T064 [P] [US2] Create `backend/src/performance/k6/metricsStream.ts` (`parseMetricsLine` and `LineSplitter`) and `backend/src/performance/report/histogram.ts` (a log-linear histogram with ratio 1.02 over 0.01 ms to 10 min, plus underflow and overflow, where `percentile(p)` returns the bucket's geometric midpoint). Depends on T057 and T058.
- [X] T065 [US2] Create `backend/src/performance/report/aggregate.ts` with `createAggregate(planSnapshot, plannedDurationMs, runStartMs)`, which returns `{ingest(point), progress(nowMs), toResult(endMs)}`. It builds everything in T058, including `tokenRefreshes`, except `thresholdOutcomes` and `findings`: `toResult` leaves them empty, and T079 fills them. Depends on T064 and T058.
- [X] T066 [US2] Create `backend/src/performance/k6/runDirectory.ts` (`createRunDirectory(runId)` with mode 0700, `removeRunDirectory(runId)`, and `removeLeftoverRunDirectories()` for everything under `os.tmpdir()/apipilot-k6/`) and `backend/src/performance/k6/runner.ts` (`createK6Runner(deps)` implementing `PerformanceRunner`: argv and env from T056, `spawn` with `shell: false`, tailing `metrics.ndjson` by polling reads every 500 ms from the last offset, stderr lines counted by category and never logged verbatim, and cancel per T059). Complete T016's second call. Depends on T021, T056 and T059.
- [X] T067 [US2] Create `backend/src/performance/runPerformanceTest.ts` with `startPerformanceRun({sessionId, run, script, environment, valueIndex, deps})`, which returns `void` and never throws:
  - It writes the script to the run directory, re-reads it and compares the SHA-256; a mismatch settles `failed`/`script-integrity-failed` and k6 is never spawned (FR-026).
  - It builds the env from `valueIndex` and the environment: `baseUrl` from `environment.baseUrl`, and other names from `variableValues`; an absent name is not set.
  - It feeds every line into the aggregate, and every 2 s (the tick) checkpoints `{progress, result}` through the repository with the captured `sessionId` and calls `touch(sessionId)` (FR-034a, D18).
  - A cancel request is polled from the repository on each tick and calls `handle.cancel()`.
  - On exit it settles `completed`, `cancelled` (`user-requested`) or `failed`, with these failure categories:
    - `k6-unavailable` when the runner reports a `spawnError` (the binary disappeared or became unusable after the pre-run probe; data-model state transition "k6 missing at spawn");
    - `k6-exited-with-error` when the exit is non-zero with no points;
    - `metrics-unreadable` after more than 10 unreadable lines.

    It then removes the run directory, and logs `performance_run_started`/`performance_run_settled`/`performance_run_failed` with only the D23 fields.

  It uses the repository directly with the captured session id, never `getSessionId()`, because the child process's callbacks are not guaranteed to keep AsyncLocalStorage context. Depends on T065 and T066.
- [X] T068 [US2] Add the run routes to `backend/src/api/performanceTesting.ts`:
  - **`GET /readiness`:** accepts `?recheck=true`.
  - **`POST /runs`:**
    - runs the contract's five checks in order: the stage gate, script current, readiness probed now with `probeReadiness({recheck: true})` (never the cached result), `getEnvironment`, then the slot check `getInProgressRun() ?? getUploadedInProgressRun() ?? getPerformanceInProgressRun()`;
    - the slot check and `createPerformanceRun` run synchronously, with no `await` between them;
    - it captures `getSessionId()` and calls `startPerformanceRun` without awaiting it, with a `.catch` backstop log;
    - the run stores the environment snapshot (`{id, name, tier, baseUrl}` only), `planSnapshot`, `scriptSha256`, `k6Version` and `plannedDurationMs`.
  - **`GET /runs`, `GET /runs/:runId`, `POST /runs/:runId/cancel`:** cancel returns `202`. These routes, and `GET /readiness`, are not stage-gated: a run already started stays visible and cancellable even if an upstream revision makes `postmanGeneration` stale (contract "Stage gating", SC-008).

  Default dependencies: `createK6Runner()` and `probeK6Readiness`. Depends on T062, T067 and T060.
- [X] T069 [US2] Add `fetchReadiness(recheck)`, `startRun(environmentId)`, `fetchRuns`, `fetchRun(runId)` and `cancelRun(runId)` to `frontend/src/services/performanceTestingClient.ts`. Then create `frontend/src/components/performance/PerformanceRunPanel.tsx`:
  - **Readiness:** a `StatusBadge` with the reason as text, and **Check again**.
  - **Before the run:**
    - the trigger button labelled `Run on <name> (<tier>)`, with the base URL beside it;
    - the statement "Load is generated from the machine running the ApiPilot backend." (FR-028);
    - the configured stages, and each step's method visible in the plan above.
  - **During the run:**
    - poll every 2 s with chained `setTimeout` cleared on unmount, as `ExternalCollectionRunPanel.tsx:703–715` does;
    - show elapsed against planned time with the stage boundaries, the five counters (virtual users, requests, failures, journeys cut short, token refreshes) and a "Progress by step" table (step, requests, failures, not sent with its reason), as in the approved mock-up's run screen (FR-030);
    - **Cancel run**;
    - the environment header stays visible throughout.
  - **Run history:** a list of runs with status as text.

  Mount it in `PerformanceTestingStage.tsx` below the plan. Depends on T061 and T052.
- [X] T070 [US2] Make T055 to T061 pass (`backend/tests/unit/performance/`, `backend/tests/integration/performance/`, `frontend/tests/unit/`). Run `npm test -w backend -- performance` and `npm test -w frontend`.

**Checkpoint**: US1 and US2 work: a run can be triggered, followed, cancelled and recovered
(quickstart 2, 3, 4, 7, 8, with k6).

---

## Phase 5: User Story 3 — Understand the result through an explainable report (Priority: P3)

**Goal**: Evaluate thresholds, produce deterministic findings, and render a self-contained,
escaped, CSP-locked HTML report with provenance. Present it automatically in a sandboxed frame and
offer it as a download.

**Independent Test**: From a stored run result (no live target): the report has every metric and
provenance field, two renders are identical, it contains no secret, body or resolved URL, and it
makes no external reference.

### Tests for User Story 3 ⚠️ (write first, confirm they fail)

- [X] T071 [P] [US3] Write `backend/tests/unit/performance/thresholds.test.ts` (FR-018, FR-037, D15):
  - run-scoped and step-scoped thresholds for each metric are evaluated from the aggregate with `<=`, and a boundary equal to the limit passes;
  - with no thresholds, `thresholdOutcomes` is `[]`;
  - thresholds are never rendered into the k6 script (assert against T041's output).
- [X] T072 [P] [US3] Write `backend/tests/unit/performance/findings.test.ts` (FR-038, D16):
  - each of the nine rules fires on a crafted result and stays silent otherwise;
  - the rules come out in the fixed order, and ties are broken by step order;
  - messages are fixed text built from `values`;
  - two runs over the same result give deep-equal findings (SC-011);
  - no message contains a resolved URL or a value.
- [X] T073 [P] [US3] Write `backend/tests/unit/performance/renderHtmlReport.test.ts` (FR-035 to FR-040, D17; SC-004, SC-010):
  - **Structure:** the output is a full HTML document with the exact CSP `<meta>`.
  - **No external references:** no `src=`/`href=` to `http`, `//` or a relative path, and no `<script>` or `<link>`.
  - **Escaping:** a path template containing `<img onerror>` is escaped.
  - **Deterministic:** two renders are byte-identical.
  - **Per step:** p50/p90/p95/p99 (marked "within 1%"), throughput, errors by status and category, check pass rate, write requests per operation and method, and token refreshes.
  - **Provenance per step:** dependency and confidence, scenario and reason, variable sources, auth method, and expected statuses with each code's source.
  - **Run details:** load profile, thresholds (or "No thresholds were set"), environment name, tier and base URL, k6 version, and script hash.
  - **Charts:** a timeline SVG.
  - **Light and dark:** styles through `prefers-color-scheme`.
  - **Nothing sensitive:** neither seeded secret and no request or response body appears. Steps are identified by method and path template only.
- [X] T074 [P] [US3] Write `backend/tests/integration/performance/reportRoutes.test.ts`:
  - `GET /runs/:id/report` returns `text/html; charset=utf-8` for a settled run, and `?download=true` adds `Content-Disposition` with `apipilot-performance-<runId>.html`;
  - the displayed and downloaded bodies are byte-identical;
  - `409 run_in_progress` and `404 run_not_found`;
  - a cancelled run's report shows the partial results.
- [X] T075 [P] [US3] Write `frontend/tests/unit/PerformanceReportFrame.test.tsx`:
  - when a polled run settles, the report is fetched and shown in an `<iframe>` whose `sandbox` attribute is present and empty, with `srcDoc` set and an accessible `title`;
  - **Download report** links to `?download=true`;
  - a report fetch error shows `ErrorState`, not an empty frame.

### Implementation for User Story 3

- [X] T076 [P] [US3] Create `backend/src/performance/report/thresholds.ts` with `evaluateThresholds(plan.thresholds, result)`. Depends on T071.
- [X] T077 [P] [US3] Create `backend/src/performance/report/findings.ts` with `deriveFindings(result, planSnapshot)` implementing D16's nine rules in order. Depends on T072.
- [X] T078 [P] [US3] Create `backend/src/performance/report/renderHtmlReport.ts` with `renderHtmlReport(run: PerformanceRun): string`:
  - one `escapeHtml` used for every interpolated string;
  - inline CSS with light and dark palettes that use the same colour roles as the app's tokens, plus a text label beside every status colour;
  - server-computed inline SVG for the timeline (virtual users, p95 and errors over time) and for per-step p95 bars;
  - the CSP `<meta>` from D17;
  - numbers formatted with a fixed locale-free formatter (no `toLocaleString`).

  Depends on T073.
- [X] T079 [US3] Call `evaluateThresholds` and `deriveFindings` in `runPerformanceTest.ts` when the result is settled (completed or cancelled) and on each checkpoint. Store `findingsRulesetVersion` and `latencyPrecision: "within-1-percent"`. Add `GET /runs/:runId/report` to `backend/src/api/performanceTesting.ts`, which renders on request from the stored run, as D17 says. Depends on T076 to T078 and T074.
- [X] T080 [US3] Add `fetchReport(runId)` (returns the HTML text) and `reportDownloadUrl(runId)` to the client. Create `frontend/src/components/performance/PerformanceReportFrame.tsx` (`<iframe sandbox="" srcDoc={html} title="Performance report for run …">`, with a height that fills the panel and the frame's own scrolling), plus **Download report**. In `PerformanceRunPanel.tsx`, present it automatically when a run settles (FR-035) and on selecting a past run. Add a comment on the `<iframe>` that it is the app's first embedded HTML, that `sandbox=""` grants no permissions, and that the HTML is server-rendered, escaped and CSP-locked (security-relevant, D17). Depends on T075 and T069.
- [X] T081 [US3] Make T071 to T075 pass (`backend/tests/unit/performance/`, `backend/tests/integration/performance/reportRoutes.test.ts`, `frontend/tests/unit/PerformanceReportFrame.test.tsx`).

**Checkpoint**: US1 to US3 work: the report is presented and downloadable (quickstart 5, 6).

---

## Phase 6: User Story 4 — Adjust the journey order and pacing (Priority: P4)

**Goal**: Reorder steps within a journey and reorder journeys, rejecting any reorder that breaks a
producer-before-consumer dependency by naming the variable. Set a think time between steps.

**Independent Test**: Moving `GET /orders/{orderId}` above `POST /orders` is rejected, naming
`orderId`. Swapping two single-step journeys is kept in the regenerated script. A 2-second think
time pauses between steps.

### Tests for User Story 4 ⚠️ (write first, confirm they fail)

- [X] T082 [P] [US4] Write `backend/tests/unit/performance/validateOrder.test.ts` (FR-007, D5; SC-009):
  - every proposed step order that places a consumer before its producer is rejected with the first broken variable in the workflow's variable order, `{variable, producerStepId, consumerStepId}`;
  - credential chains (consumer location `auth`) count;
  - a non-permutation gives `invalid_order`;
  - any permutation of journeys is valid.
  - Enumerate every permutation of a three-step workflow and assert that 100% of the invalid ones are rejected with a variable name.
- [X] T083 [P] [US4] Extend `backend/tests/unit/performance/renderScript.test.ts`:
  - `thinkTimeMs: 2000` renders `sleep(2)` after each step that sent a request, except the iteration's last request, including across a journey boundary;
  - a skipped step adds no pause;
  - journey order in the script follows `plan.journeys`;
  - update the golden file with a think-time variant.
- [X] T084 [P] [US4] Extend `backend/tests/integration/performance/planRoutes.test.ts`:
  - `PUT /plan {stepOrder}` that breaks `orderId` returns `400 dependency_order_violation {variable: "orderId", …}`, and the plan is unchanged;
  - `{journeyOrder}` swapping two journeys is kept and marks the script out of date;
  - `{thinkTimeMs: -1}` returns `400 invalid_load_profile`.
- [X] T085 [P] [US4] Extend `frontend/tests/unit/PerformanceTestingStage.test.tsx`:
  - ↑/↓ controls with `aria-label="Move <METHOD path> up/down"` on steps and journeys send the new order;
  - a `dependency_order_violation` shows a message naming the variable, with the order unchanged on screen;
  - the think-time input sends `thinkTimeMs`.

### Implementation for User Story 4

- [X] T086 [P] [US4] Create `backend/src/performance/plan/validateOrder.ts` with `validateStepOrder(journey, proposedStepIds, workflow)` and `validateJourneyOrder(plan, proposedJourneyIds)`. The typed errors are `DependencyOrderViolationError {variable, producerStepId, consumerStepId}` and `InvalidOrderError`. Depends on T082.
- [X] T087 [US4] Extend `backend/src/performance/plan/planUpdate.ts` with `journeyOrder`, `stepOrder` and `thinkTimeMs` (0 or more, an integer number of ms), validated with T086 before anything is applied. Map the new errors in `performanceTesting.ts`. Depends on T086 and T084.
- [X] T088 [US4] Plug think time into `renderScript.ts`'s step-epilogue hook: `sleep(thinkTimeMs / 1000)` from `k6`, rendered as a fixed decimal literal. Depends on T083.
- [X] T089 [US4] Add ↑/↓ reorder buttons for steps and journeys to `frontend/src/components/performance/JourneyList.tsx`, styled like `RunOrderRowActions` (`frontend/src/components/ExternalCollectionRunPanel.tsx:535`, `ROW_ACTION_STYLE`) with an `aria-live` announcement of the new position, and disabled at the ends. Add a think-time number input (seconds) to `PerformanceTestingStage.tsx`. The server decides validity: the UI sends the order and shows the rejection. Depends on T085.
- [X] T090 [US4] Make T082 to T085 pass (`backend/tests/unit/performance/`, `backend/tests/integration/performance/planRoutes.test.ts`, `frontend/tests/unit/PerformanceTestingStage.test.tsx`).

**Checkpoint**: All four stories work.

---

## Phase 7: Polish & cross-cutting concerns

- [X] T091 [P] Add optional `port?: number` to `start()` in `backend/tests/fixtures/execution/targetServer.ts` (default `0`, so existing tests are unchanged). Create `backend/scripts/perfStubTarget.ts`. It starts a `TargetServer` on `127.0.0.1:4600` (or `PERF_STUB_PORT`), configured for `performance.yaml`:
  - `POST /oauth/token` → `200 {access_token: "stub-token", token_type: "Bearer", expires_in: 300}`;
  - `POST /orders` → `201 {orderId: "00000000-0000-4000-8000-000000000001"}`;
  - `GET /orders/00000000-0000-4000-8000-000000000001` → `200`;
  - `GET /warehouses/<any configured id>` → `200`;
  - `GET /status` → `200`.

  It prints the request count every 5 s, which quickstart 4 uses. Add `"perf:stub": "tsx scripts/perfStubTarget.ts"` to `backend/package.json`, and update quickstart.md's prerequisites to name `performance.yaml` and this script.
- [X] T092 Create `backend/tests/integration/performance.k6.real.test.ts`. It is gated by `describe.runIf(process.env.K6_TEST_REAL === "1")`, mirroring `backend/tests/integration/localProvider.real.test.ts`, and uses the real `createK6Runner` and `probeK6Readiness` against an in-process `TargetServer`. It asserts quickstart 9's five checks:
  - the version gate accepts the installed version;
  - the args include `--no-usage-report`;
  - the stream parses, with no `url` tag in any line;
  - cancel stops k6 within 10 s;
  - a 5 s `expires_in` token is refreshed per virtual user during a 20 s, 3-virtual-user run, with refreshes out of step metrics.

  It also confirms T004's line format and the `error_code` 1050 timeout mapping against a stub route whose `delayMs` exceeds the request timeout. Add `"test:k6-real": "cross-env K6_TEST_REAL=1 vitest run --root . tests/integration/performance.k6.real.test.ts"` to `backend/package.json`. Confirm that `npm test` skips it.
- [ ] T093 Run `npm run test:k6-real -w backend` on a machine with k6 1.0.0 or later installed. Record the k6 version, OS, date and results in a new `specs/031-k6-performance-testing/validation.md`. If k6 is not available, write that there explicitly and leave this task unchecked; do not invent results (constitution XXXI). Depends on T092.

  *Completion note (2026-09-27): not run, left unchecked.* No k6 binary was installed on the
  implementation machine, and ApiPilot never installs one. `specs/031-k6-performance-testing/validation.md`
  records this and how to run it. The test itself (T092) exists and is skipped by `npm test`.
- [X] T094 Run a security review of the diff and record the result in this task's completion note:
  - grep `backend/src/performance/` for logging of `script`, `environmentTemplate`, `variableValues`, `value`, `token`, `url`, `baseUrl` or stderr text (only the D23 fields may be logged);
  - confirm there is no `shell: true`, no `exec(` with a string, and no value in argv;
  - confirm that no route accepts script content;
  - confirm that the child environment is the T056 allow-list;
  - confirm that 5xx responses are `{error: "internal_server_error"}` only;
  - confirm that the report has escaping plus CSP and the frame has `sandbox=""`;
  - confirm that there is no network call in `backend/src/performance/` other than the k6 child;
  - confirm that the run directory mode is 0700 and it is removed on settle and at startup.

  *Completion note (2026-09-27):*
  - Logging: only D23 fields (`performance_plan_built`, `performance_script_generated` with a
    12-character hash prefix, `k6_readiness`, `performance_run_started`/`settled`/`failed`, plus
    `performance_run_stderr` with a line count and `performance_startup_recovery` with counts).
    No script, template, value, variable name, token, URL or k6 output text is logged.
  - No `shell: true` and no string `exec`; the only `exec(` matches are regular expressions. No
    value is ever in argv (`runnerArgs` test).
  - No route accepts script content: `PUT /plan` is validated by `applyPlanUpdate`, and
    `POST /runs` reads only `environmentId`.
  - The child environment is the T056 allow-list (`buildChildEnv` test).
  - Unknown errors are rethrown to the central handler, which returns
    `{error: "internal_server_error"}` only.
  - The report escapes every string and carries the CSP; the frame is `sandbox=""` (tests).
  - No network call in `backend/src/performance/` other than the k6 child; no AI import.
  - Run directories are created 0700 (the script file 0600) and removed on settle and at startup.
  - Existing behaviour noted, not changed: AP-017's `GET /environments` returns decrypted variable
    values to the browser. The restored `EnvironmentForm` keeps them in password inputs, but they
    are still present in the page. A follow-up could return presence only.
- [X] T095 [P] Update `docs/USER_MANUAL.md` with a new section on performance testing:
  - where the stage is and when it opens (after Postman generation);
  - building and editing the plan, expected statuses, and user-supplied values in environments;
  - installing k6 yourself and `K6_BINARY_PATH`;
  - the run trigger, with no confirmation on any tier, that write operations are included, and that nothing is cleaned up;
  - progress, cancel and the report;
  - limitations: per-virtual-user token refresh cost, 1% percentile precision, no schema checks under load, and the Postman scenario-choice divergence;
  - troubleshooting rows for each k6 readiness reason and for `expected_status_missing`.
- [X] T096 [P] Update `docs/architecture.md` with the `performance/` module and its `plan`/`k6`/`report` boundaries, the stage, the `performance_runs` table, the child-process runner and its constitution XVII v2.3.0 exception conditions, the execution slot, and the sandboxed report frame. Add `K6_BINARY_PATH` to the README configuration table.
- [X] T097 [P] Add a dated note to `specs/018-test-execution-results/spec.md` under FR-007: AP-029 performance runs deliberately use no staging or production confirmation (`specs/031-k6-performance-testing` FR-025), and functional runs are unchanged. Add a dated note to the AP-017 execution contract under `specs/018-test-execution-results/contracts/`, at `execution/start`, that a performance run in progress also occupies the slot (FR-029). Match each file's existing amendment-note style.
- [X] T098 Bump the version with `npm run version:bump -- feature` (this updates root, backend, frontend and shared-domain together; 19.4.1 becomes 19.5.0 if nothing has shipped since). Then run `npm install` so `package-lock.json` is updated by npm, not by hand. Update `specs/ROADMAP.md`:
  - the status paragraph, which currently says AP-029 is "awaiting `/speckit-plan`";
  - the AP-029 status row;
  - a new Next Actions entry recording the version, what shipped, the validation figures from T099, and any open tasks.

  Use "Implemented" only if T093 and the quickstart pass were both done; otherwise, "Implementation complete — real-k6 validation pending" (constitution XXXI). Update `README.md`'s AP-029 line to match.
- [ ] T099 Run `npm test`, `npm run lint` and `npm run build` at the repository root, and fix everything they report. Then run quickstart.md scenarios 1 to 8 manually with k6 installed and `npm run perf:stub -w backend`. Record which scenarios were run in this task's completion note, and state explicitly any that could not be.

---

## Dependencies & execution order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup, and blocks every story.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational and on US1's script and plan (T041 to T043, T052). Running needs a generated script.
- **US3 (Phase 5)**: depends on US2's aggregate and run records (T065, T067, T069). Report unit tests (T071 to T073, T076 to T078) can start as soon as T006 and T065's result shape exist.
- **US4 (Phase 6)**: depends only on US1 (T039, T041, T048). It can run in parallel with US2 and US3.
- **Polish (Phase 7)**: T091 any time after T002. T092 and T093 need US2. T094 to T099 come last.

### Key task dependencies

- T006 → T007, T008 → T009 → T010; T008 → T011
- T012, T013 → T014 → T015 → T016, T018 (T017 first)
- T021 → T022, T005
- T023 to T028 → T034 to T039 → T040 (T029) → T041 (T030) → T042 → T043 → T044
- T046 to T051 → T052 → T053
- T041 → T063
- T064 → T065; T066 → T067 → T068 → T069
- T076, T077, T078 → T079 → T080
- T086 → T087; T083 → T088; T085 → T089
- T092 → T093 → T098; T099 last

### Within each story

Write the tests first and confirm they fail. Then build the pure modules (`plan/`, render, parse,
aggregate, report), then the orchestration, then the routes, then the client, then the UI.

---

## Parallel examples

### Setup and Foundational

```text
T002 fixture spec | T003 builders | T004 NDJSON builder | T005 fake runner
T009 stage tests  | T011 frontend stage label | T012 repository test | T017 slot test | T019 config
```

### User Story 1

```text
Tests:   T023 select | T024 journeys | T025 values | T026 unique | T027 statuses | T028 profiles | T029 plan | T030 render | T031 routes | T032 client | T033 stage
Modules: T034 | T035 | T036 | T037 | T038 | T039   (then T040 → T041)
UI:      T046 client | T047 environments | T048 journeys | T049 statuses | T050 profile/thresholds | T051 values
```

### User Story 2

```text
Tests:   T055 readiness | T056 args | T057 stream | T058 aggregate | T059 runner | T060 routes | T061 panel
Modules: T062 readiness | T064 stream+histogram   (then T065, T066 → T067 → T068)
```

### After US1: US4 in parallel with US2

```text
Developer A: T055–T070 (US2), then T071–T081 (US3)
Developer B: T082–T090 (US4)
```

---

## Implementation strategy

### MVP (User Story 1)

1. Phases 1 and 2.
2. Phase 3 (US1). Stop and validate with quickstart scenario 1. No k6 is needed.
3. The MVP already gives a reviewed, deterministic, secret-free k6 script that the user can run
   outside ApiPilot. Running it inside ApiPilot (US2) is what the constitution's XVII exception is
   for, and it is added only after US1 is correct.

### Incremental delivery

1. Foundation, then US1 (plan and script).
2. Then US2 (readiness, run, progress, cancel, restart, keep-alive, token refresh).
3. Then US3 (thresholds, findings, report).
4. US4 (reorder and think time) at any point after US1.
5. Then Polish (the real-k6 check, security review, documentation, version bump, full validation).

---

## Notes

- `[P]` means different files with no dependency on an incomplete task.
- Where this file departs from the plan's source tree, it adds files rather than changing the
  design:
  - `plan/planUpdate.ts`, `scriptStore.ts`, `k6/runnerTypes.ts`, `k6/runDirectory.ts`,
    `report/histogram.ts`, `config.ts`, `errors.ts` and `startup.ts`;
  - `frontend/src/services/environmentsClient.ts` and `EnvironmentForm.tsx`, restored because the
    frontend has had no environments UI since commit 32930ed, and FR-013 keeps values in
    environments.
- The stage gate is Postman generation, not Workflow Review (research D1, amended 2026-09-27 by user
  decision), so the existing environments routes can be used unchanged.
- Do not commit. The user reviews and commits every change (see the project memory).
- Never claim a validation command passed unless it was run (CLAUDE.md §54).


  *Completion note (2026-09-27): automated part done, manual part not run, left unchecked.*
  - `npm test`: 246 files passed and 3 skipped (the two opt-in real-model files and the opt-in
    real-k6 file); 1,847 tests passed and 5 skipped.
  - `npm run lint`: clean. `npm run build`: succeeds for backend, frontend and shared-domain.
  - Quickstart scenarios 1 to 8 were **not** walked through: no browser tool and no k6 were
    available. The Supertest and React Testing Library suites cover the same behaviour, which is
    not a substitute for the manual pass.