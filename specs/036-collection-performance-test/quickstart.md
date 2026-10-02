# Quickstart: Performance Test from a Postman Collection (AP-036)

These scenarios validate the feature end to end. Each names the spec items it proves. Exact shapes are
in [contracts/](./contracts/) and [data-model.md](./data-model.md). The design reasons are in
[research.md](./research.md).

## Prerequisites

- **Workspace:** Node.js 24 LTS. Install with `npm install` at the repository root.
- **k6:** k6 1.0.0 or later on `PATH`, or named in `K6_BINARY_PATH`, for scenarios 3, 4 and 8.
- **Target:** the stateful stub `backend/scripts/perfStubTarget.ts` in its customers mode, extended
  by this feature. It must:
  - issue a bearer token on `POST /auth/token`, with an optional `expires_in`;
  - answer 401 without a valid token;
  - create customers with new ids, and answer 404 for an unknown id;
  - refuse a repeated email with 409.
- **Fixture:** `backend/tests/fixtures/collections/apifoundry.postman_collection.json` and its
  environment, which mirror the eight requests of User Story 1:
  - collection-level bearer auth `{{access_token}}`;
  - the token test `pm.environment.set("access_token", pm.response.json().access_token)`;
  - the customer `POST` test `const body = pm.response.json(); pm.collectionVariables.set("customer_id", body.id);`;
  - `pm.test` status assertions on every request;
  - a `POST` body with `{{$randomFullName}}` and `{{$randomEmail}}`.
- **Run:** start the app with `npm run dev`.

## 1. Build a plan from a collection (User Story 1 AS1 to AS6; FR-001 to FR-008, FR-011, FR-018, FR-027)

1. In **Import & Run Collection**, upload the fixture collection and environment. Run it once and
   check that all eight requests pass (AP-026).
2. In the run panel, choose **Set up a performance test**. The **Collection Performance Test** tab
   opens.
3. Check the plan:
   - `POST /auth/token` is under **Run once before the load**. It provides `access_token`, used by
     steps 1 to 7.
   - The journey has seven steps, in the run panel's order, each labelled with its folder and
     request name.
   - `POST /api/v1/customers` captures `customer_id` from `id`, with origin "test script, line 1".
     The GET, PATCH and DELETE that follow show their path reference bound to it.
   - Neither `access_token` nor `customer_id` appears under the environment values.
   - Every expected status reads "from the collection's test".
4. Choose **Generate script**. It is refused, and the pending bar shows **Review the conversion**.
5. Open the review. Check that it states the requests and scripts were not generated or verified by
   ApiPilot. Choose **Mark as reviewed**. The script now generates.

## 2. Determinism and secrets (FR-015, FR-023; SC-004)

1. Generate the script twice. The SHA-256 is the same both times.
2. Download the script and the environment template. Check that neither contains any environment
   value or any literal from an auth field.
3. Upload the downloaded script to **Run k6 Script**. Check that AP-034's check accepts it.
4. Automated: `npm test -w backend -- collectionPerformance`. This runs the seeded-literal scan and
   the ten-times byte-identity test.

## 3. Run the flow (User Story 1 AS7; FR-027, FR-029; SC-001, SC-002)

1. Choose **New environment from this collection**, and name it `perf-from-collection`. The values
   checklist shows `baseUrl`, `client_id` and `client_secret` as **Present**.
2. Run a smoke profile with 2 virtual users for 30 seconds.
3. In the report, check that:
   - the token request was sent once before the load;
   - no step received 401 or 404;
   - each capture shows only successes;
   - the credential-request section shows the setup and no refreshes.

## 4. Token refresh (User Story 1 AS8; FR-028)

1. Set the stub's `expires_in` to 10 seconds, and run a 40-second profile with 2 virtual users.
2. The report shows refreshes from each virtual user before expiry, and no authentication failures.
3. Make the stub's token endpoint return 500, and run again. The report shows a setup failure that
   names the request and `access_token`, and the steps fail as authentication errors.

## 5. Dynamic variables (User Story 2; FR-013; SC-006)

1. The `POST /api/v1/customers` request preview shows `name` and `email` as "generated at run time".
2. Run 10 virtual users for 10 iterations against the stub, which refuses repeated emails. Check that
   no 409 was received.
3. Add `{{$randomColor}}` to a request in the collection editor, and rebuild. The request is under
   **Left out** with "uses {{$randomColor}}, which ApiPilot cannot generate".

## 6. What was not converted (User Story 3; FR-004, FR-007, FR-009, FR-010, FR-019)

1. In the collection editor, add:
   - a collection pre-request script that calls `pm.sendRequest`;
   - an `if (pm.response.code === 200) { pm.environment.set("etag", pm.response.headers.get("ETag")); }`;
   - a body assertion;
   - Digest auth on `/version`.
2. Rebuild. Check that:
   - the review lists each one with its owner, line and reason;
   - `/version` is under **Left out** as "unsupported-auth: digest";
   - `etag`, where a later request uses it, is an environment value.
3. On that step, add a capture `etag` from the header `ETag`. The later reference is now bound, and
   the environment value disappears.

## 7. The collection changes (FR-022; Edge Cases)

1. Rename a request in the collection editor. The plan shows **The collection changed since this
   plan was built** with **Rebuild**. **Generate script** and the run trigger are unavailable.
2. Run the collection functionally. Its saved values do not mark the plan out of date (R13).
3. Choose **Rebuild**. The plan keeps the load profile and the expected statuses you set, names the
   steps it could not keep them for, and asks for a new review.
4. Delete the collection. The plan shows that it cannot be rebuilt. Past runs and reports still open.

## 8. Opt-in real-k6 check

`npm run test:k6-real -w backend` adds two cases:
- the User Story 1 collection against the stub (SC-001, SC-002);
- the 10-second `expires_in` refresh (FR-028).

## Validation commands

```bash
npm test
npm run lint
npm run build
npm run test:k6-real -w backend   # opt-in, needs k6
```
