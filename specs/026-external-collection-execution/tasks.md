---

description: "Task list for External Postman Collection Import & Execution"
---

# Tasks: External Postman Collection Import & Execution

**Input**: Design documents from `/specs/026-external-collection-execution/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/external-collections-api.md, quickstart.md

**Tests**: Included. This is Trivium/ApiPilot code — CLAUDE.md §51/§54 require unit/integration tests as part of the feature, not an afterthought, and both existing sibling features (specs/018, specs/025) shipped with backend unit + integration tests and frontend RTL tests.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) so each can be implemented and independently verified per its own Acceptance Scenarios / Independent Test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 per spec.md
- Every task names its exact file path

## Path Conventions

Existing web-application layout (plan.md Structure Decision): `backend/src/`, `frontend/src/`, `packages/shared-domain/src/`, with tests under `backend/tests/`, `frontend/tests/`, `packages/shared-domain/tests/`.

---

## Phase 1: Setup

**Purpose**: Add the one new direct dependency and the shared-domain types every later phase needs.

- [X] T001 Add `postman-collection` as an explicit direct `dependencies` entry in `backend/package.json` (research.md D1 — already present transitively via `newman`; run `npm install` from repo root afterward so the lockfile records it as direct, per CLAUDE.md §50).
- [X] T002 [P] Create `packages/shared-domain/src/externalCollections.ts` with `UploadedCollectionSet`, `UploadedRequestResult`, `UploadedCollectionExecutionRun`, and `PostmanRawItem`/`PostmanRawEvent`/`PostmanRawRequest` types exactly per data-model.md and research.md D6 (reusing `EnvironmentTier`, `ExecutionRunStatus`, `ExecutionRunSummary`, `NotAttemptedReason`, `RawRequestCapture` imports from `packages/shared-domain/src/execution.ts`), and export them from `packages/shared-domain/src/index.ts`. `PostmanRawItem`/`PostmanRawEvent`/`PostmanRawRequest` are deliberately separate from `postmanArtifact.ts`'s generator-only `PostmanRequestItem`/`PostmanEvent`/`PostmanBody`/`PostmanAuth` (research.md D6) — `PostmanRawEvent.listen` allows `"prerequest" | "test"` and `PostmanRawRequest.body`/`.auth` carry `postman-collection`'s own already-validated JSON, neither of which the generator-only types can represent.
- [X] T003 [P] Widen `NewmanItemRunInput.item` in `backend/src/execution/newmanRunner.ts` to `PostmanRequestItem | PostmanRawItem` (research.md D6) — a type-only change; `runSingleItem()`'s internal dispatch logic is unchanged, since `newman.run()` already accepts either shape as plain JSON.
- [X] T004 [P] Add unit tests for the new shared-domain types' shape in `packages/shared-domain/tests/unit/external-collections.test.ts` (construct a minimal valid `UploadedCollectionExecutionRun`/`UploadedRequestResult`/`PostmanRawItem`, assert TypeScript compiles and required fields are present — mirrors the existing `test-generation-workflow.test.ts` style of shape-assertion test for a pure type module).

**Checkpoint**: Shared types compile (`npm run build -w packages/shared-domain`); nothing downstream is wired yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence, validation, and store/repository plumbing every user story's execution path depends on. No user-facing behavior yet.

**⚠️ CRITICAL**: Must complete before Phase 3 (US1) begins.

- [X] T005 Add `uploaded_collections` and `uploaded_collection_runs` table definitions (data-model.md SQL, via the existing `ensureColumn`-style migration guard) to `backend/src/persistence/connection.ts`.
- [X] T006 [P] Create `backend/src/externalCollections/errors.ts` with `UploadedCollectionNotFoundError`, `DuplicateNameError`, `InvalidCollectionError`, `InvalidEnvironmentError`, `MissingVariableValuesError`, `RunNotFoundError`, `NoRunInProgressError` — mirroring the shape/naming convention in `backend/src/execution/errors.ts`.
- [X] T007 [P] Create `backend/src/externalCollections/uploadedCollectionParsing.ts`: `parseUploadedCollection(raw: string)` (FR-002, research.md D1 — constructs a `postman-collection` `Collection`, requires ≥1 request item directly or nested in folders, throws `InvalidCollectionError` otherwise), `parseUploadedEnvironment(raw: string)` (FR-003, research.md D2 — structural `values: Array<{key,value}>` check, throws `InvalidEnvironmentError`), and `extractReferencedVariables(collection)` (FR-004, data-model.md — recursively scans URL/headers/body for `{{variableName}}` tokens).
- [X] T008 [P] [US1] Unit tests for `uploadedCollectionParsing.ts` in `backend/tests/unit/externalCollections/uploadedCollectionParsing.test.ts`: valid collection accepted; empty collection (no requests) refused; malformed JSON refused; malformed environment (missing `value` on an enabled entry) refused; nested-folder request discovered; `{{var}}` extraction across URL/header/body.
- [X] T009 [P] Extract `DESTRUCTIVE_METHODS` as a shared export from `backend/src/execution/destructiveOperations.ts` (research.md D3 — generalize the existing private/internal set into an exported constant; do not duplicate it) and create `backend/src/externalCollections/destructiveRequests.ts` with `findDestructiveRequests(collection)`, recursively walking `item`/`item.item`, returning every request whose method is in `DESTRUCTIVE_METHODS`, labeled by the request's own `name` (FR-013).
- [X] T010 [P] Unit tests for `destructiveRequests.ts` in `backend/tests/unit/externalCollections/destructiveRequests.test.ts`: flat collection, nested-folder collection, a collection with zero destructive requests, and a regression check that `DESTRUCTIVE_METHODS` is the same object/values `destructiveOperations.ts` already uses (research.md D3's "same vocabulary" requirement).
- [X] T011 Create `backend/src/persistence/uploadedCollectionRepository.ts` (SQLite-backed, mirrors `backend/src/persistence/environmentRepository.ts` exactly — encrypts `variableValues` via the existing `CredentialCipher` from `backend/src/persistence/credentialCipher.ts`, stores `collection` as plaintext per research.md D4): `create()`, `list(sessionId)`, `get(id)`, `remove(id)`.
- [X] T012 [P] Unit tests for `uploadedCollectionRepository.ts` in `backend/tests/unit/persistence/uploadedCollectionRepository.test.ts` (mirrors `environmentRepository.test.ts`'s structure): round-trip create/get, `variableValues` stored encrypted (raw DB row does not contain the plaintext value), list ordering, remove.
- [X] T013 Create `backend/src/externalCollections/uploadedCollectionStore.ts` (session-scoped CRUD, mirrors `backend/src/execution/environmentStore.ts` — keyed by `getSessionId()`, registered against the existing `onExpire()` session-eviction hook, backed by T011's repository): `createUploadedCollection()`, `listUploadedCollections()`, `getUploadedCollection()`, `removeUploadedCollection()`, enforcing the `UNIQUE (session_id, name)` constraint as `DuplicateNameError` (FR-016).
- [X] T014 [P] Unit tests for `uploadedCollectionStore.ts` in `backend/tests/unit/externalCollections/uploadedCollectionStore.test.ts`: create/list/get/remove, duplicate name within a session refused, same name allowed across two different sessions, not-found on `get`/`remove` of an unknown id.
- [X] T015 Create `backend/src/persistence/uploadedCollectionRunRepository.ts` (mirrors `backend/src/persistence/executionRunRepository.ts`, including its FR-017a raw-capture encrypted-column handling for `tier === "local"`) and `backend/src/externalCollections/uploadedCollectionExecutionStore.ts` (mirrors `backend/src/execution/executionRunStore.ts`, exporting `getInProgressRun(sessionId)`, `createRun()`, `appendResult()`, `completeRun()`, `cancelRun()`).
- [X] T016 [P] Unit tests for the run store/repository pair (implemented as one combined file, `uploadedCollectionExecutionStore.test.ts`, mirroring how `executionRunStore.test.ts` itself already covers both layers together — no separate `uploadedCollectionRunRepository.test.ts` file was needed) in `backend/tests/unit/externalCollections/uploadedCollectionExecutionStore.test.ts` and `backend/tests/unit/persistence/uploadedCollectionRunRepository.test.ts`, mirroring the existing `executionRunStore.test.ts`/`executionRunRepository`-equivalent coverage (create → append → complete lifecycle; cancel marks remaining as not-attempted; raw captures only persisted for `tier: "local"`).

**Checkpoint**: `npm run build -w backend` and `npm test -w backend -- externalCollections persistence/uploadedCollection` pass. No route is mounted yet; nothing is user-reachable. Note: `ExecutionRun`/`RequestResult` (the existing, shipped AP-017 types) are intentionally left untouched throughout this feature — data-model.md is explicit that they "remain exactly as shipped," and FR-010's source distinction is satisfied entirely by `UploadedCollectionExecutionRun.source: "uploaded"` plus separate, source-homogeneous UI surfaces (research.md D9), not by a shared field added to `ExecutionRun`. An earlier draft of this task list added such a field (former T017); it was removed as a self-inflicted contradiction of data-model.md caught during `/speckit-analyze`.

---

## Phase 3: User Story 1 - Run My Own Existing Postman Collection Through ApiPilot (Priority: P1) 🎯 MVP

**Goal**: Upload a collection+environment pair and run it, getting per-request pass/fail results (spec.md US1).

**Independent Test**: Upload a valid collection.json + environment.json, start a run, verify every request executes in order with a pass/fail outcome matching the collection's own assertions (quickstart.md Scenario 1).

### Tests for User Story 1

- [X] T018 [P] [US1] Integration test in `backend/tests/integration/externalCollections/uploadAndRun.test.ts` covering quickstart.md Scenario 1 end-to-end (upload → confirm → start → poll to completion) against the existing `backend/tests/fixtures/execution/targetServer.ts` fixture.
- [X] T019 [P] [US1] Integration test in `backend/tests/integration/externalCollections/missingVariableValues.test.ts` covering quickstart.md Scenario 2 (missing variable refuses the run start with `400 missing_variable_values`, zero requests dispatched — assert against the target server's received-request count).
- [X] T020 [P] [US1] Integration test in `backend/tests/integration/externalCollections/malformedUpload.test.ts` covering quickstart.md Scenario 3 (invalid collection JSON → `400 invalid_collection`, not listed afterward; invalid environment JSON → `400 invalid_environment`).

### Implementation for User Story 1

- [X] T021 [US1] Create `backend/src/externalCollections/runUploadedCollectionExecution.ts` (research.md D6, mirrors `backend/src/execution/runExecution.ts`): parses the stored collection into a `postman-collection` `Collection` and walks it via `collection.forEachItem(callback)` (confirmed in the installed SDK, `postman-collection/lib/collection/item-group.js:195`) to visit every request item, at any folder nesting depth, in the collection's own document order (FR-005, the nested-folders Edge Case); converts each visited item via `item.toJSON()` into `PostmanRawItem` (T002); calls `runSingleItem()` from `backend/src/execution/newmanRunner.ts` (T003's widened signature) per request; and reuses `execution/variableCompleteness.ts`'s `missingVariableValues()` against `extractReferencedVariables()` (T007) before dispatching anything (FR-004).
- [X] T022 [US1] Create `backend/src/externalCollections/mapUploadedResult.ts` (research.md D6): `mapUploadedResult(item, execution, startedAt, captureRawDetails)` → `UploadedRequestResult`, reading `testOutcomes` directly off Newman's `execution.assertions[]` (`assertion` → `name`, `.error?.message` → `detail`, redacted via the existing `redactIfSensitive()` reused from `backend/src/execution/mapNewmanResult.ts`), `failureCategory` limited to `"connectivity-failure" | "timeout" | "assertion-failed"` per data-model.md.
- [X] T023 [P] [US1] Unit tests for `mapUploadedResult.ts` in `backend/tests/unit/externalCollections/mapUploadedResult.test.ts`: passing/failing/mixed test outcomes, no-test-script request (outcome derived from status only, empty `testOutcomes`), connectivity failure, timeout, `rawCapture` present only when `captureRawDetails` is true.
- [X] T024 [US1] Create `backend/src/api/externalCollections.ts`: `POST /` (multipart upload via the existing `upload` middleware from `backend/src/uploadMiddleware.ts`, `MAX_UPLOAD_BYTES` reused per FR-012, plus `reaffirmSession` immediately after — multer's callback runs outside `sessionMiddleware`'s `AsyncLocalStorage` context, exactly as `testGenerationWorkflow.ts`'s own upload route already needs), `GET /`, `DELETE /:id`, `POST /:id/execution/start`, `POST /:id/execution/cancel`, `GET /:id/execution/runs`, `GET /:id/execution/runs/:runId` — response shapes per `contracts/external-collections-api.md`. Implemented FR-007's gate 1 together with FR-013's gate 2 in the same handler from the start (research.md D10's ordering), rather than deferring FR-007 to Phase 4 as originally scoped — the two gates share too much of the same handler to split cleanly across phases; Phase 4's remaining work is the dedicated confirmation-gate test (T032) and the frontend dialog (T035/T036).
- [X] T025 [US1] Mount the new router in `backend/src/app.ts`: `app.use("/api/external-collections", upload.fields([...]), externalCollectionsRouter)` following the existing `postmanCollectionsRouter`/multer-mounting pattern already in the file.
- [X] T026 [P] [US1] Integration test in `backend/tests/integration/externalCollections/listAndRemove.test.ts`: upload, list shows it (without `variableValues`/raw collection body), duplicate name refused with `409 duplicate_name`, remove returns `204`, subsequent list no longer shows it, oversized file refused with `413 file_too_large`.
- [X] T027 [US1] Create `frontend/src/services/externalCollectionsClient.ts`: thin client for every route in `contracts/external-collections-api.md`, following the existing `fetch`/error-mapping conventions in `frontend/src/services/executionClient.ts`.
- [X] T028 [US1] Create `frontend/src/components/ExternalCollectionUpload.tsx` (name, tier select, collection file input, environment file input, submit) using Tailwind per CLAUDE.md §26-34 and existing form patterns.
- [X] T029 [US1] Create `frontend/src/components/ExternalCollectionList.tsx` (list, select, remove) reusing `StatusBadge`/`HttpMethodBadge` conventions.
- [X] T030 [US1] Create `frontend/src/components/ExternalCollectionRunPanel.tsx`. `ExecutionResultsPanel.tsx`'s sub-components turned out to be module-private (not exported) and typed directly against `RequestResult`/`ExecutionRun`; rather than exporting/genericizing already-shipped, tested internals, this component reuses the genuinely shared, exported pieces (`StatusBadge`, `HttpMethodBadge`, `CodeBlock`, `BUTTON_STYLES`) and writes its own small overview/result-list/result-detail render functions against `UploadedRequestResult`/`UploadedCollectionExecutionRun`'s actual (different) shape — matching research.md D8's own finding that the two result types are not structurally identical. Also includes the FR-007 `UnverifiedContentDialog` and FR-013 `RiskTierConfirmationBanner`.
- [X] T031 [P] [US1] Frontend RTL tests: `frontend/tests/unit/ExternalCollectionUpload.test.tsx`, `frontend/tests/unit/ExternalCollectionList.test.tsx`, `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx` — cover upload form submission, list/select/remove interaction, and run-results rendering (passed/failed/not-attempted rows, testOutcomes detail). `ExternalCollectionRunPanel.test.tsx` also covers the FR-007 confirmation dialog (decline dispatches no request, accept sends `confirmed: true`), which folds in what T036 (Phase 4) would otherwise have added as a separate test.

**Checkpoint**: US1 fully functional end-to-end (upload → run → results) and independently testable per spec.md's own Independent Test — verified via `uploadAndRun.test.ts`, `missingVariableValues.test.ts`, `malformedUpload.test.ts`, and `listAndRemove.test.ts`, all passing. FR-007/FR-013 confirmation gates were implemented together with T024 (see its note above), ahead of the original phase split, and are already exercised end-to-end by `uploadAndRun.test.ts` and the frontend RTL suite.

---

## Phase 4: User Story 2 - Understand the Trust Boundary Before Anything Runs (Priority: P2)

**Goal**: Require an explicit, distinct confirmation before an uploaded collection's first-ever run (spec.md US2, FR-007).

**Independent Test**: Upload a collection, attempt to start a run; verify the unverified-content confirmation is required before dispatch, and declining prevents execution entirely (quickstart.md Scenario 1 step 2, Scenario 4 step 3).

### Tests for User Story 2

- [X] T032 [P] [US2] Integration test in `backend/tests/integration/externalCollections/confirmationGates.test.ts` covering quickstart.md Scenario 1 steps 2-3 (unconfirmed → `409 unverified_content_confirmation_required`; confirmed → run starts and `confirmedAt` is set) and Scenario 4 (staging tier + destructive request → `409 confirmation_required` naming the tier and requests derived from the collection's own methods; confirmed → run starts).

### Implementation for User Story 2

- [X] T033 [US2] Add `confirmedAt` handling to `uploadedCollectionStore.ts` (T013) — done as part of T013 itself (`markUploadedCollectionConfirmed()`), since it belonged naturally in the same file as the rest of the CRUD.
- [X] T034 [US2] Wire both confirmation gates into `POST /:id/execution/start` — done as part of T024 (see T024's note); the ordering matches research.md D10 exactly: gate 1 only while `confirmedAt` is unset (permanently satisfied via `markUploadedCollectionConfirmed`, then gate 2 re-surfaces on the same request rather than being silently satisfied by the same `confirmed:true` — verified by T032's dedicated test), then gate 2 on every run start thereafter, reusing `ExecutionConfirmationRequirement`'s exact shape.
- [X] T035 [US2] Add the FR-007 confirmation dialog/step to `frontend/src/components/ExternalCollectionRunPanel.tsx` — done as part of T030 (`UnverifiedContentDialog`).
- [X] T036 [P] [US2] Frontend RTL test addition — done as part of T031's `ExternalCollectionRunPanel.test.tsx` (see T031's note); no separate addition was needed.

**Checkpoint**: US1 + US2 both work independently. A brand-new upload cannot execute a single request without the FR-007 confirmation; a staging/production upload separately requires the FR-013 confirmation.

---

## Phase 5: User Story 3 - Tell Uploaded Runs Apart From ApiPilot's Own Runs (Priority: P3)

**Goal**: Visibly distinguish an uploaded-collection run from a generated-collection run everywhere run history/detail is shown (spec.md US3, FR-010).

**Independent Test**: Run both kinds in the same session; verify run history visibly labels each run's source and neither is mistaken for the other (quickstart.md Scenario 5 relies on this same distinction to prove the shared slot).

### Tests for User Story 3

- [X] T037 [P] [US3] Integration test in `backend/tests/integration/externalCollections/sharedExecutionSlot.test.ts` covering quickstart.md Scenario 5: an in-progress uploaded run blocks a second uploaded run (`409 execution_in_progress`) AND blocks `POST /api/test-generation-workflow/execution/start` (FR-015, research.md D7); and conversely an in-progress generated run blocks a new uploaded run.
- [X] T038 [P] [US3] Integration test in `backend/tests/integration/externalCollections/removalPreservesHistory.test.ts` covering quickstart.md Scenario 6 (FR-017: delete the `UploadedCollectionSet`, past run detail still returns its own `uploadedCollectionSnapshot` unaffected).

### Implementation for User Story 3

- [X] T039 [US3] Add the FR-015 cross-check (research.md D7) to `backend/src/api/testGenerationWorkflow.ts`'s existing `execution/start` handler: check `uploadedCollectionExecutionStore.getInProgressRun()` (T015) in addition to its own store, refusing with the existing `execution_in_progress` shape.
- [X] T040 [US3] Add the same cross-check — done as part of T024 (see its note). in the other direction inside `POST /:id/execution/start` (`backend/src/api/externalCollections.ts`, T024/T034): check `execution/executionRunStore.ts`'s `getInProgressRun()` in addition to the uploaded store's own.
- [X] T041 [US3] Add a static source label to each run list — `RunHistory` (the sub-component inside `frontend/src/components/ExecutionResultsPanel.tsx:392`, which only ever renders generated runs) gets a fixed "Generated" label/header, and `ExternalCollectionRunPanel.tsx`'s own run list (T030, which only ever renders `UploadedCollectionExecutionRun`s, always `source: "uploaded"`) gets a fixed "Uploaded" label/header. No shared field or component is needed — the two lists are already homogeneous by which panel they live in (research.md D9); do not add a `source` field to `ExecutionRun` to make this "shared" (see Phase 2 checkpoint note).
- [X] T042 [P] [US3] Frontend RTL test covering the source label rendering — extended `ExecutionResultsPanel.test.tsx` to assert "Generated" and `ExternalCollectionRunPanel.test.tsx` to assert "Uploaded"; the two are asserted separately rather than "in the same list" since research.md D9's separate-panel design means they are never rendered together.

**Checkpoint**: All three user stories independently functional. Run history/detail never conflates the two sources.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Frontend entry point wiring, full-fidelity script coverage, and repository-wide validation.

- [X] T043 [P] Add the two-tab view switcher ("Guided Workflow" / "Import & Run Collection") to `frontend/src/App.tsx` (research.md D9, FR-011) — both views stay mounted (`hidden` attribute toggling, not conditional unmount/remount) so switching tabs never discards either one's in-progress client state; new `frontend/src/pages/ExternalCollectionsPage.tsx` holds the standalone tab's own upload/list/run-panel state, with no dependency on `TestGenerationWorkflowPage`.
- [X] T044 [P] Frontend RTL test in `frontend/tests/unit/App.test.tsx` (extended): both tabs render, switching tabs preserves the guided workflow's own state (proven by it still showing the upload prompt after switching back), "Import & Run Collection" is reachable and functional with zero prior OpenAPI upload.
- [X] T045 [P] Integration test in `backend/tests/integration/externalCollections/scriptFidelity.test.ts`. The pre-request script adds an `X-Signature` header that has **no static representation anywhere in the collection JSON** (stronger proof of real execution than templating a `{{variable}}` into a statically-declared header would be) — this also sidesteps a real FR-004 edge case discovered while writing this test: a variable only ever set by a pre-request script (e.g. via `pm.variables.set(...)`) and then referenced via `{{...}}` in a static header/URL would currently be wrongly flagged "missing" by `missingUploadedVariableValues()`, since script-set variables are out of scope for `extractReferencedVariables()` (data-model.md's own stated scope: URL/headers/body text, not script content). This is a known, documented limitation, not a defect in what was actually specified/researched — recorded here for a future spec/plan revision rather than silently worked around.
- [X] T046 Ran `npm run build`, `npm run lint`, and `npm test` from the repo root: all clean (build: 4/4 workspaces; lint: 0 errors; tests: 1225 passed, 2 pre-existing skips, 0 failures).
- [~] T047 **Not performed** — no browser is available in this environment. Every quickstart.md scenario is instead validated by a real Supertest-driven integration test against the actual Express app, real SQLite, and real Newman execution (`uploadAndRun`, `confirmationGates`, `missingVariableValues`, `malformedUpload`, `listAndRemove`, `sharedExecutionSlot`, `removalPreservesHistory`, `scriptFidelity`), which is a stronger correctness signal than a manual click-through for the backend contract — but it does not exercise the real browser's file picker or confirmation-dialog interaction the way a human clicking through the actual UI would. Flagging this honestly per CLAUDE.md §54 rather than claiming a manual walkthrough that did not happen.

---

## Phase 7: Post-implementation addendum (2026-09-21) — selective run (FR-018)

**Purpose**: specs/028-collection-editor-ui's follow-up work added a Postman-Runner-style "choose which requests to run" screen; this phase is the backend capability it needed, added directly against this spec rather than through a separate spec-kit pass (small, additive, no new entity).

- [X] T048 [P] `extractReferencedVariables()` (`uploadedCollectionParsing.ts`) and `findDestructiveRequests()` (`destructiveRequests.ts`) each gain an optional `selectedItemIds?: Set<string>` parameter — scans only the given item ids when provided, unchanged when omitted.
- [X] T049 `runUploadedCollectionExecution()` gains an optional `selectedItemIds?: Set<string>` — an item not in the set is skipped inside the existing `Collection.forEachItem()` walk and never produces a result entry (not even `"not-attempted"`).
- [X] T050 `POST /:id/execution/start` parses an optional `selectedRequestIds: string[]` from the request body into a `Set<string>`, threads it through T048/T049, and returns `400 no_requests_selected` when the set is provided but matches none of the collection's current items.
- [X] T051 [P] Integration tests in `backend/tests/integration/externalCollections/selectiveRun.test.ts`: a selected subset is the only thing that runs and appears in `results`/`summary`; `400 no_requests_selected` for a selection matching nothing; omitting the field still runs (and gates against) every request, unchanged from before this addendum.
- [X] T052 `contracts/external-collections-api.md` and `data-model.md` updated for the new field/behavior.

**Checkpoint**: `npm test -w backend` passes with the new suite included; existing `uploadAndRun`/`confirmationGates` tests (T048's era) pass unmodified, confirming the omitted-field default is truly unchanged.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1 (needs the shared-domain types from T002 and the widened `newmanRunner.ts` item type from T003). Blocks all user stories.
- **US1 (Phase 3)**: Depends on Phase 2. No dependency on US2/US3.
- **US2 (Phase 4)**: Depends on Phase 2 and on T024's route existing (Phase 3) — it adds gates to the same handler. Cannot start before Phase 3's T024.
- **US3 (Phase 5)**: Depends on Phase 2 and on T024 (route to add the cross-check to) — independent of US2's confirmation-gate additions (different concern in the same file; sequence T034 before T039/T040 to avoid two people editing the same handler simultaneously, not because of a data dependency).
- **Polish (Phase 6)**: Depends on all three user stories being complete (T043's switcher renders the components every prior phase built).

### Within Each Phase

- Tests before/alongside the implementation they cover (write-first per CLAUDE.md §51 where practical; at minimum, tests land in the same task group as the code they verify and must pass before the phase checkpoint).
- Shared-domain types (Phase 1) → stores/repositories (Phase 2) → orchestration (Phase 3) → routes → frontend.

### Parallel Opportunities

- T002 (Phase 1) first; T003 depends on T002's `PostmanRawItem` type existing before it can widen `newmanRunner.ts`'s signature against it. T004 is parallel with both once the types it shape-tests exist.
- T006/T007/T009 (Phase 2) — different files, parallel; their respective unit tests (T008/T010/T012/T014/T016) parallel with each other once their implementation task lands.
- T018/T019/T020 (Phase 3 tests) — different files, parallel; can be written before T021-T026 land (will fail until then, per TDD).
- T028/T029/T030 (Phase 3 frontend components) — different files, parallel, once T027's client exists.
- T037/T038 (Phase 5 tests) — different files, parallel.
- T043/T044/T045 (Phase 6) — different files, parallel.

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch in parallel once T001-T004 (Phase 1) are done:
Task: "Create backend/src/externalCollections/errors.ts"
Task: "Create backend/src/externalCollections/uploadedCollectionParsing.ts"
Task: "Extract DESTRUCTIVE_METHODS and create backend/src/externalCollections/destructiveRequests.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP and VALIDATE**: run quickstart.md Scenarios 1-3 manually. This alone delivers spec.md's stated core value ("get the same per-request pass/fail visibility... without first uploading an OpenAPI specification").
3. Note: Phase 3 alone ships without the FR-007/FR-013 confirmation gates — acceptable as an internal milestone, **not** as a release; Phase 4 is required before any real user reaches this path (constitution XI, XVII).

### Incremental Delivery

1. Setup + Foundational → foundation ready, nothing user-reachable yet.
2. US1 (Phase 3) → internal milestone only (see note above).
3. US2 (Phase 4) → first safely-shippable increment (upload, run, confirmed trust boundary).
4. US3 (Phase 5) → run-history provenance distinction — shippable increment.
5. Polish (Phase 6) → standalone entry point wired, full validation run.

### Notes

- [P] tasks touch different files with no dependency on an incomplete task in the same phase.
- Each user story phase ends with a checkpoint restating spec.md's own Independent Test for that story.
- No task merges `uploaded_collections`/`uploaded_collection_runs` into the existing `environments`/`execution_runs` tables (research.md D4/D7) — keep them separate as designed.
- No task modifies `execution/mapNewmanResult.ts`'s existing behavior for generated runs (research.md D6) — `mapUploadedResult.ts` is additive and separate.
