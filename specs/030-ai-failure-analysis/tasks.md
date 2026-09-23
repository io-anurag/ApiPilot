---

description: "Task list for AP-031 AI Failure Analysis"
---

# Tasks: AI Failure Analysis (AP-031)

**Input**: Design documents from `specs/030-ai-failure-analysis/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/failure-analysis-api.md](./contracts/failure-analysis-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Included. `.claude/CLAUDE.md` §51-53 treats tests as part of the feature, and SC-003 must
be verified by tests. Tests use scripted `AIProvider` object literals for realistic model output,
as `backend/tests/unit/testDesign/enhanceTestModel.test.ts:19` does, because `MockProvider` returns
only a hash. Backend tests get a fresh in-memory database from `backend/tests/setup/testDb.ts`.
Within each story, write the tests first and confirm they fail.

**Organization**: Tasks are grouped by user story. `D#` refers to decisions in research.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3 from spec.md
- Paths are repository-relative (`backend/`, `frontend/`, `packages/shared-domain/`)

---

## Phase 1: Setup

**Purpose**: Scaffolding shared by every story.

- [ ] T001 Create the empty module and test directories `backend/src/failureAnalysis/`, `backend/tests/unit/failureAnalysis/`, `backend/tests/integration/failureAnalysis/` and `backend/tests/fixtures/failureAnalysis/`, each with a `.gitkeep` that is removed once the first file lands.
- [ ] T002 [P] Create `backend/tests/fixtures/failureAnalysis/fixtures.ts` with builders that later tests share:
  - `failedResult(overrides)` returns an `UploadedRequestResult` (outcome `failed`, `assertion-failed`, one failed `testOutcomes` entry, status 500).
  - `connectivityFailure()` returns a `connectivity-failure` with no response and no test outcomes.
  - `withRawCapture(result, capture)` returns the result with a `RawRequestCapture` whose request carries `Authorization: Bearer abc.def.ghi`, a URL `?api_key=SECRET1&page=2`, a JSON body `{"user":"u","password":"SECRET2"}` and a JSON response body.
  - `scriptedProvider(contents: string[] | ((req) => string))` returns an `AIProvider` literal (mode `local`, ready, `getInputBudget` undefined) that returns each content in turn with `modelId: "test-model"`, calls `hooks?.onStarted?.()`, and records every `InferenceRequest` it receives.
  - `failingProvider(category)` returns `status: "error"` with the given `AIErrorCategory`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Contracts, provider support, persistence and specification-context matching. Every
story's analysis payload depends on these.

**⚠️ No user story work can start until this phase is complete.**

### Shared contracts

- [ ] T003 Create `packages/shared-domain/src/failureAnalysis.ts` with every type in data-model.md, and nothing else:
  - `FailureCause`, `InsufficientEvidenceReason`, `FailureAnalysisConclusion` (discriminated on `kind`)
  - `FailureEvidenceKind` (the 14 kinds, in data-model order), `FailureEvidence`
  - `SpecificationContextUnavailableReason`, `UpstreamContext`, `SpecificationContext` (discriminated on `status`)
  - `FailureAnalysisProvenance`, `FailureAnalysis`
  - `FailureAnalysisInProgress` (`phase: "waiting-for-ai" | "generating"`)
  - `FailureAnalysisAttempt` (discriminated on `status`: `analyzed | ai-failed | not-viable`)

  Add a file header naming AP-031 and `specs/030-ai-failure-analysis`. The file must not import Express, React or Node APIs.
- [ ] T004 Export the new module from `packages/shared-domain/src/index.ts` (`export * from "./failureAnalysis";`) after the `externalCollections` export.
- [ ] T005 [P] Add optional `itemId?: string` to `UploadedRequestResult` in `packages/shared-domain/src/externalCollections.ts`. Its doc comment should explain that it is the executed Postman item's `id`, that it is absent on results stored before AP-031, and that it links a result to its generated item (FR-017, D2).
- [ ] T006 [P] Make two additive changes in `packages/shared-domain/src/aiProvider.ts` (D6, D10):
  - Add `systemPrompt?: string` to `InferenceRequest`. Its doc comment should say that a present value replaces the provider's default chat system message, and that `contractVersion` stays `1`.
  - Add `export interface InferenceHooks { onStarted?: () => void }` and change `AIProvider.infer` to `infer(request: InferenceRequest, hooks?: InferenceHooks): Promise<InferenceResponse>`. Its doc comment should say that `onStarted` fires once when the provider begins work on this request, which is the point its timeout starts.

### Provider support

- [ ] T007 [P] Add a unit test in `backend/tests/unit/ai/localProvider.textGeneration.test.ts`, following that file's existing fake-engine setup:
  - With `systemPrompt` set, the chat template receives it as the `system` message.
  - Without it, the system message is exactly `SYSTEM_PROMPTS.json` or `SYSTEM_PROMPTS.text` (unchanged behavior).
- [ ] T008 [P] Add a unit test in `backend/tests/unit/ai/localProvider.timeout.test.ts`:
  - `hooks.onStarted` is called once, after the engine is ready and before generation.
  - It is not called when readiness is `unavailable` (the `NOT_READY` path) or for empty input.
  - A second queued request's `onStarted` fires only after the first request settles.
- [ ] T009 In `backend/src/ai/localProvider.ts`:
  - Accept `hooks?: InferenceHooks` in `infer()` and pass it to `runInference()`.
  - Call `hooks?.onStarted?.()` right after `ensureEngine()` succeeds, before `timeoutMs` is computed.
  - In the text-generation engine's chat framing, use `request.systemPrompt ?? SYSTEM_PROMPTS[expectedOutputFormat]`. Thread `systemPrompt` through the existing engine `options` argument.
  - Make no other behavior change.

  Depends on T006, and makes T007 and T008 pass.
