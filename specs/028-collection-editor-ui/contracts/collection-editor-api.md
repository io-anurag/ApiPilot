# API Contract: Collection & Variable Editor

Seven new endpoints, additive to the existing `/api/external-collections/*` route family
(specs/026-external-collection-execution/contracts/external-collections-api.md), same router
(`backend/src/api/externalCollections.ts`), same session scoping, same `{ error, message }`
failure-body convention.

**Every mutating endpoint below** (all except the read-only `GET .../collection`) first checks
`assertCollectionNotRunning` (research.md D11, FR-017) and returns this before any other
validation runs:

**409 `collection_locked`** — a run of this collection is currently in progress.

```json
{ "error": "collection_locked", "message": "..." }
```

## `GET /api/external-collections/:id/collection`

Returns the collection tree, per-request raw and resolved views, and the variable list (FR-001,
FR-002, FR-003) — computed on demand (data-model.md `CollectionView`), never a stored resource.

**200 OK**

```json
{
  "collectionView": {
    "id": "...",
    "tree": [
      {
        "name": "Widgets",
        "folders": [],
        "items": [
          {
            "id": "a1b2...",
            "name": "Create widget",
            "wasEdited": false,
            "raw": {
              "method": "POST",
              "url": "{{baseUrl}}/widgets",
              "headers": [{ "key": "Authorization", "value": "Bearer {{token}}" }],
              "body": "{\"name\": \"{{widgetName}}\"}"
            },
            "resolved": {
              "method": "POST",
              "url": "https://api.example.com/widgets",
              "headers": [{ "key": "Authorization", "value": "Bearer eyJhbGciOi..." }],
              "body": "{\"name\": \"sample\"}"
            },
            "unresolvedVariables": []
          }
        ]
      }
    ],
    "variables": [
      { "name": "baseUrl", "value": "https://api.example.com", "source": "environment", "resolved": true },
      { "name": "token", "value": null, "source": "collection-default", "resolved": false }
    ]
  }
}
```

**404 `uploaded_collection_not_found`**

## `PUT /api/external-collections/:id/variables`

Replaces the collection's variable values (FR-004, FR-005, FR-009) — same partial-replace
semantics as `PUT .../environments/:environmentId` (specs/018 contract).

**Request**

```json
{ "variableValues": { "baseUrl": "https://api.example.com", "token": "eyJhbGciOi..." } }
```

**200 OK** — `{ "collectionView": { "...": "..." } }` (full recomputed view, so every request
preview reflects the new values immediately without a second GET — satisfies FR-005's "live
preview" requirement in one round trip).

**404 `uploaded_collection_not_found`**

## `PUT /api/external-collections/:id/requests/:requestId`

Applies a direct edit to one request's method, URL, headers, or body (FR-007, FR-009a).

**Request**

```json
{
  "method": "POST",
  "url": "{{baseUrl}}/widgets",
  "headers": [{ "key": "Authorization", "value": "Bearer {{token}}" }],
  "body": "{\"name\": \"{{widgetName}}\", \"category\": \"tools\"}"
}
```

**200 OK** — `{ "collectionView": { "...": "..." } }` (full recomputed view; the edited item's
`wasEdited` is now `true`).

**400 `invalid_request`** — missing/empty `method` or `url`.

**404 `uploaded_collection_not_found`**

**404 `request_not_found`** — `requestId` does not resolve against the collection's current
stored items (data-model.md's FR-012 validation rule).

## `POST /api/external-collections/:id/items`

Adds a new request to a chosen folder or to the collection root (FR-013).

**Request**

```json
{
  "parentFolderId": null,
  "name": "List widgets",
  "method": "GET",
  "url": "{{baseUrl}}/widgets",
  "headers": [],
  "body": null
}
```

`parentFolderId` is `null` for the collection root, or an existing folder's `id`
(data-model.md `CollectionFolderView.id`).

**201 Created** — `{ "collectionView": { "...": "..." }, "newItemId": "..." }`

**404 `uploaded_collection_not_found`**

**404 `folder_not_found`** — `parentFolderId` does not resolve within this collection.

## `DELETE /api/external-collections/:id/items/:itemId`

Deletes an existing request or folder (FR-014). Deleting a folder deletes every request nested
within it. Past run history referencing this item is unaffected (FR-014, FR-011/FR-012's existing
snapshot rule).

**200 OK** — `{ "collectionView": { "...": "..." } }`

**404 `uploaded_collection_not_found`**

**404 `item_not_found`** — `itemId` does not resolve within this collection.

## `PUT /api/external-collections/:id/items/:itemId/rename`

Renames an existing request or folder (FR-016).

**Request** — `{ "name": "Create widget (v2)" }`

**200 OK** — `{ "collectionView": { "...": "..." } }`

**400 `invalid_request`** — empty `name`.

**404 `uploaded_collection_not_found`** / **404 `item_not_found`**

## `PUT /api/external-collections/:id/containers/:containerId/order`

Reorders the direct children of one container — a folder or the collection root (FR-015).
`:containerId` is either an existing folder's `id`, or the literal string `root`.

**Request** — `{ "orderedIds": ["item-b", "item-a", "item-c"] }` (every direct child id of this
container, in the desired new order — not a subset or superset, data-model.md's FR-015 rule)

**200 OK** — `{ "collectionView": { "...": "..." } }`

**400 `invalid_order`** — `orderedIds` does not exactly match the container's current child ids.

**404 `uploaded_collection_not_found`** / **404 `item_not_found`** (unknown `containerId`, other
than the literal `root`)

## Interaction with existing endpoints

- `GET /api/external-collections/:id/execution/runs/:runId` (specs/026) now may include
  `wasEdited: true` on individual `UploadedRequestResult` entries (data-model.md) — additive,
  existing consumers of this response are unaffected by a field they don't read.
- `POST /api/external-collections/:id/execution/start` (specs/026) is unchanged — FR-006's
  missing-variable block already runs against whatever `variableValues` is currently stored,
  which now includes any edits made via `PUT .../variables` above.
