# Quickstart: Postman-Style Collection & Variable Editor

Validates the feature end-to-end against a running local ApiPilot instance. Assumes
`npm install` has been run at the repo root and the backend/frontend dev servers are started
per the existing repository conventions (`npm run dev` or the workspace-specific equivalents).

## Prerequisites

- A collection is already loaded as an `UploadedCollectionSet` — either by uploading a Postman
  collection + environment pair directly through "Import & Run Collection" (specs/026), or by
  completing the guided workflow through Postman generation and using "Hand off to execution"
  (specs/016/018). Both land in the same place (research.md D1).
- The collection references at least one `{{variable}}` not yet supplied by the loaded
  environment, so User Story 2's missing-variable behavior is observable.

## Scenario 1 — Browse before running (User Story 1)

1. Open "Import & Run Collection" and select the loaded collection.
2. Open its collection view (new "Collection" panel, alongside the existing run panel).
3. Confirm the folder/request tree matches the collection's own structure and order.
4. Select a request that references a variable. Confirm its raw view shows the `{{variable}}`
   placeholder visibly distinct from literal text (e.g. highlighted), not silently substituted.

**Expected**: `GET /api/external-collections/:id/collection` returns a tree whose item count and
nesting match the source collection; the selected request's `raw` fields contain the literal
`{{name}}` tokens.

## Scenario 2 — Supply variable values with live preview (User Story 2)

1. In the same view, open the variable panel. Confirm every referenced variable is listed, with
   unresolved ones visibly marked missing.
2. Enter a value for a missing variable.
3. Without reloading, reselect (or observe) a request using that variable.

**Expected**: `PUT /api/external-collections/:id/variables` returns a `collectionView` whose
matching request's `resolved.url`/`resolved.headers`/`resolved.body` now show the substituted
value, and that variable no longer appears in `unresolvedVariables` for that request.

4. Leave at least one other required variable unset and attempt to start a run.

**Expected**: `POST /api/external-collections/:id/execution/start` still returns
`400 missing_variable_values` naming the specific remaining variable(s) — unchanged from
specs/026, now exercised against values partly supplied through this new view.

## Scenario 3 — Variable source labeling (User Story 3)

1. Load a collection whose own definition declares a default for a variable the environment does
   not currently supply.
2. Confirm the variable panel shows `source: "collection-default"` for it.
3. Enter a value for it via `PUT .../variables`.
4. Confirm the panel now shows `source: "environment"`, and (client-side only, per research.md
   D8) a "changed in this session" indicator.

## Scenario 4 — Edit a request directly (User Story 4)

1. Select a request and edit its URL (e.g. append a query parameter) and one header.
2. Confirm the preview updates immediately to reflect the edit.
3. Start a run and let it complete.
4. Open the run's detail (`GET .../execution/runs/:runId`).

**Expected**: the request's own `UploadedRequestResult` entry carries `wasEdited: true`, and its
reported outcome reflects the request as edited, not as originally defined. If the edited request
originated from an ApiPilot-generated collection, separately confirm (via the guided workflow's
own review screens) that the original `TestScenario` this request was generated from is
unchanged — the edit never touched it (research.md D1/D4).

## Scenario 5 — Restructure the collection (User Story 4, FR-013–FR-016)

1. Add a new request to the collection root (or an existing folder), specifying method, URL,
   headers, and body.
2. Confirm it appears in the tree immediately, and can itself be selected/edited like any other
   request.
3. Rename it, then reorder it relative to a sibling within the same container.
4. Delete a different, pre-existing request; confirm it disappears from the tree.

**Expected**: `POST .../items` returns a `collectionView` including the new item;
`PUT .../items/:itemId/rename` and `PUT .../containers/:containerId/order` each return an updated
view reflecting the change; `DELETE .../items/:itemId` returns a view with the item gone. A prior
run's history that referenced the deleted item (if any) is unaffected when re-fetched via
`GET .../execution/runs/:runId`.

## Scenario 6 — Collection is locked while a run is in progress (FR-017)

1. Start a run of the collection.
2. While it is still `"in-progress"`, attempt any mutation (variable update, request edit, add,
   delete, rename, or reorder).

**Expected**: every one of the six mutating endpoints returns `409 collection_locked` while the
run is in progress, and succeeds again once the run reaches a terminal status
(`"completed"`/`"cancelled"`).

## Scenario 7 — Define a variable ahead of use (FR-018)

1. In the variable panel, define a new variable name/value that no current request references.
2. Confirm it appears in the panel, marked as unreferenced, and does NOT block starting a run.
3. Add a new request (Scenario 5) that uses `{{thatVariableName}}` in its URL or headers.

**Expected**: after step 3, the same variable now resolves in that request's preview using the
value already defined in step 1, with no further action needed.

## Regression checks

- Existing specs/026 flows (upload, list, remove, run, cancel, run history) continue to work
  unmodified — this feature adds endpoints and optional response fields only.
- A collection with no edits and fully-supplied variables behaves identically to before this
  feature: `wasEdited` is absent from every result, and the run/variable-completeness behavior is
  unchanged.
