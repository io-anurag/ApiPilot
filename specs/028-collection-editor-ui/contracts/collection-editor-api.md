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
  "body": "{\"name\": \"{{widgetName}}\", \"category\": \"tools\"}",
  "testScript": "pm.test(\"Status code is 201\", function () {\n  pm.response.to.have.status(201);\n});"
}
```

`testScript` is optional. Omitting it leaves the request's existing "test" event script(s)
untouched, mirroring `body`'s own omission rule. Sending an empty/whitespace-only string removes
every existing "test" event from the request (a cleared Tests field means "no tests", not "leave
it alone").

`auth` is optional (FR-002c, amended 2026-09-25). Omitting it leaves the request's own auth
untouched, including a type ApiPilot cannot edit. When present it replaces the request's own auth:

```json
{ "type": "inherit" }
{ "type": "noauth" }
{ "type": "bearer", "token": { "kind": "set", "value": "{{adminToken}}" } }
{ "type": "basic", "username": "{{user}}", "password": { "kind": "keep" } }
{ "type": "apikey", "key": "X-API-Key", "value": { "kind": "set", "value": "{{apiKey}}" }, "in": "header" }
```

`inherit` removes the request's own auth, so its folder's or the collection's applies. A secret
field (`token`, `password`, API key `value`) is `{ "kind": "keep" }` to keep the value stored in
the request's own auth of the same type (a hidden literal the browser never received), or
`{ "kind": "set", "value": "..." }` to replace it.

**200 OK** — `{ "collectionView": { "...": "..." } }` (full recomputed view; the edited item's
`wasEdited` is now `true`).

**400 `invalid_request`** — missing/empty `method` or `url`.

**400 `invalid_auth_edit`** — `auth` is malformed or names an unsupported type, or asks to keep
a secret the request's own stored auth of that type does not have.

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

## `POST /api/external-collections/:id/items/:itemId/move`

Moves a request or folder into a different container — another folder or the collection root
(FR-015a, FR-015b, amended 2026-09-25). The item is placed last among its own kind (requests or
folders) in the target container, keeping its id, fields and scripts. It keeps the auth and
scripts it had: inherited auth that the move would change is written onto the item (`noauth` if
none applied), and the pre-request and test scripts of each folder it leaves are copied onto it,
outermost first, ahead of its own, each as a separate event whose first line is
`// Copied by ApiPilot from folder "<name>" (id: <folderId>) when this item was moved.` An item
changed this way gets the `_apipilotEdited` marker.

**Request** — `{ "targetContainerId": "folder-b" }` (`"root"` for the collection root)

**200 OK** —

```json
{
  "collectionView": { "...": "..." },
  "carried": {
    "auth": { "type": "bearer", "fromFolderName": "Orders" },
    "scriptsFromFolders": [{ "id": "folder-a", "name": "Orders", "events": ["prerequest", "test"] }]
  }
}
```

`carried.auth` is `null` when no auth was written onto the item. `fromFolderName` is `null` when
the carried auth came from the collection, and `type` is `noauth` when the item had no auth
before the move. `scriptsFromFolders` is empty when no script was copied.

**400 `invalid_move`** — the target is the item's current container, or the item is a folder and
the target is that folder or one of its own subfolders. The collection is unchanged.

**400 `invalid_request`** — `targetContainerId` missing or not a string.

**404 `uploaded_collection_not_found`** / **404 `item_not_found`** (unknown `:itemId`, or unknown
`targetContainerId` other than the literal `root`)

**409 `collection_locked`** — a run of this collection is in progress (FR-017).

## Interaction with existing endpoints

- `GET /api/external-collections/:id/execution/runs/:runId` (specs/026) now may include
  `wasEdited: true` on individual `UploadedRequestResult` entries (data-model.md) — additive,
  existing consumers of this response are unaffected by a field they don't read.
- `POST /api/external-collections/:id/execution/start` (specs/026) is unchanged — FR-006's
  missing-variable block already runs against whatever `variableValues` is currently stored,
  which now includes any edits made via `PUT .../variables` above.
