# Phase 1 Data Model: Postman-Style Collection & Variable Editor

All new types live in `packages/shared-domain/src/externalCollections.ts`, alongside
`UploadedCollectionSet`/`UploadedRequestResult`/`UploadedCollectionExecutionRun` (research.md D1).
`Environment`, `ExecutionRun`, `RequestResult`, `TestModel`, `TestScenario` are untouched —
nothing here modifies an AP-017/AP-009 type.

## Extended: `UploadedCollectionSet`

No field changes to the stored shape (research.md D7). Two behavioral additions to its `collection`
JSON body, applied only at write time by the new repository methods below:

- Every item gains a stable `id` if it did not already have one (research.md D2).
- An item that has been edited via `PUT .../requests/:requestId` (below) carries one additional
  boolean property, `_apipilotEdited: true`, alongside its existing Postman fields — an
  extension property the Postman schema already tolerates as unknown data, not a new column.

## New: `CollectionView` (response shape, not a stored entity)

The read model `GET /api/external-collections/:id/collection` (contracts/collection-editor-api.md)
returns — computed on demand from the stored `UploadedCollectionSet`, never persisted itself.

**Corrected from the original design below** (caught and fixed during implementation, before any
consumer existed — tasks.md T001's own deviation note): the root container is `items`/`folders`
directly on `CollectionView`, not a single `tree: CollectionFolderView[]` wrapper. A `tree` array
of folders had no place to put a root-level request that lives directly in the collection root
rather than inside any folder — `items`/`folders` mirrors `CollectionFolderView`'s own shape at
the root instead, matching the `containerId: "root"` literal the reorder endpoint already uses.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | The `UploadedCollectionSet.id` this view was computed from. |
| `items` | `CollectionRequestView[]` | The collection's own root-level requests, in source order (FR-001). |
| `folders` | `CollectionFolderView[]` | The collection's own root-level folders, in source order (FR-001). |
| `variables` | `VariableBinding[]` | Every variable referenced anywhere in the collection, plus any user-defined-ahead-of-use one (FR-003, FR-018). |

```ts
interface CollectionFolderView {
  id: string;                  // stable folder id (research.md D9); the root itself has no id —
                                // it's CollectionView's own items/folders, not a synthesized folder
  name: string;
  items: CollectionRequestView[];
  folders: CollectionFolderView[]; // nested folders, arbitrary depth
}

interface CollectionRequestView {
  id: string;                 // stable item id (research.md D2)
  name: string;
  wasEdited: boolean;          // reflects `_apipilotEdited`
  raw: {                       // exactly as stored, placeholders intact (FR-002)
    method: string;
    url: string;
    headers: Array<{ key: string; value: string }>;
    body?: string;
  };
  resolved: {                  // raw with every resolvable `{{var}}` substituted (FR-002, D3)
    method: string;
    url: string;
    headers: Array<{ key: string; value: string }>;
    body?: string;
  };
  unresolvedVariables: string[]; // names still unresolved within this specific request
  testScript?: string;          // post-implementation addendum (2026-09-21) — see below
}
```

### Post-implementation addendum (2026-09-21): the request's own test script

Added directly against this spec once a live UI walkthrough surfaced that a request's own
`pm.test(...)` script — the exact thing `UploadedTestOutcome.name` in a run result is named after
(specs/026 data-model.md) — was executed but never made visible or editable anywhere pre-run,
despite FR-007's "directly edit... in addition to setting variable values" already covering every
other raw field. Not a new FR number; folded into FR-002/FR-007's existing scope rather than
renumbered, since it is the same "see and edit what will actually run" capability applied to one
more field this spec's original field list happened to omit.

- `CollectionRequestView.testScript` — the item's "test" event script(s), concatenated in order,
  read via `postman-collection`'s `item.events.listeners("test")`. Undefined when the item carries
  no test event. Deliberately has no `resolved` counterpart the way `raw`/`resolved` request fields
  do — the script isn't textually substituted for display, it runs against the live response.
- `PUT /:id/requests/:requestId` (contracts/collection-editor-api.md) accepts an optional
  `testScript` field on the same request body as `method`/`url`/`headers`/`body`: omitted leaves
  the request's existing test event(s) untouched (mirrors `body`'s own omission rule); an
  empty/whitespace-only string removes every test event from the request; otherwise it replaces
  them with one new event carrying the given script.

## New: `VariableBinding` (part of `CollectionView`, not independently stored)

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | |
| `value` | `string?` | Absent when unresolved. |
| `source` | `"collection-default" \| "environment"` | Two persisted tiers only (research.md D8). The frontend additionally labels a value as a client-side-only "override" when it differs from the value the view loaded with (Story 3) — not a third `source` value. |
| `resolved` | `boolean` | `false` when no value is available from either tier. |
| `referenced` | `boolean` | `false` for a user-defined variable (FR-018) no request currently uses — never counted by the missing-variable check (FR-006), never blocks a run. |

## Extended: `UploadedRequestResult`

One additive optional field (research.md D6), mirroring how `ExecutionRun.cancelReason` was
added additively in specs/025:

| Field | Type | Notes |
|---|---|---|
| `wasEdited` | `boolean?` | `true` only when the executed item carried `_apipilotEdited`. Absent (not `false`) when the item was never edited — keeps existing runs' serialized shape unchanged. |

## Repository additions

