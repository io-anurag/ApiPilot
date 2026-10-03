# Quickstart: Validating Request-Chain Performance Plans (AP-037)

These scenarios show the feature working end to end. The API shapes are in
[contracts/chain-plan-api.md](./contracts/chain-plan-api.md), and the script and metrics are in
[contracts/chain-script.md](./contracts/chain-script.md).

## Prerequisites

- Node.js 24 LTS. Install with `npm install` at the repository root.
- k6 1.0.0 or later on `PATH`, only for scenarios marked **real k6**.
- The stub target, in its existing AP-036 mode:
  `PERF_STUB_MODE=customers-auth npm run perf:stub -w backend`. It listens on
  `http://127.0.0.1:4600` and serves:
  - `POST /auth/token`;
  - `/api/v1/customers[/{id}]` (401 without the token, 404 for an unknown id).

  It prints request counts by route, never ids or tokens. This feature adds
  `PERF_STUB_WRONG_ID_EVERY=<n>` and `PERF_STUB_SLOW_EVERY=<n>` (with `PERF_STUB_SLOW_MS`) for
  scenario 4.
- The app: `npm run dev`. Open the frontend, then the **Performance plans** tab.
- An environment "Local stub" (tier `local`, base URL `http://127.0.0.1:4600`) with `client_id` and
  `client_secret` set.

## Automated checks

```bash
npm test                                   # unit + integration, mock AI, fake k6 runner
npm run lint
npm run build
npm run test:k6-real -w backend            # opt-in: scenarios 1, 5 and 7 against real k6
```

**Expected result:** all pass. The chain golden script is unchanged. The legacy goldens
(`script.js`, `user-journeys-script.js`, `collection-script.js`) are **unchanged** in phase one
(research R10).

## Scenario 1: build the US1 chain by hand (P1, SC-001, SC-003, SC-004) **real k6**

1. **New plan** → "Customer lifecycle". Set the target environment to Local stub.
2. Add the seven steps of US1 with **Add step**. Type `{{` in the Authorization header of step 2.
   **Expected:** the suggestions list `token` (extracted by step 1), the environment's names and the
   dynamic variables, and can be used with the keyboard alone.
3. Set step 1 to **Once before load**, with extractor `token` ← body `access_token` and expected
   `200`.
4. **Expected:** the issues panel is empty. Required values list `client_id` and `client_secret`
   (mark the latter secret), both provided. Hosts list `{{baseUrl}}` only. The write summary lists
   5 write steps.
5. **Generate script** twice. **Expected:** the same `scriptSha256` both times.
6. Run Smoke with 2 virtual users × 3 iterations. **Expected:** the stub's counts show one token call.
   Every customer request carried the token. Each PUT, GET, PATCH and DELETE used its own virtual
   user's id. No 404 was returned. The report shows the setup step's outcome and latency, outside
   the load figures.

## Scenario 2: fix a weak specification (P1, US2, SC-002)

1. Upload `backend/tests/fixtures/chain/weak-spec.yaml` in Quick test. It has placeholder examples,
   `POST /customers` documented `200`, and the wrong path `/customer/{customerId}`. Choose
   **Create request-chain plan**.
2. **Expected:** one single-step chain per operation, each named after its operation. The seeding
   report lists nothing blocking.
3. Make the edits:
   - replace the POST body;
   - set expected `201`;
   - add the token step at the top;
   - correct the PUT path and add `X-Tenant-Id: {{tenant_id}}`;
   - move the steps into one chain and delete the rest.
4. **Expected:**
   - no warning about the specification;
   - edited steps show their operation and **Changed**;
   - the added step shows **Added by you**;
   - `tenant_id` appears under required values.
5. Reload the page, and seed a second plan from the same specification. **Expected:** the first
   plan is unchanged.

## Scenario 3: literal credentials (FR-027, SC-005)

1. In a plan with no target environment, type `Authorization: Bearer abc123` and save.
   **Expected:** `422 credential_needs_environment`, and the editor asks for an environment.
