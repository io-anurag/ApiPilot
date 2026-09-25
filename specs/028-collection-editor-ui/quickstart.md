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

**Expected**: the Variables toggle still shows its red "unresolved" dot, but
`POST /api/external-collections/:id/execution/start` returns `200` and the run proceeds; a
request that still sends the unset variable records its own failed/errored outcome (spec.md
FR-006, superseded from the original `400 missing_variable_values` refusal).

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

## Scenario 5a — Move between folders, and set a per-run order from the run-order list (FR-015, FR-015a, FR-015b, FR-015c; amended 2026-09-25)

Use a collection with a folder that has Bearer `{{token}}` auth and a pre-request script, holding
a request set to inherit its auth.

1. Select that request and open its **Auth** tab. **Expect** "Bearer Token", "Inherited from
   folder …", and the token field shown as `{{token}}`. Open **Used variables**. **Expect**
   `token` listed as used in Auth, with Set or Missing as text.
2. From the request's actions menu, choose **Move to…**. **Expect** the root and every other folder
   listed by path, the request's current folder not offered, and a note that it keeps its
   inherited auth and scripts. Choose a folder that has its own scripts. **Expect** the dialog to
   list those scripts as also running there.
3. Move it to the collection root. **Expect** a notice naming the copied Bearer auth and
   pre-request script, the request marked Edited, and its Auth tab now saying "Set on this
   request."
4. Run the collection. **Expect** the moved request still sends the token and its pre-request
   script's effect.
5. In the run panel's run-order list, **expect** each row to show the request's folder path,
   method, name and endpoint path (for example `Orders  GET  Get order  /orders/{{id}}`), with a
   drag handle, ↑ and ↓, but no **Move to…** (FR-015c, amended 2026-09-25). Uncheck one request,
   then drag a request from one folder to between two requests of another folder, and use ↓ on
   the first row. **Expect** the list to show the new order, the tree to be unchanged, and the
   unchecked request to stay unchecked. Run the collection twice. **Expect** both runs' results in
   the list's order, with each moved request still sending its own folder's auth. Click
   **Reset**. **Expect** the collection's own order and every request selected. Reload the page.
   **Expect** the collection's own order.
5b. Open a request that inherits Bearer `{{token}}` from a folder, on its **Headers** tab.
   **Expect** a note "Auth adds: Authorization: Bearer {{token}}" with `{{token}}` highlighted and
   "Inherited from folder …". On its **Tests** tab, **expect** only the request's own test script,
   never its folder's.
6. Try to move a folder into one of its own subfolders through the API. **Expect**
   `400 invalid_move` and no change.

## Scenario 5c — Edit a request's own auth (FR-002c, 2026-09-25)

Use a request that inherits Bearer `{{token}}` from its folder, an environment with an
`adminToken` value, and a second request whose own Bearer token is a literal.

1. On the first request's **Headers** tab, click **Edit auth** in the "Auth adds" note. **Expect**
   the **Auth** tab, with **Inherit auth from parent** selected and the folder's auth shown.
2. Choose **Bearer Token**, enter `{{adminToken}}`, and click **Save**. **Expect** "Set on this
   request.", the Headers note showing `Authorization: Bearer {{adminToken}}`, and the request
   marked Edited. Run it. **Expect** the admin token sent; other requests in the folder still send
   `{{token}}`.
3. Choose **Inherit auth from parent** and save. **Expect** the folder's auth again.
4. Open the second request. **Expect** its Headers note and preview to show "hidden literal value"
   and the Auth tab's Token field to say a hidden value is stored. Change only its URL and save,
   then run it. **Expect** the stored token still sent, and never shown in the browser.
5. Through the API, send `auth: { "type": "basic", "username": "u", "password": { "kind": "keep" } }`
   for the second request. **Expect** `400 invalid_auth_edit` and no change.

## Scenario 6 — Collection is locked while a run is in progress (FR-017)

1. Start a run of the collection.
2. While it is still `"in-progress"`, attempt any mutation (variable update, request edit, add,
   delete, rename, reorder, or move).

**Expected**: every one of the seven mutating endpoints returns `409 collection_locked` while the
run is in progress, and succeeds again once the run reaches a terminal status
(`"completed"`/`"cancelled"`).

## Scenario 7 — Define a variable ahead of use (FR-018)

1. In the variable panel, define a new variable name/value that no current request references.
2. Confirm it appears in the panel, marked as unreferenced, and does NOT block starting a run.
3. Add a new request (Scenario 5) that uses `{{thatVariableName}}` in its URL or headers.

**Expected**: after step 3, the same variable now resolves in that request's preview using the
value already defined in step 1, with no further action needed.

## Scenario 8 — View and edit a request's own test script (FR-002/FR-007 addendum, 2026-09-21)

1. Select a request whose collection author gave it a `pm.test(...)` script (e.g. a collection
   imported from Postman's own export, which commonly ships with one).
2. Open the request editor's "Tests" tab.

**Expected**: the tab shows the exact script text Newman would execute for this request — the same
script a run's `UploadedTestOutcome.name` values are drawn from.

3. Edit the script (e.g. change the expected status code) and save.
4. Start a run and open its results.

**Expected**: the run's `testOutcomes` for this request reflect the edited script, not the
original, and the request is marked `wasEdited: true` (FR-011, unchanged from Scenario 4's
existing behavior for other fields).

5. Clear the Tests tab entirely (empty the textarea) and save.

**Expected**: the request runs with zero test outcomes — `testOutcomes: []` — rather than the
save being rejected or the prior script silently surviving.

## Regression checks

- Existing specs/026 flows (upload, list, remove, run, cancel, run history) continue to work
  unmodified — this feature adds endpoints and optional response fields only.
- A collection with no edits and fully-supplied variables behaves identically to before this
  feature: `wasEdited` is absent from every result, and the run/variable-completeness behavior is
  unchanged.