`backend/src/persistence/uploadedCollectionRepository.ts` (specs/026) gains two methods,
each mirroring `EnvironmentRepository.update`'s existing shape (partial replace, same
session-scoping, same encrypted-at-rest handling for `variableValues`):

```ts
interface UploadedCollectionRepository {
  // ...existing methods unchanged...
  updateVariableValues(
    sessionId: string,
    id: string,
    variableValues: Record<string, string>,
  ): UploadedCollectionSet;

  updateCollectionBody(
    sessionId: string,
    id: string,
    collection: string, // full re-serialized JSON, item edited + `_apipilotEdited` set (D4)
  ): UploadedCollectionSet;
}
```

Both throw the existing `UploadedCollectionNotFoundError` (specs/026) when `id` doesn't resolve
within the session — no new error type.

## New pure functions (`backend/src/externalCollections/`)

**Signatures below are corrected to match the actual implementation** — the original design
(inline in this section before implementation) shaped every mutator as `Collection -> Collection`;
`postman-collection`'s own mutation methods (`Request.update()`, `PropertyList.add()`/`.remove()`)
mutate the parsed `Collection` in place instead of returning a new one, so every function here
returns void (or a small result payload) and the caller re-serializes the *same* mutated instance
via `.toJSON()` to get the string to persist.

```ts
// collectionView.ts
function buildCollectionView(
  uploadedCollectionSetId: string,
  collection: Collection,           // parsed postman-collection instance
  rawCollectionJson: string,        // the exact JSON string `collection` was parsed from — recovers
                                     // the `_apipilotEdited` marker the SDK itself strips (D6/D9's editedItems.ts)
  variableValues: Record<string, string>,
): CollectionView

// requestOverride.ts
function applyRequestOverride(
  collection: Collection,
  requestId: string,
  edit: {
    method: string; url: string; headers: Array<{key:string;value:string}>; body?: string;
    testScript?: string; // post-implementation addendum — see the CollectionRequestView note above
  },
): string                           // final JSON string ready to persist; throws RequestNotFoundError if requestId doesn't resolve (FR-012)

// itemIdentity.ts
function ensureStableIds(collection: Collection): string // research.md D2/D9 — re-serializes the already-parsed collection to make the SDK's own auto-generated ids durable; run once at upload time

// collectionStructure.ts (research.md D10)
function addRequest(
  collection: Collection,
  parentFolderId: string | null,     // null = collection root
  input: { name: string; method: string; url: string; headers: Array<{key:string;value:string}>; body?: string },
): { newItemId: string }             // mutates `collection` in place; caller re-serializes it

function deleteItem(collection: Collection, id: string): void
  // removes a request OR folder (and everything nested) by id; throws ItemNotFoundError

function renameItem(collection: Collection, id: string, name: string): void

function reorderContainer(
  collection: Collection,
  containerId: string,                // literal "root" for the collection root, otherwise a folder id
  orderedIds: string[],                // every direct child id of that container, in the new order
): void
  // throws InvalidOrderError if orderedIds doesn't exactly match the container's current child id set

// runLock.ts (research.md D11)
function assertCollectionNotRunning(uploadedCollectionSetId: string): void
  // throws CollectionLockedError if an UploadedCollectionExecutionRun for this id has status "in-progress"
```

`resolveCollectionVariables` (research.md D3) is used internally by `buildCollectionView` — not
separately exported as a route-facing function.

## Additional validation rules (FR-013–FR-018)

- **FR-013 (add request)**: `parentFolderId`, if provided, MUST resolve to an existing folder in
  the current collection (`ItemNotFoundError` / `404` otherwise); `null` targets the root.
- **FR-014 (delete)**: `id` MUST resolve to an existing request or folder (`404` otherwise, same
  `request_not_found`-style error as the existing FR-012 rule, generalized to items in general).
- **FR-015 (reorder)**: `orderedIds` MUST be exactly the current direct-child id set of the named
  container, only reordered — not a subset, superset, or including ids from a different container
  (`400 invalid_order` otherwise). This keeps reorder a pure permutation, never a disguised
  move-between-folders operation.
- **FR-016 (rename)**: `name` MUST be a non-empty string; uniqueness among siblings is NOT
  required (real Postman collections do not require sibling name uniqueness either).
- **FR-017 (locked while running)**: `assertCollectionNotRunning` runs before every mutating
  operation this feature adds (D11) — variable update, request field edit, add, delete, rename,
  reorder — and before any of them touch the stored `UploadedCollectionSet`. Violation returns
  `409 collection_locked` uniformly across all six endpoints.
- **FR-018 (unreferenced variable)**: a variable name defined with no current reference is still
  subject to the same non-empty-name validation as any `variableValues` key; it is simply never
  included in `missingUploadedVariableValues`'s evaluation set (which is built from referenced
  tokens only, unchanged from specs/026).

## Validation rules

- **FR-012 (stale override)**: `applyRequestOverride` resolves `requestId` against the *current*
  stored collection at write time — since edits mutate the record in place (research.md D4) rather
  than layering on an immutable original, a `requestId` that no longer exists (e.g., after the
  session's collection was replaced by uploading/handing off a new one with a different `id`)
  simply 404s (`request_not_found`) rather than silently applying to the wrong item. There is no
  "reapply to the closest match" behavior.
- **Request edit shape**: `method` MUST be a non-empty string; `url` MUST be a non-empty string
  (may still contain unresolved `{{variables}}` — this endpoint does not require full resolution
  to save an edit, only to start a run, consistent with FR-006 applying at run-start, not at
  edit-time).