2. Choose Local stub and save again. **Expected:** the step shows `Bearer {{authorization_s2}}`, a
   notice names the value and the environment, and the value is listed as secret.
3. **Expected:** `abc123` is absent from `GET /api/chain-plans/:id`, from the downloaded script and
   template, and from the backend log.

## Scenario 4: checks (P2, US3)

**Steps:** on the GET-one step, add three checks:
- `id` equals `{{customer_id}}`;
- body contains `"status":"ACTIVE"`;
- time at most 500 ms.

Run Load with `PERF_STUB_WRONG_ID_EVERY=10` and `PERF_STUB_SLOW_EVERY=5`.

**Expected:** the report gives each check's pass and fail counts. Failed checks are reported
separately from unexpected statuses. Chains were not cut short by a failed check.

## Scenario 5: setup failure stops the run (FR-018) **real k6**

**Steps:** restart the stub with `PERF_STUB_TOKEN_STATUS=401` and start a run.

**Expected:**
- the run ends **Failed: setup step failed**, naming step 1 and "unexpected status";
- the stub's counts show no customer request;
- no retry was made.

## Scenario 6: seed from a collection and from the guided workflow (P2, US4)

1. In Import & Run Collection, upload
   `backend/tests/fixtures/collections/apifoundry.postman_collection.json`. Select every request and
   choose **Create request-chain plan**.
2. **Expected:**
   - one chain per top-level folder, in run order;
   - setters become extractors and status assertions become expected statuses;
   - folder bearer auth becomes an `Authorization` header;
   - pre-request scripts are listed in the seeding report with their requests.
3. Edit the collection in Import & Run Collection. **Expected:** the plan is unchanged.
4. Finish the guided workflow to Postman generation with one approved workflow, and seed from the
   Performance Testing stage. **Expected:** one chain for the workflow, with its variables as
   extractors and `{{name}}` references, and one single-step chain for each other operation.

## Scenario 7: CSV data sets (P2, US6, SC-009) **real k6**

1. Upload `customers.csv`: 50 rows, columns `tenant_id,first_name,last_name,email,username,password`.
   Mark `password` secret and choose **Next row per iteration**.
   **Expected:** 50 rows and 6 columns are shown. The preview hides `password`.
2. Upload a file with a short row on line 7. **Expected:** it is refused with "line 7: expected 6
   fields, found 5", and the data set list is unchanged.
3. Use `{{first_name}}`, `{{email}}` and `X-Tenant-Id: {{tenant_id}}`. Run 5 virtual users × 20
   iterations.
4. **Expected:**
   - the stub received rows in order, and wrapped after row 50;
   - the report shows 100 takes, 50 rows used, and wrapped;
   - no password value is in the plan row, the script, the template, the snapshot, the report or
     the log;
   - replacing the file with different content leaves the script's SHA-256 unchanged.

## Scenario 8: saved plans survive a restart (FR-039, SC-008)

**Steps:** with scenario 7's plan saved, stop and restart the backend. Reopen it in the same
browser session.

**Expected:**
- chains, steps, data sets and the seeding report are as saved;
- the script shows **Not generated**;
- generating it again gives the same SHA-256 as before.

## Scenario 9: Run again and restore (FR-035)

**Steps:** after scenario 1's run, choose **Run again**. **Expected:** it is offered with the
environment as it is now and the write list.

**Then:** change a step's body. **Expected:** **Run again** is unavailable, with "The script
changed since this run". Restore into the plan. **Expected:** the steps return, the script is
regenerated, and no run starts.

## Scenario 10: phase two (P3, US5, SC-006, SC-007)

1. Before phase two, record one run from each legacy source (guided, quick and collection), and
   save each report's HTML.
2. After phase two:
   - each legacy report renders byte-identical to the saved HTML;
   - legacy runs offer neither **Run again** nor restore, and say why;
   - the guided, quick and collection entry points open request-chain plans.
3. Run `node scripts/count-performance-lines.mjs` over the measured set in plan.md. **Expected:**
   at most 13,000 lines (the target agreed on 2026-10-03), against the baseline of 16,110 and the
   phase-one count of 22,357.