- [ ] T010 [P] In `backend/src/ai/mockProvider.ts`, accept `hooks?: InferenceHooks` and call `hooks?.onStarted?.()` before building a successful response. Update `backend/tests/unit/ai/mockProvider.test.ts` to cover it, and to show that `systemPrompt` does not change the returned content. Depends on T006.
- [ ] T011 [P] Move the private `stripCodeFence`, `balancedObjectAt` and `extractJsonObjects` helpers into a new `backend/src/ai/jsonResponseParsing.ts`, exporting `stripCodeFence` and `extractJsonObjects`. The same helpers are duplicated in `backend/src/testDesign/parseAIScenarioResponse.ts:19-65` and `backend/src/dependencies/parseAIDependencyResponse.ts:16-60`. Import the new module in both files instead of their local copies. Compare the two copies first. If they differ in any behavior, keep each caller's behavior and extract only the identical part. Existing tests under `backend/tests/unit/testDesign/` and `backend/tests/unit/dependencies/` must pass unchanged. Add `backend/tests/unit/ai/jsonResponseParsing.test.ts` covering fenced JSON, prose around JSON, and nested braces inside strings.

### Recording the executed request's identity (FR-017, D2)

- [ ] T012 [P] Extend `backend/tests/unit/externalCollections/mapUploadedResult.test.ts`:
  - Passing an item id sets `result.itemId` on passed, failed (assertion, connectivity and timeout) results.
  - Omitting it leaves the field absent, not `undefined`-valued, so the serialized shape is unchanged.
- [ ] T013 Add an `itemId?: string` parameter (after `wasEdited`) to `mapUploadedResult` in `backend/src/externalCollections/mapUploadedResult.ts`, and add `...(itemId ? { itemId } : {})` to `base`. In `backend/src/externalCollections/runUploadedCollectionExecution.ts`, pass `item.id` at the `mapUploadedResult(...)` call (`:106-112`). Also set `itemId: item.id` on every `not-attempted` result that function builds. Extend `backend/tests/integration/externalCollections/uploadAndRun.test.ts`: every result of a new run carries the item's id from the stored collection. Depends on T005 and T012.

### Persistence (FR-013, FR-015, D9)

