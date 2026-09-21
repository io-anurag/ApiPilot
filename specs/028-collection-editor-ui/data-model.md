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

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | The `UploadedCollectionSet.id` this view was computed from. |
| `tree` | `CollectionFolderView[]` | The collection's own folder/item structure, in source order (FR-001). |
| `variables` | `VariableBinding[]` | Every variable referenced anywhere in the collection (FR-003). |

```ts
interface CollectionFolderView {
  id: string;                  // stable folder id (research.md D9); "root" itself has no id —
                                // the top-level `CollectionView.tree` array IS the root container
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
}
```

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

```ts
// collectionView.ts
function buildCollectionView(
  collection: Collection,          // parsed postman-collection instance
  variableValues: Record<string, string>,
): CollectionView

// requestOverride.ts
function applyRequestOverride(
  collection: Collection,
  requestId: string,
  edit: { method: string; url: string; headers: Array<{key:string;value:string}>; body?: string },
): Collection                       // throws RequestNotFoundError if requestId doesn't resolve (FR-012)

// itemIdentity.ts
function ensureStableIds(collection: Collection): Collection // research.md D2/D9, run once at upload/handoff time; covers both requests and folders

// collectionStructure.ts (research.md D10)
function addRequest(
  collection: Collection,
  parentFolderId: string | null,     // null = collection root
  request: { name: string; method: string; url: string; headers: Array<{key:string;value:string}>; body?: string },
): { collection: Collection; newItemId: string }

function deleteItem(collection: Collection, id: string): Collection
  // removes a request OR folder (and everything nested) by id; throws ItemNotFoundError

function renameItem(collection: Collection, id: string, name: string): Collection

function reorderContainer(
  collection: Collection,
  containerId: string | null,        // null = collection root
  orderedIds: string[],              // every direct child id of that container, in the new order
): Collection
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
