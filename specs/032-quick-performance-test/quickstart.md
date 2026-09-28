# Quickstart: Quick Performance Test from a Specification (AP-032)

**Feature**: [spec.md](./spec.md) | **Contracts**: [quick-performance-api.md](./contracts/quick-performance-api.md), [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md) | **Data model**: [data-model.md](./data-model.md)

These scenarios check the feature end to end. Scenarios 1 to 8 are manual browser walkthroughs.
Scenario 9 is the opt-in real-k6 check. `npm test` covers the same behaviour with AP-029's fake
runner and needs no k6.

## Prerequisites

- `npm install` at the repository root, then `npm run dev`.
- **Scenarios 5, 6 and 9 only:** k6 1.0.0 or later that you installed, on `PATH` or named in
  `K6_BINARY_PATH`. ApiPilot does not install it.
- **Stub target:** `npm run perf:stub -w backend` (`http://127.0.0.1:4600`). Never point these
  scenarios at a system you are not authorized to load.
- **Specifications:**
  - `backend/tests/fixtures/openapi/quick-performance.yaml`, added by this feature. It has at
    least twelve operations using GET, POST, PUT, PATCH and DELETE, bearer security whose token
    comes from `POST /auth/login`, and a path parameter no operation produces. The stub target
    serves its paths.
  - `backend/tests/fixtures/openapi/performance.yaml` (AP-029), for the guided scenario.
  - `backend/tests/fixtures/openapi/paypal-invoicing-v2.yaml`, for scale.
  - `backend/tests/fixtures/openapi/invalid-yaml.txt` and `unsupported-version.yaml`, for errors.

## 1. From the start screen to a plan (User Story 1; FR-001 to FR-007; SC-001)

1. Open the app. **Expect** three entries, with "Quick performance test" next to "Import & Run
   Collection" and the sentence from FR-001.
2. Choose it and upload `quick-performance.yaml`. **Expect** the performance plan to open directly,
   with no API review, scenario review, AI enhancement, workflow review or Postman generation stage.
3. **Expect** one single-step journey per operation except `POST /auth/login`, and no chaining.
4. **Expect** `POST /auth/login` in the removed list with "used to acquire the run's credentials",
   and the secured steps to show "Token from a login request" (US1 AS6). Restore it and **expect**
   it to become a journey; remove it again.
5. Open a step's request. **Expect** the method, path template, each parameter with its generated
   value or the environment value it needs, and the body. **Expect** the credential to appear only
   by name (US1 AS7).
6. Generate the script, then download the script and environment template.

## 2. Byte-identical output across uploads (FR-007; US1 AS4; SC-004)

1. Choose **Back to start**, **Quick performance test** again, and upload the same file.
   **Expect** a confirmation that the current quick test will be replaced, and confirm.
2. Make the same edits as in scenario 1 (if any), generate, and download both files again.
3. **Expect** both files to be byte-identical to those from scenario 1 (for example, compare them
   with `certutil -hashfile <file> SHA256` or `sha256sum`), and neither to contain a value you
   later enter in an environment.

## 3. Write operations are visible (User Story 2; FR-009 to FR-012a, FR-014; SC-002, SC-003)

1. **Expect** a summary above the journeys: "<n> write operations will be sent", counts per method,
   each write operation by method and path, and the sentence about every virtual user, every
   iteration and no clean-up.
2. **Expect** each write step to carry a text marker ("Creates", "Replaces", "Updates", "Deletes")
   beside its method badge.
3. Choose **Remove all DELETE operations**. **Expect** them in the removed list, the summary updated,
   and an announcement. Remove every operation one method at a time, including GET, and **expect**
   "The plan has no operations" with Generate disabled for that reason; restore one and **expect**
   Generate to be available again. Choose **Remove all write operations**, and **expect** the summary to say the
   plan sends only read requests. Restore all.
4. **Expect** the same summary beside the run trigger, listing every write operation by method and
   path with nothing to expand (checked in scenario 5).

## 4. Environments without a guided workflow (User Story 3; FR-016 to FR-019; SC-006)

1. In a fresh private browser window (a new session), start a quick test from
   `quick-performance.yaml`, open **Target environment and values**, and create `quick-local`, tier
   `local`, base URL `http://127.0.0.1:4600`.
2. **Expect** the values checklist to list the base URL, the login credentials and the unproduced
   path parameter, each present or missing for `quick-local`. Enter them and **expect** every entry
   to show present.
3. Choose **Back to start**, start the guided workflow with `performance.yaml`, and take it through
   **Postman Generation**. **Expect** `quick-local` in its environments (US3 AS2). Create another
   environment there and **expect** it in the quick plan's picker.
4. In another fresh window, with no quick test and no guided workflow, open
   `/api/test-generation-workflow/environments`. **Expect** `409 stage_not_active`.

## 5. Run from the quick path (User Story 3; FR-013, FR-020; US3 AS3)

1. With k6 ready, choose `quick-local` and the **smoke** profile. **Expect** the trigger to name
   `quick-local`, its tier and base URL, the load-origin statement, and the write summary with every
   write operation's method and path.
2. Trigger the run. **Expect** progress and the report as in AP-029's quickstart scenario 3.
3. **Expect** the report's provenance to state that the plan came from the quick performance test
   with generated, unreviewed scenarios.

## 6. One execution at a time (US3 AS4; FR-020)

While the quick run from scenario 5 is in progress, start the guided workflow's performance run or
a functional run. **Expect** `execution_in_progress`, with the same reason AP-029 gives. Do the
reverse and **expect** the quick run to be refused the same way.

## 7. The guided stage without the scope choice (User Story 4; FR-022, FR-023; SC-005)

1. Upload `performance.yaml` to the guided workflow and select a subset of its operations in API
   review. Continue through **Postman Generation** and open **Performance Testing**.
2. **Expect** no "API review selection" or "All analyzed operations" choice, only the selected
   operations in the plan, none of the others in the left-out list, and the note on how to include
   other operations.
3. **Expect** the same write summary, markers and request preview as in scenarios 1 and 3.

## 8. Lists at scale and error handling (User Story 5; FR-002, FR-024; US1 AS5)

1. Start a quick test from `paypal-invoicing-v2.yaml`. **Expect** counted lists, one operation per
   line with its method badge, collapsed when longer than ten entries.
2. Upload `invalid-yaml.txt`, then `unsupported-version.yaml`. **Expect** the same error messages
   the guided upload shows, and no plan.

## 9. Real k6 (opt-in; FR-020)

`npm run test:k6-real -w backend` (`K6_TEST_REAL=1`). It runs AP-029's real-binary checks and one
quick-path run against the stub target. **Expect** it to pass. It is never part of `npm test`.

## Automated validation

```bash
npm test
npm run lint
npm run build
```
