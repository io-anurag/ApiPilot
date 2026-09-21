---

description: "Task list for Postman-Style Collection & Variable Editor"
---

# Tasks: Postman-Style Collection & Variable Editor

**Input**: Design documents from `/specs/028-collection-editor-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/collection-editor-api.md, quickstart.md

**Tests**: Included. This is Trivium/ApiPilot code — CLAUDE.md §51/§54 require unit/integration tests as part of the feature, not an afterthought, and the sibling feature this one extends (specs/026-external-collection-execution) shipped with backend unit + integration tests and frontend RTL tests throughout.

**Organization**: Tasks are grouped by user story (spec.md priorities: US1 P1, US2 P1, US4 P2, US3 P3) so each can be implemented and independently verified per its own Acceptance Scenarios / Independent Test. US1 and US2 are both P1; US1 is sequenced first because US2's variable panel is wired into the collection view US1 builds.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 / US4 per spec.md
- Every task names its exact file path

## Path Conventions

Existing web-application layout (plan.md Structure Decision): `backend/src/`, `frontend/src/`, `packages/shared-domain/src/`, with tests under `backend/tests/`, `frontend/tests/`, `packages/shared-domain/tests/`.

---

## Phase 1: Setup

**Purpose**: Extend the shared-domain contract every later phase depends on. No new dependency is required (research.md "Technology confirmation").

- [ ] T001 Extend `packages/shared-domain/src/externalCollections.ts` with `CollectionView`, `CollectionFolderView` (`id`, `name`, `items`, `folders`), `CollectionRequestView` (`id`, `name`, `wasEdited`, `raw`, `resolved`, `unresolvedVariables`), and `VariableBinding` (`name`, `value`, `source`, `resolved`, `referenced`) exactly per data-model.md; add `UploadedRequestResult.wasEdited?: boolean` (additive, per research.md D6). Export the new types from `packages/shared-domain/src/index.ts`.
- [ ] T002 [P] Unit test for the new shared-domain types' shape in `packages/shared-domain/tests/unit/external-collections.test.ts` (extend the existing file): construct a minimal valid `CollectionView` and `VariableBinding`, assert TypeScript compiles and required fields are present, mirroring the file's existing shape-assertion style.

**Checkpoint**: `npm run build -w packages/shared-domain` passes. Nothing downstream is wired yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Identity, locking, view-building, and persistence plumbing every user story's endpoints depend on. No route is mounted yet.

**⚠️ CRITICAL**: Must complete before Phase 3 (US1) begins.

- [ ] T003 [P] Create `backend/src/externalCollections/itemIdentity.ts`: `ensureStableIds(collection)` — recursively backfills a stable `id` (`crypto.randomUUID()`) on every request item and folder that lacks one, leaving existing ids untouched (research.md D2, D9).
- [ ] T004 [P] Unit tests for `itemIdentity.ts` in `backend/tests/unit/externalCollections/itemIdentity.test.ts`: items/folders without ids get one; items/folders with existing ids are unchanged; nested folders (3+ levels) are all covered; calling it twice is idempotent (no id changes on the second call).
- [ ] T005 Wire `ensureStableIds()` into `uploadedCollectionStore.ts`'s `createUploadedCollection()` (specs/026) so every newly stored or handed-off collection has stable ids from creation onward, before it is ever persisted (research.md D2).
- [ ] T006 [P] Add `RequestNotFoundError`, `ItemNotFoundError`, `FolderNotFoundError`, `InvalidOrderError`, and `CollectionLockedError` to `backend/src/externalCollections/errors.ts`, mirroring the existing error class shape/naming convention in that file.
- [ ] T007 [P] Create `backend/src/externalCollections/runLock.ts`: `assertCollectionNotRunning(uploadedCollectionSetId)` — throws `CollectionLockedError` when `uploadedCollectionExecutionStore.getInProgressRun()` (specs/026) returns a run for this id with status `"in-progress"` (research.md D11).
- [ ] T008 [P] Unit tests for `runLock.ts` in `backend/tests/unit/externalCollections/runLock.test.ts`: throws while a run of this collection is in progress; passes when there is no run, or the most recent run is `"completed"`/`"cancelled"`; unaffected by a different collection's in-progress run.
- [ ] T009 Create `backend/src/externalCollections/collectionView.ts`: `resolveCollectionVariables(collection, variableValues)` (research.md D3) and `buildCollectionView(collection, variableValues)` (research.md D3, D12 — the variable list unions variables referenced by a request, variables the collection's own `variable` array declares, and any key already present in `variableValues` with no current reference; the tree carries raw and resolved method/url/headers/body per item, per data-model.md).
- [ ] T010 [P] Unit tests for `collectionView.ts` in `backend/tests/unit/externalCollections/collectionView.test.ts`: nested folder/request tree order matches the source collection; `{{var}}` substitution when a value is present vs. absent; `unresolvedVariables` is correct per request; a `variableValues`-only key (no reference anywhere) appears with `referenced: false`; a collection-declared-default-only key appears with `source: "collection-default"`, `resolved: false`.
- [ ] T011 Add `updateVariableValues(sessionId, id, variableValues)` and `updateCollectionBody(sessionId, id, collection)` to `backend/src/persistence/uploadedCollectionRepository.ts`, mirroring `EnvironmentRepository.update`'s shape and encryption handling exactly (research.md D7).
- [ ] T012 [P] Unit tests for the two new repository methods in `backend/tests/unit/persistence/uploadedCollectionRepository.test.ts` (extend the existing file): `variableValues` round-trips encrypted at rest; `collection` round-trips as the exact stored JSON; both throw the existing not-found error for an unknown id.
- [ ] T013 Add `updateVariableValues()` and `updateCollectionBody()` wrapper functions to `backend/src/externalCollections/uploadedCollectionStore.ts` (session-scoped, delegating to T011's repository methods, mirroring the store's existing CRUD wrapper pattern).
- [ ] T014 [P] Unit tests for the store wrappers in `backend/tests/unit/externalCollections/uploadedCollectionStore.test.ts` (extend the existing file): an update persists and is visible on the next `get()`; not-found on an unknown id.

**Checkpoint**: `npm run build -w backend` and `npm test -w backend -- externalCollections persistence/uploadedCollection` pass. No route is mounted yet; nothing is user-reachable.

---

## Phase 3: User Story 1 - Browse the Collection Before Running (Priority: P1) 🎯 MVP

**Goal**: A navigable folder/request tree, with each request's raw and resolved method/URL/headers/body visible before any run starts (spec.md US1, FR-001/FR-002).

**Independent Test**: Load a collection with nested folders and variable-referencing requests; open the view; verify the tree matches the collection's own order and a selected request's placeholders are visibly distinct from literal text (quickstart.md Scenario 1).

### Tests for User Story 1

- [ ] T015 [P] [US1] Integration test in `backend/tests/integration/externalCollections/collectionView.test.ts` covering quickstart.md Scenario 1: `GET /api/external-collections/:id/collection` returns a tree matching the source collection's folder/item order and nesting; a request containing `{{var}}` placeholders returns them intact in `raw` and reports them in `unresolvedVariables` when no value is set.

### Implementation for User Story 1

- [ ] T016 [US1] Add the `GET /:id/collection` route handler to `backend/src/api/externalCollections.ts` (contracts/collection-editor-api.md): parses the stored `collection` JSON via `postman-collection`, calls `buildCollectionView()` (T009), returns `{ collectionView }`; `404 uploaded_collection_not_found` for an unknown id. Read-only — no lock check needed.
- [ ] T017 [P] [US1] Add `fetchUploadedCollectionView(id)` to `frontend/src/services/externalCollectionsClient.ts`.
- [ ] T018 [P] [US1] Create `frontend/src/components/VariableHighlightedText.tsx`: renders a string with `{{var}}` tokens visually distinct from literal text (FR-002), reused by both the raw and resolved request views.
- [ ] T019 [US1] Create `frontend/src/components/CollectionTreeView.tsx`: recursive folder/request tree component (props: `tree: CollectionFolderView[]`, `items: CollectionRequestView[]`, `onSelect`), rendering read-only in this phase (structural-edit affordances land in Phase 5), with a request-detail sub-view showing raw method/URL/headers/body via `VariableHighlightedText` (T018).
- [ ] T020 [US1] Wire `CollectionTreeView` into `frontend/src/pages/ExternalCollectionsPage.tsx`: fetch the collection view (T017) when a collection is selected, render the tree and the selected request's detail panel above the existing `ExternalCollectionRunPanel`.
- [ ] T021 [P] [US1] Frontend RTL test `frontend/tests/unit/CollectionTreeView.test.tsx`: renders a nested tree matching a fixture's order; selecting a request shows its raw view with a `{{var}}` placeholder rendered visually distinct from literal text.

**Checkpoint**: US1 fully functional and independently testable — a user can browse any loaded collection's structure and inspect any request's raw/resolved content before running anything.

---

## Phase 4: User Story 2 - Supply and Override Variable Values With Live Preview (Priority: P1)

**Goal**: A single variable panel to view, set, and override every variable the collection references, with request previews updating live (spec.md US2, FR-003/FR-004/FR-005/FR-006/FR-009).

**Independent Test**: Enter values for every missing variable and confirm request previews update without a reload; leave one unset and confirm a run start is blocked, naming it (quickstart.md Scenario 2).

### Tests for User Story 2

- [ ] T022 [P] [US2] Integration test in `backend/tests/integration/externalCollections/collectionVariables.test.ts` covering quickstart.md Scenario 2: `PUT /api/external-collections/:id/variables` updates stored values and returns a `collectionView` whose affected requests' `resolved` fields reflect the new value; `POST .../execution/start` still blocks with `400 missing_variable_values` naming any variable left unset.
- [ ] T023 [P] [US2] Integration test in `backend/tests/integration/externalCollections/collectionLocked.test.ts` covering quickstart.md Scenario 6 (variables half): `PUT .../variables` returns `409 collection_locked` while a run of this collection is in progress, and succeeds once it reaches a terminal status.

### Implementation for User Story 2

- [ ] T024 [US2] Add the `PUT /:id/variables` route handler to `backend/src/api/externalCollections.ts`: calls `assertCollectionNotRunning()` (T007) first, updates via the store (T013), returns a freshly built `collectionView` (T009).
- [ ] T025 [P] [US2] Add `updateUploadedCollectionVariables(id, variableValues)` to `externalCollectionsClient.ts`.
- [ ] T026 [US2] Create `frontend/src/components/VariablePanel.tsx`: renders `VariableBinding` rows (name/value/source/resolved/referenced status), editable per row, saves via T025 — follows `EnvironmentForm`'s row-editing pattern and Tailwind conventions; disabled while the collection is locked.
- [ ] T027 [US2] Wire `VariablePanel` into `ExternalCollectionsPage.tsx` alongside `CollectionTreeView` (T020), sharing one `collectionView` piece of state so a saved variable change immediately updates every visible request preview without a reload (FR-005).
- [ ] T028 [P] [US2] Frontend RTL test `frontend/tests/unit/VariablePanel.test.tsx`: renders variable rows with correct resolved/missing status; editing and saving a value calls the client with the new value; controls are disabled when the collection is locked.

**Checkpoint**: US1 + US2 work together — a user can supply every variable value and watch request previews resolve live, and cannot start a run while any required value is missing.

---

## Phase 5: User Story 4 - Edit and Restructure a Collection Before Running (Priority: P2)

**Goal**: Direct field edits to a request, plus add/delete/rename/reorder of requests and folders, blocked while a run is in progress (spec.md US4, FR-007/FR-009a/FR-011/FR-012/FR-013–FR-017).

**Independent Test**: Edit a request's URL/header and confirm the preview and later run reflect it (quickstart.md Scenario 4); add, delete, rename, and reorder items and confirm the tree reflects each change (quickstart.md Scenario 5); confirm every one of these is refused while a run is in progress (quickstart.md Scenario 6).

### Tests for User Story 4

- [ ] T029 [P] [US4] Integration test in `backend/tests/integration/externalCollections/requestFieldEdit.test.ts`: `PUT /:id/requests/:requestId` updates the stored item and marks it `_apipilotEdited`; a subsequent run's `UploadedRequestResult` carries `wasEdited: true` for that item; an unknown `requestId` returns `404 request_not_found`; refused with `409 collection_locked` while a run is in progress.
- [ ] T030 [P] [US4] Integration test in `backend/tests/integration/externalCollections/collectionStructure.test.ts`: `POST /:id/items` adds a request to the root and to a nested folder; `DELETE /:id/items/:itemId` removes a request, and removes every nested request when the target is a folder; `PUT /:id/items/:itemId/rename` renames either kind; `PUT /:id/containers/:containerId/order` reorders a container's children and rejects a mismatched id set with `400 invalid_order`; each of the four returns `409 collection_locked` while a run is in progress.
- [ ] T031 [P] [US4] Integration test in `backend/tests/integration/externalCollections/deletedItemRunHistory.test.ts`: delete a request that has a past recorded run result; confirm that run's detail (`GET .../execution/runs/:runId`) still shows its original snapshot, unaffected by the later deletion (spec.md Edge Cases).

### Implementation for User Story 4

- [ ] T032 [US4] Create `backend/src/externalCollections/requestOverride.ts`: `applyRequestOverride(collection, requestId, edit)` — locates the item by id, replaces its method/URL/headers/body, sets `_apipilotEdited: true`; throws `RequestNotFoundError` if `requestId` doesn't resolve (research.md D4).
- [ ] T033 [US4] Add the `PUT /:id/requests/:requestId` route: `assertCollectionNotRunning()` → `applyRequestOverride()` (T032) → persist via `updateCollectionBody()` (T013) → return the rebuilt `collectionView`.
- [ ] T034 [US4] Create `backend/src/externalCollections/collectionStructure.ts`: `addRequest()`, `deleteItem()`, `renameItem()`, `reorderContainer()` — each operating on the parsed `Collection` via the `postman-collection` SDK's own mutation methods (research.md D10), enforcing data-model.md's FR-013–FR-016 validation rules.
- [ ] T035 [US4] Add `POST /:id/items`, `DELETE /:id/items/:itemId`, `PUT /:id/items/:itemId/rename`, and `PUT /:id/containers/:containerId/order` routes to `externalCollections.ts` — each: `assertCollectionNotRunning()` → the matching `collectionStructure.ts` function (T034) → persist via `updateCollectionBody()` → return the rebuilt `collectionView` (plus `newItemId` for the add route).
- [ ] T036 [US4] Update `backend/src/externalCollections/mapUploadedResult.ts`: read the `_apipilotEdited` marker off the executed item and set `UploadedRequestResult.wasEdited` accordingly (research.md D6).
- [ ] T037 [P] [US4] Unit tests for `requestOverride.ts` and `collectionStructure.ts` in `backend/tests/unit/externalCollections/requestOverride.test.ts` and `backend/tests/unit/externalCollections/collectionStructure.test.ts`: each pure function's success and error paths in isolation from HTTP (data-model.md's FR-012–FR-016 validation rules).
- [ ] T038 [P] [US4] Add `updateUploadedCollectionRequest()`, `addUploadedCollectionRequest()`, `deleteUploadedCollectionItem()`, `renameUploadedCollectionItem()`, and `reorderUploadedCollectionContainer()` to `externalCollectionsClient.ts`.
- [ ] T039 [US4] Create `frontend/src/components/RequestEditorPanel.tsx`: editable method/URL/headers/body form (raw side) plus a read-only resolved preview (via `CodeBlock`/`VariableHighlightedText`, T018), wired to `updateUploadedCollectionRequest()`; disabled while the collection is locked.
- [ ] T040 [US4] Add add/delete/rename/reorder affordances to `CollectionTreeView.tsx` (T019) — an "add request" action per folder/root, and per-item delete/rename/move controls (move-up/move-down rather than drag-only, for keyboard accessibility) — wired to T038's client functions; every affordance is disabled while the collection is locked, matching the read-only state `ExternalCollectionsPage` passes down (FR-017).
- [ ] T041 [P] [US4] Frontend RTL test `frontend/tests/unit/RequestEditorPanel.test.tsx`: editing a field updates the resolved preview and calls the client on save; controls disabled while locked.
- [ ] T042 [P] [US4] Extend `frontend/tests/unit/CollectionTreeView.test.tsx`: add/delete/rename/reorder interactions call the corresponding client function; every control is disabled while locked.

**Checkpoint**: US1 + US2 + US4 all functional — a user can browse, resolve variables, edit request fields, and restructure the collection, with every mutation refused while a run of it is in progress.

---

## Phase 6: User Story 3 - Know Where Each Variable's Value Came From (Priority: P3)

**Goal**: Show which scope a variable's current value resolves from, and distinguish a same-session override (spec.md US3, FR-003).

**Independent Test**: A variable defined at both collection and environment scope shows which one currently wins; overriding it in this view updates the label (quickstart.md Scenario 3).

### Tests for User Story 3

- [ ] T043 [P] [US3] Extend `backend/tests/unit/externalCollections/collectionView.test.ts` (T010): a variable declared as a collection default AND present in `variableValues` reports `source: "environment"` (environment always wins, research.md D8).

### Implementation for User Story 3

- [ ] T044 [US3] Add the source label and a client-side-only "changed in this session" indicator to `VariablePanel.tsx` (T026) — compares the current value against the value the view loaded with, in React state only (research.md D8; no new persisted field).
- [ ] T045 [P] [US3] Extend `frontend/tests/unit/VariablePanel.test.tsx` (T028): the source label renders per tier; editing a value shows the "override" indicator; reverting the value within the same session clears it.

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, accessibility/presentation conventions, and the documentation follow-up flagged during planning.

- [ ] T046 [P] Run every quickstart.md scenario (1–7) via the integration test suite built above as a final check; if any cannot be exercised in this environment (e.g., a real browser walkthrough), state that honestly rather than claiming it, per CLAUDE.md §54 (mirrors specs/026 T047's approach).
- [ ] T047 [P] Accessibility pass on `CollectionTreeView.tsx`, `VariablePanel.tsx`, and `RequestEditorPanel.tsx`: keyboard-reachable expand/collapse and move-up/move-down controls (not drag-only), visible focus states, accessible names for every add/delete/rename/reorder action, and a non-color indicator (not just styling) for a locked/read-only state (CLAUDE.md §38–39).
- [ ] T048 [P] Dark-mode and Tailwind-convention pass across all new components, matching the established `EnvironmentForm`/`ExternalCollectionRunPanel` visual language (CLAUDE.md §26–42).
- [ ] T049 Run `npm run build`, `npm run lint`, and `npm test` from the repo root; confirm all clean.
- [ ] T050 [P] Add a short cross-reference note to `specs/018-test-execution-results/spec.md` (or its own changelog/notes section, whichever that spec already uses) acknowledging that this feature's execution-time override layer extends its "does not change how the artifact is generated" boundary at the generation layer only (flagged in `specs/028-collection-editor-ui/checklists/requirements.md`) — a documentation follow-up, not a behavioral change to specs/018 itself.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1 (needs the shared-domain types from T001). Blocks all user stories.
- **US1 (Phase 3)**: Depends on Phase 2. No dependency on US2/US3/US4.
- **US2 (Phase 4)**: Depends on Phase 2. Its frontend wiring (T027) depends on US1's `ExternalCollectionsPage` wiring (T020) existing to attach to — sequence Phase 3 before Phase 4 for that reason, not a data dependency.
- **US4 (Phase 5)**: Depends on Phase 2. Its frontend wiring (T040) extends `CollectionTreeView.tsx` (T019, US1) and reuses `VariableHighlightedText.tsx` (T018, US1) — sequence Phase 3 before Phase 5.
- **US3 (Phase 6)**: Depends on Phase 2 and on `VariablePanel.tsx` existing (T026, US2) — sequence Phase 4 before Phase 6.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent once Phase 2 is done.
- **US2 (P1)**: Independently testable via its own backend endpoint/tests; its frontend piece attaches to US1's page wiring.
- **US4 (P2)**: Independently testable via its own backend endpoints/tests; its frontend piece attaches to US1's tree/highlight components.
- **US3 (P3)**: Independently testable via its own backend assertion; its frontend piece attaches to US2's variable panel.

### Within Each Phase

- Tests before/alongside the implementation they cover (write-first per CLAUDE.md §51 where practical).
- Pure functions (Foundational) → routes → frontend client → frontend components → frontend wiring.

### Parallel Opportunities

- T003/T006/T007/T009 (Phase 2) — different files, parallel; their respective unit tests (T004/T008/T010) parallel with each other once their implementation task lands. T011 depends on none of these (different file) and can run in parallel too; T013 depends on T011.
- T015 (Phase 3 test) can be written before T016 lands (will fail until then, per TDD).
- T017/T018 (Phase 3 frontend) — different files, parallel.
- T022/T023 (Phase 4 tests) — different files, parallel.
- T029/T030/T031 (Phase 5 tests) — different files, parallel.
- T037/T038 (Phase 5) — different files, parallel, once T032/T034 land.
- T046/T047/T048 (Phase 7) — different concerns, parallel.

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch in parallel once T001-T002 (Phase 1) are done:
Task: "Create backend/src/externalCollections/itemIdentity.ts"
Task: "Add new error classes to backend/src/externalCollections/errors.ts"
Task: "Create backend/src/externalCollections/runLock.ts"
Task: "Create backend/src/externalCollections/collectionView.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP and VALIDATE**: run quickstart.md Scenario 1. This alone delivers the "see what is happening" half of the original ask — a user can inspect any loaded collection before running it, even before variable editing or structural changes exist.

### Incremental Delivery

1. Setup + Foundational → foundation ready, nothing user-reachable yet.
2. US1 (Phase 3) → browsable, inspectable collection view — first shippable increment.
3. US2 (Phase 4) → variable supply/override with live preview — delivers "provide values to all variables."
4. US4 (Phase 5) → field edits plus add/delete/rename/reorder — delivers "flexibility to edit the collection" in full.
5. US3 (Phase 6) → variable source/override labeling — trust/auditability polish.
6. Polish (Phase 7) → accessibility, presentation, and full validation pass.

### Notes

- [P] tasks touch different files with no dependency on an incomplete task in the same phase.
- Each user story phase ends with a checkpoint restating spec.md's own Independent Test for that story.
- No task modifies `Environment`, `ExecutionRun`, `RequestResult`, `TestModel`, or `TestScenario` (research.md, data-model.md) — every change is additive to `UploadedCollectionSet`-adjacent code.
- No task merges structural-edit persistence into a new table (research.md D7) — edits mutate the existing `uploaded_collections.collection` column in place via `updateCollectionBody()`.
