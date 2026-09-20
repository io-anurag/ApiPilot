# Quickstart: External Postman Collection Import & Execution

Validates the feature end-to-end once implemented, per `contracts/external-collections-api.md`
and `data-model.md`. Run against a local dev backend (`npm run dev -w backend` or equivalent) —
no OpenAPI specification upload or guided workflow is needed first (FR-011).

## Prerequisites

- A small Postman Collection v2.1 JSON file with at least one request that references an
  environment variable (e.g. `{{baseUrl}}`) and defines a `pm.test(...)` script.
- A matching Postman Environment JSON file supplying that variable.
- A reachable HTTP target for the collection's request(s) — the same `TargetServer` test fixture
  pattern `backend/tests/fixtures/execution/targetServer.ts` already provides is suitable for an
  automated version of this scenario.

## Scenario 1 — Upload, confirm, and run (US1, US2)

1. `POST /api/external-collections` with `name`, `tier: "local"`, the collection file, and the
   environment file. Expect `201` and an `id` in the response, with no `variableValues` or raw
   collection body echoed back.
2. `POST /api/external-collections/:id/execution/start` with `{ "confirmed": false }`. Expect
   `409 unverified_content_confirmation_required` (FR-007) — the collection has never been
   confirmed before.
3. Repeat with `{ "confirmed": true }`. Expect `200` with a `run` whose `status` is
   `"in-progress"` and `results: []`.
4. Poll `GET /api/external-collections/:id/execution/runs/:runId` until `status` is
   `"completed"`. Expect one `UploadedRequestResult` per request in the collection, each with a
   `testOutcomes` entry matching the collection's own `pm.test(...)` name and pass/fail.

## Scenario 2 — Missing variable value (US1 Scenario 3, FR-004)

1. Upload a collection that references a variable the paired environment does not supply.
2. `POST .../execution/start` with `{ "confirmed": true }`. Expect `400 missing_variable_values`
   naming the specific variable, and that no request was dispatched (check the target server
   received zero requests).

## Scenario 3 — Malformed upload refused, not repaired (US1 Scenario 4, FR-002/FR-003)

1. `POST /api/external-collections` with a `collection` file that is not valid JSON. Expect
   `400 invalid_collection` and that no `UploadedCollectionSet` was created (a subsequent
   `GET /api/external-collections` does not list it).
2. Repeat with a malformed `environment` file. Expect `400 invalid_environment`.

## Scenario 4 — Risk-tier confirmation for a destructive request (FR-013)

1. Upload a collection containing at least one `POST`/`PUT`/`PATCH`/`DELETE` request, with
   `tier: "staging"`.
2. Run it once already-confirmed for content (Scenario 1, step 3) so only the tier gate remains.
3. `POST .../execution/start` with `{ "confirmed": false }`. Expect
   `409 confirmation_required` naming `environmentTier: "staging"` and the destructive
   request(s), derived from the collection's own methods (not from any `ApiModel`).
4. Repeat with `{ "confirmed": true }`. Expect the run to start.

## Scenario 5 — Shared execution slot (FR-015)

1. Start a run of an uploaded collection (Scenario 1).
2. While it is still `"in-progress"`, attempt to start a *second* uploaded-collection run (a
   different `UploadedCollectionSet`). Expect `409 execution_in_progress`.
3. Separately, drive an ApiPilot-generated workflow to `postmanGeneration` complete and attempt
   `POST /api/test-generation-workflow/execution/start` while the uploaded run from step 1 is
   still in progress. Expect `409 execution_in_progress` there too — the slot is shared across
   both kinds (research.md D7).

## Scenario 6 — Removal does not alter run history (FR-017)

1. Complete a run against an `UploadedCollectionSet` (Scenario 1).
2. `DELETE /api/external-collections/:id`. Expect `204`.
3. `GET /api/external-collections/:id/execution/runs/:runId` for the run from step 1 (the run
   itself is addressed by its own id, independent of the collection's lifecycle). Expect `200`
   with the same `uploadedCollectionSnapshot` it captured at start time, unaffected by the
   deletion.

## Scenario 7 — Full script fidelity (FR-008, constitution XVII exception)

1. Upload a collection whose pre-request script computes a header value the request depends on
   (e.g. a signature or timestamp), and whose test script depends on that header having been
   set.
2. Run it (Scenarios 1–3 confirmations as applicable). Expect the request actually received by
   the target server to carry the script-computed header, and the corresponding `testOutcomes`
   entry to pass — proving the script executed with real effect, not merely that the request
   file was sent as authored.