- [ ] T014 [P] Create `backend/tests/unit/persistence/failureAnalysisRepository.test.ts`:
  - `upsert` then `get` round-trips a `FailureAnalysis`.
  - A second `upsert` for the same `(session, runId, resultIndex)` replaces it completely.
  - `listByRun` returns analyses ordered by `resultIndex` and scoped to the session (another session's rows are invisible).
  - `deleteBySession` removes only that session's rows.
  - The stored `analysis_encrypted` bytes do not contain the analysis summary text in plaintext.
- [ ] T015 In `backend/src/persistence/connection.ts` `initializeSchema()`, add the `failure_analyses` table exactly as in research D9, with `PRIMARY KEY (session_id, run_id, result_index)`. Use a separate `CREATE TABLE IF NOT EXISTS` block placed after `benchmark_runs`, leaving `PRAGMA user_version` at 1. Extend `backend/tests/unit/persistence/connection.test.ts`: opening an existing database created without the table adds it, and reopening is idempotent.
- [ ] T016 Create `backend/src/persistence/failureAnalysisRepository.ts`, mirroring `uploadedCollectionRunRepository.ts`'s structure:
  - Define an interface `FailureAnalysisRepository { upsert(sessionId, analysis): void; get(sessionId, runId, resultIndex): FailureAnalysis | undefined; listByRun(sessionId, runId): FailureAnalysis[]; deleteBySession(sessionId): void }`.
  - Implement `SqliteFailureAnalysisRepository`. It encrypts the whole `FailureAnalysis` JSON with `connection.cipher`. `upsert` is a single `INSERT … ON CONFLICT(session_id, run_id, result_index) DO UPDATE SET generated_at=excluded.generated_at, analysis_encrypted=excluded.analysis_encrypted, analysis_iv=excluded.analysis_iv`.
  - Export `getFailureAnalysisRepository()` using `getSharedConnection()`, following the existing getters.

  Makes T014 pass. Depends on T003 and T015.

### Specification-context matching (FR-018, D3)

- [ ] T017 [P] Create `backend/tests/fixtures/failureAnalysis/workflowFixtures.ts`. It builds a completed `TestGenerationWorkflow` (from `@apipilot/shared-domain`) with:
  - an `apiModel` containing `POST /users` (responses 201, 400) and `GET /users/{id}` (responses 200, 404);
  - an `approvedTestModel` with one positive scenario per operation;
  - a `dependencyAnalysis` with one CONFIRMED relationship and one approved `IntegrationWorkflow` (step 0 `POST /users` produces `user_id`, step 1 `GET /users/{id}` consumes it);
  - a `postmanArtifact` whose collection has a `Workflow: <id>` folder holding the two step items, plus one standalone item. Item ids are generated with `itemIdForScenario` or `itemIdForWorkflowStep` from `backend/src/postman/identifiers.ts`, and each item carries the `provenance` the generator writes.

  Reuse existing builders from `backend/tests/fixtures/postman/` or `backend/tests/fixtures/testGenerationWorkflow/` where they exist, rather than hand-writing duplicates.
- [ ] T018 [P] Create `backend/tests/unit/failureAnalysis/matchSpecificationContext.test.ts` covering:
  - each unavailable reason: `no-request-identity` (no `itemId`), `no-generated-collection` (no workflow, or no `postmanArtifact`), `not-generated-by-current-workflow` (unknown id), and `no-originating-scenario` (an item without `provenance.scenarioId`, such as an OAuth2 token-fetch item);
  - a matched standalone item, returning `workflowId`, `scenarioId`, scenario name and category, `operationPath`, `operationMethod`, `documentedStatusCodes` in `ApiModel` order, and `upstream: []`;
  - `requestEditedAfterGeneration` mirroring `result.wasEdited === true`;
  - that no match is ever made by `requestName`, even when the names are identical.
- [ ] T019 Create `backend/src/failureAnalysis/matchSpecificationContext.ts`, exporting a pure `matchSpecificationContext(result: UploadedRequestResult, workflow: TestGenerationWorkflow | undefined): SpecificationContext`. It walks `workflow.postmanArtifact.collection` items recursively through folders, matches on `id === result.itemId`, and resolves the scenario from `approvedTestModel` and the operation from `apiModel`. It leaves `upstream` as `[]`, because upstream resolution is added in T036. It has no I/O and does not read the clock. Makes T018 pass. Depends on T003 and T017.

### Router skeleton

- [ ] T020 Create `backend/src/failureAnalysis/errors.ts` with typed errors: `InvalidResultIndexError`, `ResultNotFoundError`, `ResultNotFailedError` (carrying `outcome`) and `FailureAnalysisInProgressError` (carrying `runId` and `resultIndex`). Reuse the existing `RunNotFoundError` from `backend/src/externalCollections/errors.ts` rather than adding a new one.
- [ ] T021 Create `backend/src/api/failureAnalysis.ts` exporting `createFailureAnalysisRouter(provider: AIProvider)` and a default `failureAnalysisRouter`, following `createEnhancedTestModelsRouter`'s pattern. Mount it in `backend/src/app.ts` under `/api`, next to the other injected-provider routers (`app.ts:97-106`), so `createApp({ provider })` wires it for tests. Log the route with `createLogger("api.failureAnalysis")`, using the existing `logRequestReceived`/`logRequestSucceeded`/`logRequestFailed` helpers if they are exported, or the same pattern if not. Handlers are added per story. Depends on T020.

**Checkpoint**: The contracts compile, the provider supports `systemPrompt` and `onStarted`, results record `itemId`, the repository persists, and context matching works. `npm test`, `npm run lint` and `npm run build` pass.

---

## Phase 3: User Story 1 — Understand why a request failed (Priority: P1) 🎯 MVP

**Goal**: A user clicks "Analyze failure" on one failed result of any AP-026 run (in progress,
completed or cancelled). The local AI returns a labelled likely cause with confidence, cited
deterministic evidence and next steps. The result is stored and shown again after reload or
restart. Only one analysis runs per session, and waiting and generating are shown separately.

**Independent Test**: Upload a collection ApiPilot did not generate, run it, and analyze a failed
request. Verify the evidence comes only from that result (including the redacted raw capture on
the `local` tier). Verify the analysis persists across a reload and a second analysis in the
session is refused while the first runs (quickstart scenarios 1, 3 and 4).

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [ ] T022 [P] [US1] Create `backend/tests/unit/failureAnalysis/redaction.test.ts`. Using the `withRawCapture` fixture, verify:
  - The `Authorization`, `Cookie` and `X-Api-Key` header values become `[redacted]`, and so does any header whose value is a bearer token.
  - `api_key` is redacted in the URL query while `page=2` is kept.
  - The JSON body's `password` is redacted recursively, including inside nested objects and arrays.
  - Non-JSON bodies have `token=…` and `Bearer …` redacted.
  - Excerpts are truncated after redaction to 600 (request) and 1,000 (response) characters, with a truncation note.
  - `collectRedactedValues()` returns every replaced value.
  - `scanOutput(text, sensitiveValues)` replaces each occurrence with `[redacted]`.
  - No input value `SECRET1`, `SECRET2` or `abc.def.ghi` survives in any output.
- [ ] T023 [P] [US1] Create `backend/tests/unit/failureAnalysis/buildEvidence.test.ts`, verifying:
  - kinds appear in data-model order with ids `E1…En`;
  - one `test-outcome` per test, including passed tests;
  - the raw-capture kinds are present only with a `rawCapture`;
  - `request-edited` is present only when `wasEdited`;
  - `source` is `run-result` for these kinds;
  - identical input gives identical output (a deep-equal on two calls);
  - a connectivity failure gives only `failure-category` (plus `response-time` when the duration is above 0).
- [ ] T024 [P] [US1] Create `backend/tests/unit/failureAnalysis/failureAnalysisPrompt.test.ts`, verifying:
  - `buildFailureAnalysisRequest(...)` returns an `InferenceRequest` with `expectedOutputFormat: "json"`, `maxOutputTokens: 256`, the feature `systemPrompt`, and no `timeoutMs`;
  - the `input` JSON contains `responseVersion: 1`, the evidence ids and texts, the allowed causes and one worked example;
  - `requestId` is `failure-` followed by 24 hex characters, stable for the same input;
  - the prompt contains no value from `collectRedactedValues()`.
- [ ] T025 [P] [US1] Create `backend/tests/unit/failureAnalysis/parseFailureAnalysisResponse.test.ts`, covering:
  - valid likely-cause output;
  - fenced or prose-wrapped JSON;
  - a missing `responseVersion` treated as current;
  - each shape failure (bad cause, confidence outside [0, 1], empty summary, non-array steps) leading to `INVALID_RESPONSE`;
  - summary truncation to 400 characters at a word boundary, and steps capped at 3 and 200 characters;
  - unknown cited ids dropped;
  - the conclusion rules: `insufficient-evidence` gives `model-reported`, confidence 0.49 gives `below-confidence-threshold`, confidence 0.5 with a valid citation gives `likely-cause`, and no valid citation gives `no-valid-evidence-cited`;
  - the rejected cause never appearing in the insufficient conclusion.
- [ ] T026 [P] [US1] Create `backend/tests/unit/failureAnalysis/inProgressRegistry.test.ts`, verifying:
  - `tryBegin(sessionId, entry)` returns `false` while an entry exists for that session, whatever its result;
  - different sessions are independent;
  - `markGenerating` switches the phase and resets `phaseStartedAt` from the injected clock;
  - `end` clears the entry;
  - `get` returns the entry or `undefined`.
- [ ] T027 [P] [US1] Create `backend/tests/unit/failureAnalysis/analyzeFailure.test.ts` with a scripted provider and an in-memory repository, verifying:
  - a failed result gives `status: "analyzed"`, stored via `upsert`, with provenance holding the model id, `local`, `responseVersion: 1`, `confidenceThreshold: 0.5`, and the injected clock's `generatedAt`;
  - the analysis carries `specificationContext` from `matchSpecificationContext`;
  - `onStarted` moves the in-progress phase to `generating`;
  - the in-progress entry is cleared on success and on thrown errors;
  - a provider `status: "error"` gives `ai-failed` with that category and nothing written;
  - `scanOutput` is applied to the summary and steps;
  - no `infer` call happens for an ineligible result.
- [ ] T028 [P] [US1] Create `backend/tests/integration/failureAnalysis/failureAnalysis.test.ts` using Supertest with `createApp({ provider: scriptedProvider(...) })`. Create runs through the real AP-026 upload and start routes against a local target (mirror `backend/tests/integration/externalCollections/uploadAndRun.test.ts`'s target setup). Cover every contract row:
  - 400 `invalid_result_index` for `-1` or `abc`;
  - 404 `run_not_found`, including another session's run;
  - 404 `result_not_found`;
  - 409 `result_not_failed` with `outcome`;
  - 409 `failure_analysis_in_progress` naming the first result, while a slow scripted provider holds the first request;
  - 200 `analyzed`;
  - `GET …/failure-analyses` returning stored analyses ordered by `resultIndex`;
  - `GET /api/failure-analysis/in-progress` returning 204 when idle, and the entry with its phase while one is running;
  - a re-POST replacing the stored analysis;
  - analysis of a failed result while its run is still `in-progress` succeeding (FR-001);
  - analysis still working after the uploaded collection is deleted.
- [ ] T029 [P] [US1] Create `frontend/tests/unit/FailureAnalysisPanel.test.tsx` with React Testing Library, verifying:
  - idle shows an "Analyze failure" button with an accessible name including the request name;
  - clicking it shows "Waiting for the local AI", then "Generating", each with an elapsed timer (use fake timers for the 1 s in-progress polling);
  - the analyzed state shows the "AI inference, not a confirmed root cause" label, the cause label ("Potential environment issue"), the confidence as "Moderate (0.62)" or "High (0.80)", cited evidence as a list, a collapsed "Other evidence considered" disclosure containing the uncited items, investigation steps, and "Specification context unavailable" with the reason text;
  - the button is disabled with a message naming the other request while another analysis is in progress.
- [ ] T030 [P] [US1] Create `frontend/tests/unit/confidenceLabel.test.ts`, verifying 0.5 and 0.74 give "Moderate", and 0.75 and 1 give "High".

### Implementation for User Story 1

- [ ] T031 [P] [US1] Create `backend/src/failureAnalysis/redaction.ts` (D5). It exports pure functions:
  - `redactHeaders`
  - `redactUrl`
  - `redactBody(body, limit)`, which parses JSON and redacts values under sensitive field names recursively, or otherwise redacts bearer tokens and sensitive `key=value` pairs, then truncates with a note
  - `collectRedactedValues`
  - `scanOutput(text, sensitiveValues)`

  Reuse `isSensitiveHeaderName`, `isBearerTokenValue` and `isSensitiveFieldName` from `backend/src/testDesign/sensitiveValueDetection.ts`, and do not add new denylists. Makes T022 pass.
- [ ] T032 [US1] Create `backend/src/failureAnalysis/buildEvidence.ts` (D4). It exports `buildEvidence(result: UploadedRequestResult, context: SpecificationContext): { evidence: FailureEvidence[]; sensitiveValues: string[] }`. It emits the `run-result` kinds in data-model order, using `redaction.ts` for every raw-capture kind, with fixed English templates for each kind's `text`. It ignores `context` for now; the specification kinds are added in T037. Makes T023 pass. Depends on T031.
- [ ] T033 [P] [US1] Create `backend/src/failureAnalysis/failureAnalysisPrompt.ts` (D6, D8), containing:
  - the constants `FAILURE_ANALYSIS_RESPONSE_VERSION = 1`, `FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS = 256` and `FAILURE_ANALYSIS_MIN_CONFIDENCE = 0.5`, each with a one-line reason referencing research.md;
  - `FAILURE_ANALYSIS_SYSTEM_PROMPT`: a failure-analysis assistant that answers with exactly one JSON object and never invents evidence ids;
  - a `WORKED_EXAMPLE`;
  - `buildFailureAnalysisPrompt({ requestMethod, requestName, evidence, specificationContext })`, which returns `JSON.stringify({responseVersion, task, request, evidence, specificationContextNote, allowedCauses, example})`;
  - `buildFailureAnalysisRequest(prompt)`, which returns the `InferenceRequest` with `requestId = "failure-" + sha256(prompt).slice(0, 24)`.

  Makes T024 pass.
- [ ] T034 [P] [US1] Create `backend/src/failureAnalysis/parseFailureAnalysisResponse.ts` (D7). It exports `parseFailureAnalysisResponse(response: InferenceResponse, evidenceIds: ReadonlySet<string>)`, which returns `{ conclusion, summary, investigationSteps, citedEvidenceIds }` or throws `AIProviderError("INVALID_RESPONSE", <fixed message>)` from `backend/src/ai/errors.ts`. It uses `stripCodeFence` and `extractJsonObjects` from `backend/src/ai/jsonResponseParsing.ts` and applies the conclusion rules exactly as in research D7. Makes T025 pass. Depends on T011.
- [ ] T035 [P] [US1] Create `backend/src/failureAnalysis/inProgressRegistry.ts` (D10): an in-memory `Map<sessionId, FailureAnalysisInProgress>` with `tryBegin` (a synchronous check-and-set), `markGenerating`, `end` and `get`, and a `now` clock injected through a factory `createInProgressRegistry(now = () => new Date())`. It exports a default instance, and registers `onExpire` from `backend/src/session/sessionRegistry.ts` to drop an evicted session's entry. Makes T026 pass.
- [ ] T036 [US1] Create `backend/src/failureAnalysis/analyzeFailure.ts`. It exports `analyzeFailure(deps, input)`, where `deps = { provider, repository, registry, now, getWorkflow, getCollectionVariableValues }` and `input = { sessionId, run, resultIndex }`. The steps, in order:
  1. Validate eligibility (throwing the T020 errors).
  2. Call `registry.tryBegin` synchronously before any `await`, throwing `FailureAnalysisInProgressError` on `false`.
  3. `matchSpecificationContext`.
  4. `buildEvidence`.
  5. Build the prompt.
  6. `await provider.infer(request, { onStarted: () => registry.markGenerating(sessionId) })`.
  7. Parse.
  8. Apply `scanOutput` to the summary and steps, using the evidence's sensitive values plus the collection's sensitive-named variable values when the collection still exists.
  9. Assemble a `FailureAnalysis` with provenance, `repository.upsert`, and return `{status: "analyzed", analysis}`.

  A provider `status: "error"`, or a thrown `AIProviderError`, returns `{status: "ai-failed", aiErrorCategory, message}`, using a category-to-plain-message function modelled on `enhanceTestModel.ts:685`. Nothing is written in that case. `registry.end` runs in `finally`. It logs only `runId`, `resultIndex`, status, category, evidence count and `durationMs`. Makes T027 pass. Depends on T016, T019, T032, T033, T034 and T035.
- [ ] T037 [US1] Add three handlers to `backend/src/api/failureAnalysis.ts`:
  - `POST /external-collections/:id/execution/runs/:runId/results/:resultIndex/failure-analysis` parses `resultIndex` strictly (digits only), loads the run with `getRun` from `backend/src/externalCollections/uploadedCollectionExecutionStore.ts`, calls `analyzeFailure`, and returns 200 with the attempt. It maps `InvalidResultIndexError` to 400, `RunNotFoundError`/`ResultNotFoundError` to 404, and `ResultNotFailedError`/`FailureAnalysisInProgressError` to 409, with the bodies from the contract. The collection may be missing: look up variable values with `getUploadedCollection` inside a try/catch for `UploadedCollectionNotFoundError`, and use none if it is missing.
  - `GET …/failure-analyses` checks the run exists (404 otherwise) and returns `repository.listByRun`.
  - `GET /failure-analysis/in-progress` returns 200 `{inProgress}` or 204.

  Makes T028 pass. Depends on T021 and T036.
- [ ] T038 [P] [US1] In `frontend/src/services/externalCollectionsClient.ts`, add typed functions following the file's existing error-handling pattern and logging each caught error through `frontend/src/logger.ts`, as the other functions do:
  - `requestFailureAnalysis(collectionId, runId, resultIndex): Promise<FailureAnalysisAttempt>`
  - `listFailureAnalyses(collectionId, runId): Promise<FailureAnalysis[]>`
  - `getFailureAnalysisInProgress(): Promise<FailureAnalysisInProgress | null>`

  Map 409 bodies to a typed client error that carries the `error` code, `runId` and `resultIndex`. Add `frontend/tests/unit/externalCollectionsClient.failureAnalysis.test.ts`, stubbing `fetch`, to cover the 200, 204 and 409 mappings.
- [ ] T039 [P] [US1] Create `frontend/src/utils/confidenceLabel.ts`, exporting `confidenceLabel(confidence: number): "Moderate" | "High"` (below 0.75 is Moderate, otherwise High) and `formatConfidence(confidence)`, which returns `` `${label} (${confidence.toFixed(2)})` ``. Makes T030 pass.
- [ ] T040 [US1] Create `frontend/src/components/FailureAnalysisPanel.tsx`. Its props are `{ collectionId, runId, resultIndex, requestName, analysis?, inProgress?, onAnalysisChange, onInProgressChange }`. It renders:
  - idle, with a primary "Analyze failure" `<button>` whose accessible name includes the request;
  - `waiting-for-ai` and `generating`, each with a live elapsed timer in an `aria-live="polite"` region;
  - analyzed, with a `ProvenanceBadge` or text label "AI inference, not a confirmed root cause", the cause as "Potential …" text (not only colour), `formatConfidence`, the summary, cited evidence as a `<ul>` of deterministic evidence texts, a native `<details>` "Other evidence considered" section with the uncited evidence, investigation steps as an `<ol>`, the specification-context section (unavailable reason in plain words for now), and provenance (model and time);
  - `ai-failed`, as an `ErrorState` with the message and a "Try again" button.

  While a POST is pending, it polls `getFailureAnalysisInProgress` every 1 s and stops when it settles. Style it with Tailwind v4 tokens only (the existing `controlStyles.ts` and `StatusBadge` patterns), with dark-mode variants, no inline styles and no arbitrary values. Business mapping (cause to label, reason to text) goes in small pure functions in the same file or `frontend/src/utils/`, not in `className` expressions. Makes the US1 parts of T029 pass. Depends on T038 and T039.
- [ ] T041 [US1] In `frontend/src/components/ExternalCollectionRunPanel.tsx`:
  - When a run's detail loads (`ResultDetail`, `:131`, and its parent that fetches the run), call `listFailureAnalyses` once and keep a map from `resultIndex` to analysis.
  - Call `getFailureAnalysisInProgress` on mount.
  - Render `FailureAnalysisPanel` inside `ResultDetail` for results with `outcome === "failed"` only.
  - Pass the in-progress entry down, so every panel's button is disabled while any analysis in the session is in progress, and show "Analyzing ‘<requestName>’…" on the others.

  Extend `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx`: the panel appears only for failed results, stored analyses are shown on load, and the buttons are disabled while in progress. Depends on T040.

**Checkpoint**: User Story 1 works end to end on a collection ApiPilot did not generate. Run `npm test`,
`npm run lint` and `npm run build`, then quickstart scenarios 1, 3 (steps 1 and 2) and 4.

---

## Phase 4: User Story 2 — Specification and dependency context (Priority: P2)

**Goal**: For requests generated by the session's current guided workflow, the analysis shows the
operation, scenario, documented responses and upstream steps with their outcomes in the same run,
and offers them to the model as `specification-context` evidence. Unmatched requests state why.

**Independent Test**: Run a generated collection with an approved workflow where step 0 fails,
then analyze step 1. It names its operation and scenario, and shows step 0 as `failed`. A
collection ApiPilot did not generate shows the unavailable reason (quickstart scenario 2).

### Tests for User Story 2 ⚠️

- [ ] T042 [P] [US2] Extend `backend/tests/unit/failureAnalysis/matchSpecificationContext.test.ts` for upstream context, using the T017 fixtures and a `run.results` array whose `itemId`s match the artifact:
  - The workflow step 1 item yields one `UpstreamContext` with `via: "integration-workflow"`, `stepPosition: 0`, `POST /users`, `suppliedFields: ["user_id"]`, and `outcomeInRun` set to `failed`, `passed` or `not-attempted` according to step 0's result, or `not-in-run` when step 0 is absent.
  - An item with `provenance.relationshipIds` yields `via: "dependency-relationship"` entries for each relationship's producer operation, with the nearest preceding matched result's outcome for that operation.
  - Upstream steps that do not supply a consumed value are excluded.
  - The output is deterministic.
- [ ] T043 [P] [US2] Extend `backend/tests/unit/failureAnalysis/buildEvidence.test.ts`. A matched context adds, after the run-result kinds, `documented-responses`, `scenario-expectation` and one `upstream-step-outcome` per upstream entry, each with `source: "specification-context"`. An unavailable context adds none.
- [ ] T044 [P] [US2] Extend `backend/tests/integration/failureAnalysis/failureAnalysis.test.ts`. Drive a real guided workflow in the test session to `postmanGeneration` using the existing workflow integration test helpers (`backend/tests/integration/testGenerationWorkflow.test.ts` setup), upload its `postmanArtifact` through `POST /api/external-collections`, run it against a target where the create step fails, and analyze the dependent step. Assert that the stored analysis's `specificationContext` is `matched` with the upstream `failed`. Then start a new workflow in the same session and re-read the stored analysis: the context is unchanged. A fresh analysis of the old run is `not-generated-by-current-workflow`.
- [ ] T045 [P] [US2] Extend `frontend/tests/unit/FailureAnalysisPanel.test.tsx`, verifying:
  - a matched context shows the operation (method badge plus monospace path), the scenario name, the documented status codes, and an upstream list whose items state their outcome in text ("Step 1: POST /users — failed");
  - `requestEditedAfterGeneration` shows the "edited after generation" note;
  - each unavailable reason renders its plain-language text.

### Implementation for User Story 2

- [ ] T046 [US2] Extend `backend/src/failureAnalysis/matchSpecificationContext.ts` to fill `upstream` (D3). Change the signature to `matchSpecificationContext(result, workflow, runResults: readonly UploadedRequestResult[], resultIndex: number)`, and update the T036 call site. It uses:
  - for workflow steps, the matching `IntegrationWorkflow` in `dependencyAnalysis.workflows` and its `variables`, where `consumerStepIndex` is this step and the producer step is earlier;
  - for `relationshipIds`, the `ApiDependencyGraph` relationships' producers.

  Each upstream request's outcome comes from the run results before `resultIndex`, matched by `itemId` through the same artifact walk. The artifact walk goes into an internal helper that returns `Map<itemId, provenance>`, built once per call. Makes T042 pass. Depends on T019 and T036.
- [ ] T047 [US2] Extend `backend/src/failureAnalysis/buildEvidence.ts` to emit the `specification-context` kinds with fixed templates, for example "Operation documents responses: 201, 400", "Scenario ‘…’ (positive) expects status 201", and "Upstream step 0 POST /users (supplies user_id): failed in this run". Makes T043 pass. Depends on T032 and T046.
- [ ] T048 [US2] In `backend/src/failureAnalysis/failureAnalysisPrompt.ts`, set `specificationContextNote` to a one-line summary of the matched operation and scenario, or of the unavailable reason, so the model knows whether specification evidence exists. Bump nothing: the response shape is unchanged. Extend T024's test for both notes. Makes T044 pass together with T046 and T047.
- [ ] T049 [US2] Extend `frontend/src/components/FailureAnalysisPanel.tsx`'s specification-context section to render the matched context. Reuse `HttpMethodBadge`, monospace only for the path, and a semantic `<ul>` for upstream steps with the outcome as text plus a `StatusBadge`. Show the edited note. Map each unavailable reason to plain-language text through a pure function, for example "not generated by the current workflow: start from the guided workflow's hand-off to see specification context". Makes T045 pass. Depends on T040.

**Checkpoint**: User Stories 1 and 2 both work. Run quickstart scenario 2.

---

## Phase 5: User Story 3 — Say plainly when the AI cannot explain a failure (Priority: P3)

**Goal**: Sparse evidence, low confidence, uncited answers, provider failures and budget refusals
all produce explicit, plain-language outcomes. A failed attempt never overwrites or hides the
stored analysis.

**Independent Test**: With scripted providers, a 0.3-confidence answer, an answer citing only
unknown ids, and a `TIMEOUT` error each produce the matching explicit outcome, and the stored
analysis is kept. With a tiny time budget, analysis is refused before inference as `not-viable`
(quickstart scenario 3, step 3).

### Tests for User Story 3 ⚠️

- [ ] T050 [P] [US3] Extend `backend/tests/unit/failureAnalysis/analyzeFailure.test.ts` to cover:
  - `not-viable` returned without calling `infer`, via a scripted `getInputBudget` plus planning rates making `estimateViability` fail;
  - over-capacity input dropping body excerpts first, then header lists, and adding an `omitted-for-capacity` evidence item, then `not-viable` if the input still does not fit;
  - `ai-failed` and `not-viable` carrying `previousAnalysis` equal to the stored analysis, with the repository unchanged;
  - an `insufficient-evidence` conclusion stored as a normal analysis;
  - each `AIErrorCategory` mapping to a distinct plain-language message containing no model id, file path or stack.
- [ ] T051 [P] [US3] Extend `backend/tests/integration/failureAnalysis/failureAnalysis.test.ts`:
  - A scripted 0.3-confidence answer gives an analysis with `conclusion.kind: "insufficient-evidence"` and `reason: "below-confidence-threshold"`, and the GET list returns it.
  - A `failingProvider("TIMEOUT")` after a stored analysis gives 200 `ai-failed` with `previousAnalysis`, and the GET list still returns the original.
- [ ] T052 [P] [US3] Extend `frontend/tests/unit/FailureAnalysisPanel.test.tsx`:
  - insufficient evidence shows "Not enough evidence to name a likely cause" with the reason in plain words, shows no cause or confidence label, and shows the summary and steps under "Model notes (inference)";
  - `ai-failed` and `not-viable` show their message and a "Try again" action, with the previous analysis still visible below;
  - focus moves to the outcome heading when an attempt settles.

### Implementation for User Story 3

- [ ] T053 [US3] In `backend/src/failureAnalysis/analyzeFailure.ts`, add the D8 pre-flight between building the prompt and inferring:
  1. `const budgetChars = await provider.getInputBudget(FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS)`.
  2. If the prompt exceeds `budgetChars`, rebuild evidence without the body excerpts, then without the header lists, adding one `omitted-for-capacity` item.
  3. If it still does not fit, return `not-viable`.
  4. Otherwise run `estimateViability` from `backend/src/ai/viability.ts`, with prompt tokens estimated using `CHARS_PER_TOKEN_ESTIMATE` and `loadAIConfig().planning`, and a budget of `loadAIConfig()`'s inference timeout. A non-viable result returns `{status: "not-viable", notViable, message: "… about <formatDuration(projectedMs)> …"}`.

  Also load `previousAnalysis = repository.get(...)` before inferring, and attach it to every `ai-failed` and `not-viable` return. Makes T050 and T051 pass. Depends on T036.
- [ ] T054 [US3] Extend `frontend/src/components/FailureAnalysisPanel.tsx`:
  - The insufficient-evidence rendering shows a heading, the reason in plain words via a pure mapping, and "Model notes (inference)" for the summary and steps, with no cause or confidence.
  - `ai-failed` and `not-viable` states show the message and "Try again", and keep the previous analysis rendered.
  - Focus moves to the outcome heading when an attempt settles, for accessibility.

  Makes T052 pass. Depends on T040.

**Checkpoint**: All three stories work independently. Run quickstart scenarios 1 to 5.

---

## Phase 6: Polish & cross-cutting concerns

- [ ] T055 [P] Create the labelled evaluation corpus `backend/tests/fixtures/failureAnalysis/evaluationCorpus.ts` (D11). It holds 12 cases built with the T002 builders, each with `expected: FailureCause | "insufficient-evidence"`:
  - 4 environment cases (connectivity failure, timeout, 502 from a gateway, TLS error message);
  - 4 specification-mismatch cases (a test expecting 201 when the response is 200 and 201 is documented, a response missing a required field, a wrong content type, a 400 on a valid documented request);
  - 2 downstream-service cases (a 503 with an upstream error body, a 500 whose body names a dependency);
  - 2 insufficient-evidence cases (a bare 500 with no body and no tests, an assertion failure with no detail).
- [ ] T056 Create `backend/tests/integration/failureAnalysis.real.test.ts`. It is skipped unless `AI_TEST_REAL_MODEL=1`, mirroring `backend/tests/integration/localProvider.real.test.ts`'s gate. It runs the pipeline over the corpus with the real `LocalProvider`, then prints and asserts (soft, logged) structured-output success rate, cause agreement, valid-citation rate, confidence distribution and per-case latency. Add `"test:ai-real:failure-analysis": "cross-env AI_TEST_REAL_MODEL=1 vitest run --root . tests/integration/failureAnalysis.real.test.ts"` to `backend/package.json` next to `test:ai-real`. Depends on T053 and T055.
- [ ] T057 Run `npm run test:ai-real:failure-analysis -w backend` on the target machine with the default model, and record the figures, machine, model id, date and a decision in `specs/030-ai-failure-analysis/evaluation.md`. The decision is to keep the model and the 0.5 threshold, or to open a model or threshold decision through AP-004's process if structured-output success is below 80% (D11). If it cannot be run, write that in `evaluation.md` explicitly rather than inventing figures. Depends on T056.
- [ ] T058 [P] Add dated additive amendment notes. In `specs/026-external-collection-execution/data-model.md` (`## UploadedRequestResult`) and `contracts/external-collections-api.md` (the run-detail section), note that `itemId` is added by AP-031. In `specs/004-ai-provider-local-inference/data-model.md`, note `InferenceRequest.systemPrompt` and `AIProvider.infer(request, hooks?)` (`onStarted`). Each note should reference `specs/030-ai-failure-analysis` and state that existing behavior is unchanged.
- [ ] T059 [P] Update `specs/ROADMAP.md`: the AP-031 status-table row becomes "Implemented" with the task count and any outstanding follow-up, such as T057 if it is not run. Update `README.md:443`'s AP-031 line to describe the feature as implemented, what it does in one sentence, and that it works on Import & Run Collection results.
- [ ] T060 Run a security review of the diff:
  - grep the new modules for any logging of `summary`, `evidence`, `prompt`, `content` or `rawCapture` (there must be none);
  - confirm every raw-capture field reaches the prompt only through `redaction.ts`;
  - confirm the 5xx path returns only `{error: "internal_server_error"}`;
  - confirm no network call exists in `backend/src/failureAnalysis/`.

  Record the result in the task's completion note.
- [ ] T061 Run `npm test`, `npm run lint` and `npm run build` at the repository root, fix everything they report, and then run quickstart.md scenarios 1 to 5 manually with `AI_PROVIDER_MODE=local`. Record which scenarios were run, and state explicitly any that could not be.

---

## Dependencies & execution order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup, and blocks every story.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational and on US1's `analyzeFailure` (T036) and panel (T040), which it extends.
- **US3 (Phase 5)**: depends on Foundational and on US1's `analyzeFailure` (T036) and panel (T040). It is independent of US2, so US2 and US3 can proceed in parallel after US1.
- **Polish (Phase 6)**: T055 can start any time after T002. T056 and T057 need US3 (the pre-flight). T058 to T061 come last.

### Key task dependencies

- T006 → T007, T008, T009, T010
- T011 → T034
- T005, T012 → T013
- T003, T015 → T016 (T014 first)
- T003, T017 → T019 (T018 first)
- T020 → T021
- T031 → T032
- T016, T019, T032, T033, T034, T035 → T036 → T037
- T038, T039 → T040 → T041
- T019, T036 → T046 → T047 → T048
- T040 → T049
- T036 → T053
- T040 → T054
- T053, T055 → T056 → T057

### Within each story

Write the tests first and confirm they fail. Then build the pure modules (redaction, evidence,
prompt, parse, registry), then the orchestration, then the route, then the client, then the UI.

---

## Parallel examples

### Foundational

```text
T005 itemId field      | T006 provider contract | T011 JSON helper extraction
T012 mapper test       | T014 repository test   | T017 workflow fixtures | T018 matching test
```

### User Story 1

```text
Tests:   T022 redaction | T023 evidence | T024 prompt | T025 parse | T026 registry | T027 orchestration | T028 routes | T029 panel | T030 label
Modules: T031 redaction | T033 prompt | T034 parse | T035 registry | T038 client | T039 label
```

### After US1: US2 and US3 in parallel

```text
Developer A: T042–T049 (US2)
Developer B: T050–T054 (US3)
```

---

## Implementation strategy

### MVP (User Story 1)

1. Phases 1 and 2.
2. Phase 3 (US1). Stop and validate with quickstart scenarios 1, 3 and 4.
3. US1 alone already applies the FR-008 threshold and citation rules, because they are part of the
   parser in T034. Provider errors are reported as `ai-failed`. US3 adds the pre-flight refusal,
   capacity trimming, keeping the previous analysis on failure, and the clearer outcome UI.

### Incremental delivery

1. Foundation, then US1 (MVP: works for any uploaded collection).
2. Then US2 (specification and dependency context for generated collections).
3. Then US3 (hardened failure honesty and budget refusal).
4. Then Polish (evaluation evidence, documentation amendments, security review, full validation).

---

## Notes

- `[P]` means different files with no dependency on an incomplete task.
- Upstream matching and specification-context evidence are deliberately in US2 (T046 and T047),
  not in T019 and T032, so US1 is complete on its own for collections ApiPilot did not generate.
- Do not commit. The user reviews and commits every change (see the project memory).
- Never claim a validation command passed unless it was run (CLAUDE.md §54).
