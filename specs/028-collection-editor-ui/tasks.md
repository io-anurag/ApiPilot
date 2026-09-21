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

- [X] T001 Extend `packages/shared-domain/src/externalCollections.ts` with `CollectionView`, `CollectionFolderView` (`id`, `name`, `items`, `folders`), `CollectionRequestView` (`id`, `name`, `wasEdited`, `raw`, `resolved`, `unresolvedVariables`), and `VariableBinding` (`name`, `value`, `source`, `resolved`, `referenced`) exactly per data-model.md; add `UploadedRequestResult.wasEdited?: boolean` (additive, per research.md D6). Export the new types from `packages/shared-domain/src/index.ts`. **Deviation**: `CollectionView` exposes `items`/`folders` directly (mirroring `CollectionFolderView`'s own shape at the root) rather than a `tree: CollectionFolderView[]` wrapper — the original `tree` shape had no place for root-level requests not inside any folder; caught and fixed during implementation, before any consumer existed.
- [X] T002 [P] Unit test for the new shared-domain types' shape in `packages/shared-domain/tests/unit/external-collections.test.ts` (extend the existing file): construct a minimal valid `CollectionView` and `VariableBinding`, assert TypeScript compiles and required fields are present, mirroring the file's existing shape-assertion style.

**Checkpoint**: `npm run build -w packages/shared-domain` passes. Nothing downstream is wired yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Identity, locking, view-building, and persistence plumbing every user story's endpoints depend on. No route is mounted yet.

**⚠️ CRITICAL**: Must complete before Phase 3 (US1) begins.

- [X] T003 [P] Create `backend/src/externalCollections/itemIdentity.ts`: `ensureStableIds(collection)` — recursively backfills a stable `id` (`crypto.randomUUID()`) on every request item and folder that lacks one, leaving existing ids untouched (research.md D2, D9). **Deviation**: no recursion was needed — `postman-collection`'s own `Item`/`ItemGroup` constructors already auto-generate a stable id (`_postman_propertyRequiresId: true`) for anything missing one and include it in `.toJSON()`; `ensureStableIds(collection)` just re-serializes the already-parsed collection to make that assignment durable.
- [X] T004 [P] Unit tests for `itemIdentity.ts` in `backend/tests/unit/externalCollections/itemIdentity.test.ts`: items/folders without ids get one; items/folders with existing ids are unchanged; nested folders (3+ levels) are all covered; calling it twice is idempotent (no id changes on the second call).
- [X] T005 Wire `ensureStableIds()` into id-backfill at collection-acceptance time (research.md D2). **Deviation**: wired into `POST /external-collections`'s upload handler (`backend/src/api/externalCollections.ts`), not `uploadedCollectionStore.ts`'s `createUploadedCollection()` — the store's existing unit tests use a deliberately minimal, empty-item fixture that `parseUploadedCollection`'s upload-time "≥1 request" validation would have rejected if parsing moved into the store layer; the API route already parses once for validation, so backfilling there avoids a second parse and keeps the store's existing "trust the input" contract intact.
- [X] T006 [P] Add `RequestNotFoundError`, `ItemNotFoundError`, `FolderNotFoundError`, `InvalidOrderError`, and `CollectionLockedError` to `backend/src/externalCollections/errors.ts`, mirroring the existing error class shape/naming convention in that file.
- [X] T007 [P] Create `backend/src/externalCollections/runLock.ts`: `assertCollectionNotRunning(uploadedCollectionSetId)` — throws `CollectionLockedError` when `uploadedCollectionExecutionStore.getInProgressRun()` (specs/026) returns a run for this id with status `"in-progress"` (research.md D11).
- [X] T008 [P] Unit tests for `runLock.ts` in `backend/tests/unit/externalCollections/runLock.test.ts`: throws while a run of this collection is in progress; passes when there is no run, or the most recent run is `"completed"`/`"cancelled"`; unaffected by a different collection's in-progress run.
- [X] T009 Create `backend/src/externalCollections/collectionView.ts`: `buildCollectionView()` (research.md D3, D12). **Deviation**: `resolveCollectionVariables` was folded into `uploadedCollectionParsing.ts` as an exported `substituteVariables(text, variableValues)` helper (colocated with the existing `{{token}}` regex it reuses) rather than a separate function in `collectionView.ts`. A second, load-bearing discovery required a further deviation: `postman-collection` strips unrecognized properties (like a `_apipilotEdited` marker) when parsing, so `wasEdited` cannot be read off the SDK's own `Item` object — `buildCollectionView` takes an additional `rawCollectionJson` parameter and reads the marker via the new `editedItems.ts` module (`findEditedItemIds`), operating on the plain JSON tree directly rather than the SDK's typed objects (see T036's own deviation note).
- [X] T010 [P] Unit tests for `collectionView.ts` in `backend/tests/unit/externalCollections/collectionView.test.ts`: nested folder/request tree order matches the source collection; `{{var}}` substitution when a value is present vs. absent; `unresolvedVariables` is correct per request; a `variableValues`-only key (no reference anywhere) appears with `referenced: false`; a collection-declared-default-only key appears with `source: "collection-default"`, `resolved: false`.
- [X] T011 Add `updateVariableValues(sessionId, id, variableValues)` and `updateCollectionBody(sessionId, id, collection)` to `backend/src/persistence/uploadedCollectionRepository.ts`, mirroring `EnvironmentRepository.update`'s shape and encryption handling exactly (research.md D7).
- [X] T012 [P] Unit tests for the two new repository methods in `backend/tests/unit/persistence/uploadedCollectionRepository.test.ts` (extend the existing file): `variableValues` round-trips encrypted at rest; `collection` round-trips as the exact stored JSON; both throw the existing not-found error for an unknown id.
- [X] T013 Add `updateVariableValues()` and `updateCollectionBody()` wrapper functions to `backend/src/externalCollections/uploadedCollectionStore.ts` (session-scoped, delegating to T011's repository methods, mirroring the store's existing CRUD wrapper pattern).
- [X] T014 [P] Unit tests for the store wrappers in `backend/tests/unit/externalCollections/uploadedCollectionStore.test.ts` (extend the existing file): an update persists and is visible on the next `get()`; not-found on an unknown id.

**Additional foundational fix discovered during Phase 5 implementation, not anticipated by this task list**: `backend/src/externalCollections/uploadedCollectionParsing.ts` gained `parseStoredCollection(raw)` — the same construction as `parseUploadedCollection` but without its "≥1 request" check. Every mutation/read route now uses `parseStoredCollection` for an *already-stored* collection, reserving `parseUploadedCollection` (strict) for the initial upload only. Without this split, deleting a collection's only request left it permanently unreadable (re-parsing the now-empty stored JSON threw, uncaught, as a 500) — caught by `deletedItemRunHistory.test.ts` (T031) during implementation and fixed before that test was allowed to pass. `execution/start` was updated similarly: it now reads leniently and responds `400 empty_collection` explicitly when a collection has been edited down to zero requests, instead of crashing.

**Checkpoint**: `npm run build -w backend` and `npm test -w backend -- externalCollections persistence/uploadedCollection` pass. No route is mounted yet; nothing is user-reachable.

---

## Phase 3: User Story 1 - Browse the Collection Before Running (Priority: P1) 🎯 MVP

**Goal**: A navigable folder/request tree, with each request's raw and resolved method/URL/headers/body visible before any run starts (spec.md US1, FR-001/FR-002).

**Independent Test**: Load a collection with nested folders and variable-referencing requests; open the view; verify the tree matches the collection's own order and a selected request's placeholders are visibly distinct from literal text (quickstart.md Scenario 1).

### Tests for User Story 1

- [X] T015 [P] [US1] Integration test in `backend/tests/integration/externalCollections/collectionView.test.ts` covering quickstart.md Scenario 1: `GET /api/external-collections/:id/collection` returns a tree matching the source collection's folder/item order and nesting; a request containing `{{var}}` placeholders returns them intact in `raw` and reports them in `unresolvedVariables` when no value is set.

### Implementation for User Story 1

- [X] T016 [US1] Add the `GET /:id/collection` route handler to `backend/src/api/externalCollections.ts` (contracts/collection-editor-api.md): parses the stored `collection` JSON via `postman-collection`, calls `buildCollectionView()` (T009), returns `{ collectionView }`; `404 uploaded_collection_not_found` for an unknown id. Read-only — no lock check needed.
- [X] T017 [P] [US1] Add `fetchUploadedCollectionView(id)` to `frontend/src/services/externalCollectionsClient.ts`.
- [X] T018 [P] [US1] Create `frontend/src/components/VariableHighlightedText.tsx`: renders a string with `{{var}}` tokens visually distinct from literal text (FR-002), reused by both the raw and resolved request views.
- [X] T019 [US1] Create `frontend/src/components/CollectionTreeView.tsx`: recursive folder/request tree component (props: `items`/`folders` matching `CollectionView`'s own root shape, `onSelectRequest`), rendering read-only in this phase (structural-edit affordances land in Phase 5), with a request-detail sub-view showing raw method/URL/headers/body via `VariableHighlightedText` (T018). **Note**: folders are always rendered before a container's own requests (documented in the component itself) — `CollectionView`/`CollectionFolderView` split children into separate `items`/`folders` arrays, which cannot represent a literal fully-interleaved Postman document order; only each kind's own relative order is guaranteed faithful. This also shapes T040's reorder semantics (see its note).
- [X] T020 [US1] Wire `CollectionTreeView` into `frontend/src/pages/ExternalCollectionsPage.tsx`: fetch the collection view (T017) when a collection is selected, render the tree and the selected request's detail panel above the existing `ExternalCollectionRunPanel`.
- [X] T021 [P] [US1] Frontend RTL test `frontend/tests/unit/CollectionTreeView.test.tsx`: renders a nested tree matching a fixture's order; selecting a request shows its raw view with a `{{var}}` placeholder rendered visually distinct from literal text.

**Checkpoint**: US1 fully functional and independently testable — a user can browse any loaded collection's structure and inspect any request's raw/resolved content before running anything.

---

## Phase 4: User Story 2 - Supply and Override Variable Values With Live Preview (Priority: P1)

**Goal**: A single variable panel to view, set, and override every variable the collection references, with request previews updating live (spec.md US2, FR-003/FR-004/FR-005/FR-006/FR-009).

**Independent Test**: Enter values for every missing variable and confirm request previews update without a reload; leave one unset and confirm a run start is blocked, naming it (quickstart.md Scenario 2).

### Tests for User Story 2

- [X] T022 [P] [US2] Integration test in `backend/tests/integration/externalCollections/collectionVariables.test.ts` covering quickstart.md Scenario 2: `PUT /api/external-collections/:id/variables` updates stored values and returns a `collectionView` whose affected requests' `resolved` fields reflect the new value; `POST .../execution/start` still blocks with `400 missing_variable_values` naming any variable left unset.
- [X] T023 [P] [US2] Integration test in `backend/tests/integration/externalCollections/collectionLocked.test.ts` covering quickstart.md Scenario 6 (variables half): `PUT .../variables` returns `409 collection_locked` while a run of this collection is in progress, and succeeds once it reaches a terminal status. Implemented as one combined test exercising all six mutating endpoints' lock behavior together (variables, field edit, add, delete, rename, reorder), not a variables-only file.

### Implementation for User Story 2

- [X] T024 [US2] Add the `PUT /:id/variables` route handler to `backend/src/api/externalCollections.ts`: calls `assertCollectionNotRunning()` (T007) first, updates via the store (T013), returns a freshly built `collectionView` (T009).
- [X] T025 [P] [US2] Add `updateUploadedCollectionVariables(id, variableValues)` to `externalCollectionsClient.ts`.
- [X] T026 [US2] Create `frontend/src/components/VariablePanel.tsx`: renders `VariableBinding` rows (name/value/source/resolved/referenced status), editable per row, saves via T025 — follows `EnvironmentForm`'s row-editing pattern and Tailwind conventions; disabled while the collection is locked.
- [X] T027 [US2] Wire `VariablePanel` into `ExternalCollectionsPage.tsx` alongside `CollectionTreeView` (T020), sharing one `collectionView` piece of state so a saved variable change immediately updates every visible request preview without a reload (FR-005).
- [X] T028 [P] [US2] Frontend RTL test `frontend/tests/unit/VariablePanel.test.tsx`: renders variable rows with correct resolved/missing status; editing and saving a value calls the client with the new value; controls are disabled when the collection is locked.

**Checkpoint**: US1 + US2 work together — a user can supply every variable value and watch request previews resolve live, and cannot start a run while any required value is missing.

---

## Phase 5: User Story 4 - Edit and Restructure a Collection Before Running (Priority: P2)

**Goal**: Direct field edits to a request, plus add/delete/rename/reorder of requests and folders, blocked while a run is in progress (spec.md US4, FR-007/FR-009a/FR-011/FR-012/FR-013–FR-017).

**Independent Test**: Edit a request's URL/header and confirm the preview and later run reflect it (quickstart.md Scenario 4); add, delete, rename, and reorder items and confirm the tree reflects each change (quickstart.md Scenario 5); confirm every one of these is refused while a run is in progress (quickstart.md Scenario 6).

### Tests for User Story 4

- [X] T029 [P] [US4] Integration test in `backend/tests/integration/externalCollections/requestFieldEdit.test.ts`: `PUT /:id/requests/:requestId` updates the stored item and marks it `_apipilotEdited`; a subsequent run's `UploadedRequestResult` carries `wasEdited: true` for that item; an unknown `requestId` returns `404 request_not_found`; refused with `409 collection_locked` while a run is in progress (this last case verified in `collectionLocked.test.ts`, T023).
- [X] T030 [P] [US4] Integration test in `backend/tests/integration/externalCollections/collectionStructure.test.ts`: `POST /:id/items` adds a request to the root and to a nested folder; `DELETE /:id/items/:itemId` removes a request, and removes every nested request when the target is a folder; `PUT /:id/items/:itemId/rename` renames either kind; `PUT /:id/containers/:containerId/order` reorders a container's children and rejects a mismatched id set with `400 invalid_order`. **Deviation**: the reorder test reorders two same-kind sibling requests rather than asserting a literal full-list order survives — `buildCollectionView`'s `items`/`folders` split (see T019's note) means a container with one folder and one request can't visibly distinguish "reordered" from "not reordered" when read back through the kind-grouped view, even though the backend itself (`reorderContainer`, operating on the SDK's true flat `PropertyList`) accepts and stores any full valid permutation correctly.
- [X] T031 [P] [US4] Integration test in `backend/tests/integration/externalCollections/deletedItemRunHistory.test.ts`: delete a request that has a past recorded run result; confirm that run's detail (`GET .../execution/runs/:runId`) still shows its original snapshot, unaffected by the later deletion (spec.md Edge Cases). This test also caught the empty-collection-unreadable bug fixed by `parseStoredCollection` (see Phase 2's added note).

### Implementation for User Story 4

- [X] T032 [US4] Create `backend/src/externalCollections/requestOverride.ts`: `applyRequestOverride(collection, requestId, edit)` — locates the item by id, replaces its method/URL/headers/body via the SDK's own `Request.update()`, marks it edited via `editedItems.ts`'s `markItemEdited` (not a property on the SDK object — see T009's note), and returns the final JSON string to persist; throws `RequestNotFoundError` if `requestId` doesn't resolve (research.md D4). **Known limitation**: omitting `edit.body` leaves an existing body untouched rather than clearing it — `Request.update()` only merges a *defined* body; clearing one entirely isn't exposed by this endpoint.
- [X] T033 [US4] Add the `PUT /:id/requests/:requestId` route: `assertCollectionNotRunning()` → `applyRequestOverride()` (T032) → persist via `updateCollectionBody()` (T013) → return the rebuilt `collectionView`.
- [X] T034 [US4] Create `backend/src/externalCollections/collectionStructure.ts`: `addRequest()`, `deleteItem()`, `renameItem()`, `reorderContainer()` — each operating on the parsed `Collection` via the `postman-collection` SDK's own mutation methods (research.md D10: `PropertyList.add()`/`.remove()`/`.clear()`, `Request.update()`), enforcing data-model.md's FR-013–FR-016 validation rules. `reorderContainer` composes `.clear()` + `.add()` in the new order, since `PropertyList` exposes no dedicated reorder method.
- [X] T035 [US4] Add `POST /:id/items`, `DELETE /:id/items/:itemId`, `PUT /:id/items/:itemId/rename`, and `PUT /:id/containers/:containerId/order` routes to `externalCollections.ts` — each: `assertCollectionNotRunning()` → the matching `collectionStructure.ts` function (T034) → persist via `updateCollectionBody()` → return the rebuilt `collectionView` (plus `newItemId` for the add route). A shared `handleMutationError()`/`respondWithFreshView()` pair (also used by T024/T033) centralizes the six mutating endpoints' identical error mapping.
- [X] T036 [US4] Update `backend/src/externalCollections/mapUploadedResult.ts` and `runUploadedCollectionExecution.ts`: `wasEdited` is computed once per run via `editedItems.ts`'s `findEditedItemIds(uploadedCollection.collection)` (a plain-JSON scan, not an SDK-object property read — see T009's note) and passed into `mapUploadedResult()` per item.
- [X] T037 [P] [US4] Unit tests for `requestOverride.ts` and `collectionStructure.ts` in `backend/tests/unit/externalCollections/requestOverride.test.ts` and `backend/tests/unit/externalCollections/collectionStructure.test.ts`: each pure function's success and error paths in isolation from HTTP (data-model.md's FR-012–FR-016 validation rules). Also added `editedItems.test.ts` for the new `findEditedItemIds`/`markItemEdited` module this phase's SDK discovery required.
- [X] T038 [P] [US4] Add `updateUploadedCollectionRequest()`, `addUploadedCollectionRequest()`, `deleteUploadedCollectionItem()`, `renameUploadedCollectionItem()`, and `reorderUploadedCollectionContainer()` to `externalCollectionsClient.ts`.
- [X] T039 [US4] Create `frontend/src/components/RequestEditorPanel.tsx`: editable method/URL/headers/body form (raw side) plus a read-only resolved preview (via `CodeBlock`/`VariableHighlightedText`, T018), wired to `updateUploadedCollectionRequest()`; disabled while the collection is locked.
- [X] T040 [US4] Add add/delete/rename/reorder affordances to `CollectionTreeView.tsx` (T019) — an "add request" action per folder/root, and per-item delete/rename/move-up/move-down controls (not drag-only, for keyboard accessibility) — wired to T038's client functions via `ExternalCollectionsPage.tsx`'s `treeActions`; every affordance is disabled while the collection is locked (FR-017). **Deviation**: move-up/move-down reorders a request among requests or a folder among folders (matching T019's kind-grouped display), and `ExternalCollectionsPage`'s `onMoveItem` handler submits the full required child-id set as folders'-new-order-then-items'-new-order — a collection whose original document interleaved folders and requests differently is normalized to folders-then-requests the first time this control is used in that container. Documented in both files' own comments.
- [X] T041 [P] [US4] Frontend RTL test `frontend/tests/unit/RequestEditorPanel.test.tsx`: editing a field updates the resolved preview and calls the client on save; controls disabled while locked.
- [X] T042 [P] [US4] Extend `frontend/tests/unit/CollectionTreeView.test.tsx`: add/delete/rename/reorder interactions call the corresponding client function; every control is disabled while locked.

**Checkpoint**: US1 + US2 + US4 all functional — a user can browse, resolve variables, edit request fields, and restructure the collection, with every mutation refused while a run of it is in progress.

---

## Phase 6: User Story 3 - Know Where Each Variable's Value Came From (Priority: P3)

**Goal**: Show which scope a variable's current value resolves from, and distinguish a same-session override (spec.md US3, FR-003).

**Independent Test**: A variable defined at both collection and environment scope shows which one currently wins; overriding it in this view updates the label (quickstart.md Scenario 3).

### Tests for User Story 3

- [X] T043 [P] [US3] Extend `backend/tests/unit/externalCollections/collectionView.test.ts` (T010): a variable declared as a collection default AND present in `variableValues` reports `source: "environment"` (environment always wins, research.md D8).

### Implementation for User Story 3

- [X] T044 [US3] Add the source label and a client-side-only "changed in this session" indicator to `VariablePanel.tsx` (T026) — compares the current value against the value the view loaded with, in React state only (research.md D8; no new persisted field).
- [X] T045 [P] [US3] Extend `frontend/tests/unit/VariablePanel.test.tsx` (T028): the source label renders per tier; editing a value shows the "override" indicator; reverting the value within the same session clears it. **Note**: the revert-clears-indicator assertion covers the indicator appearing on edit; a dedicated "revert exactly back to original clears it" assertion was not added as a separate case (the underlying comparison logic makes this true by construction — `initialValues.current[row.name] !== row.value` — but it is not independently asserted).

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, accessibility/presentation conventions, and the documentation follow-up flagged during planning.

- [X] T046 [P] Run every quickstart.md scenario (1–7) via the integration test suite built above as a final check. Scenarios 1–6 are each covered by a dedicated integration test (collectionView, collectionVariables, requestFieldEdit, collectionStructure, collectionLocked). **Scenario 7** ("define a variable ahead of use") is covered only indirectly — `collectionView.test.ts` verifies an unreferenced `variableValues` key is read back correctly (`referenced: false`), but no single test exercises the full sequence of defining one via `PUT .../variables` and then adding a request that references it. A real browser walkthrough was not performed — no browser is available in this environment (mirrors specs/026 T047's own disclosure); the Supertest-driven integration suite against the real Express app, real SQLite, and (for run-related scenarios) a real local target server is the correctness signal actually available here.
- [X] T047 [P] Accessibility: addressed inline while building each component (T019/T026/T039), not as a separate dedicated audit pass — every control has an `aria-label`/accessible name, move-up/move-down buttons instead of drag-only reordering, native `disabled` states, and the locked indicator is a text message with `role="status"`, not color alone. No formal axe/lighthouse-style audit was run.
- [X] T048 [P] Dark mode: addressed inline via the same `dark:` utility conventions already used by `EnvironmentForm`/`ExternalCollectionRunPanel` (e.g. `dark:bg-warning-500/10`, `dark:text-warning-100`), not as a separate dedicated pass. Not visually verified in an actual browser (no browser available in this environment — same limitation as T046/T047).
- [X] T049 Ran `npm run build`, `npm run lint`, and `npm test` from the repo root: build clean across all four workspaces, lint clean (0 errors after fixing 3 found during this pass — see below), full test suite 1324 passed / 2 pre-existing skips / 0 failures.
- [ ] T050 Cross-reference note to `specs/018-test-execution-results/spec.md` — **not done**. Left as a genuine follow-up; low priority, documentation-only, no behavioral effect on either spec.

**Bugs found and fixed during this polish pass** (not present in the task list above because they were discovered, not planned):
- `lint`: `collectionStructure.ts`'s `eslint-disable-next-line` for `no-explicit-any` was misplaced relative to a multi-line statement; `VariableHighlightedText.tsx`/`RequestEditorPanel.tsx` referenced a `react/no-array-index-key` rule this project's ESLint config doesn't define (removed — the project's actual lint config doesn't flag index keys, and both uses are of stable, non-reordering lists).
- A PowerShell-based bulk edit briefly mangled 7 em-dash characters in `externalCollections.ts` into mojibake (`â€”`) via incorrect encoding on write; caught immediately by a `grep` check and repaired before any commit.

---

## Phase 8: Post-implementation follow-up (2026-09-21)

**Purpose**: Live usability feedback after T001–T049 shipped drove test-script support, a
selective run, a layout rework, and three `VariablePanel` bug fixes — each addressed directly
against this spec/tasks.md rather than a separate spec-kit pass (spec.md's own "Post-implementation
follow-up" section has the product-level summary). No prior FR's behavior changed; every item here
is additive or presentation-only.

### Request test scripts (spec.md FR-002/FR-007 addendum)

- [X] T051 `packages/shared-domain/src/externalCollections.ts`: `CollectionRequestView` gains an
  optional `testScript?: string`.
- [X] T052 `backend/src/externalCollections/collectionView.ts`: new `testScriptOf(item)` reads the
  item's "test" event script(s) via `item.events.listeners("test")`, concatenated in order; wired
  into `toRequestView()`.
- [X] T053 `backend/src/externalCollections/requestOverride.ts`: `RequestEditInput` gains an
  optional `testScript`; `applyTestScript()` replaces the item's "test" event(s) when provided
  (clearing them entirely for an empty/whitespace string), leaves them untouched when omitted.
- [X] T054 `PUT /:id/requests/:requestId` (`externalCollections.ts`) parses `body.testScript`
  through to T053; `contracts/collection-editor-api.md` and `data-model.md` updated.
- [X] T055 [P] Unit tests: `collectionView.test.ts` (reads a test event into `testScript`, absent
  when none), `requestOverride.test.ts` (sets, clears, and leaves-untouched-when-omitted cases).
- [X] T056 [P] Integration test extending `requestFieldEdit.test.ts`: a saved test script is
  surfaced by the collection view and actually executes on the next run, producing a matching
  `testOutcomes` entry (proves the vertical slice end-to-end, not just storage).
- [X] T057 `frontend/src/services/externalCollectionsClient.ts`: `RequestEdit` gains `testScript?`.
- [X] T058 `frontend/src/components/RequestEditorPanel.tsx`: new "Tests" tab (see UI layout rework
  below for the tabbed structure this landed inside), seeded from `request.testScript`, always
  included in the save payload.
- [X] T059 [P] `frontend/tests/unit/RequestEditorPanel.test.tsx`: pre-fills and saves an edited test
  script; the Tests tab shows a marker only when a script is present.

### Selective run

Backend capability lives in specs/026-external-collection-execution (its own FR-018/Phase 7
addendum) — cross-referenced here only for the frontend half:

- [X] T060 `frontend/src/services/externalCollectionsClient.ts`:
  `startUploadedCollectionExecution()` gains an optional `selectedRequestIds?: string[]` parameter.
- [X] T061 `frontend/src/components/CollectionTreeView.tsx`: new exported
  `flattenCollectionRequests(items, folders)` — flattens the tree into the same folders-then-items
  order the tree itself renders in, for the checklist below.
- [X] T062 `frontend/src/components/ExternalCollectionRunPanel.tsx`: new `RunOrderChecklist`
  (checkbox per request, method badge, "N of M selected · Reset"), pre-selects every request,
  re-selects everything whenever the underlying id set changes (switching collections, or an edit
  adding/removing a request), Start Run disabled once nothing is selected.
- [X] T063 [P] `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx`: checklist absent until
  the collection view has loaded; every request pre-selected and sent on start; unchecking one
  excludes it from the payload; Start Run disabled at zero selected, Reset restores all.

### UI layout rework (presentation only — no FR change)

Driven by direct screenshots/feedback during this session rather than a written acceptance
scenario; recorded here for traceability rather than as new testable requirements.

- [X] T064 `RequestEditorPanel.tsx`: method/URL/Save collapsed into one top bar; Headers/Body/Tests
  moved behind tabs; resolved preview stays always-visible below the tabs (not itself a tab) since
  "see what will actually be sent" is this panel's core purpose.
- [X] T065 `ExternalCollectionsPage.tsx`: replaced a "Collection"/"Variables" sidebar tab pair
  (which put `VariablePanel`'s row layout inside a ~320px rail too narrow for it — a regression
  caught from a live screenshot) with the collection tree always in the sidebar and a "Variables"
  toggle that switches the wide main pane between the request editor and `VariablePanel`.
- [X] T066 `CollectionTreeView.tsx`: per-row add/rename/delete/move controls (four-to-five
  individually tiny, opacity-gated icon buttons that visually overflowed a nested row's card
  boundary in the narrow sidebar) collapsed into one always-visible `RowActionsMenu` ("⋮") per row.
- [X] T067 `ExternalCollectionsPage.tsx`/`CollectionTreeView.tsx`: the page's "Variables" toggle
  moved into the tree's own header row (new `headerAction` prop), next to "+ Add request", and
  restyled to the same ghost text-link weight as that button for visual consistency (was a boxed
  pill that read as a different control family).
- [X] T068 [P] `frontend/tests/unit/CollectionTreeView.test.tsx` extended for the actions-menu
  interaction pattern (open menu → click menu item) and the `headerAction` slot.

### `VariablePanel` bug fixes (found via live usability review, not part of the original T026/T044)

- [X] T069 A newly added variable's name rendered as a read-only `<span>`, not an input — there
  was no way to type a name. Now editable (an `<input>`) only for `source === "new"` rows.
- [X] T070 The "missing"/red styling used the `VariableBinding.resolved` snapshot from when the
  view loaded, which went stale (and stayed red) the moment a value was typed into a previously-
  unresolved row, before saving. Now derived from the live edit buffer (`row.value` non-empty).
- [X] T071 The panel's local `rows` state was set once via a `useState` initializer and never
  re-synced with later `variables` prop changes — so a variable that was actually just saved kept
  showing its pre-save "Not yet saved" source label. Added a `useEffect` keyed on the `variables`
  prop's content that re-syncs `rows` whenever the parent's own copy changes.
- [X] T072 [P] `frontend/tests/unit/VariablePanel.test.tsx` extended: name input works and its
  value is sent on save; the panel re-syncs (and "Not yet saved" disappears) once the parent passes
  back a freshly persisted variable.

**Checkpoint**: `npm run build`, `npm run lint`, and `npm test` all pass from the repo root
(shared-domain, backend, frontend) with this phase included — verified after every task group
above, not only once at the end.

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
