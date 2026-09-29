# Quickstart: Edit a Performance Step's Request Body (AP-033)

**Feature**: [spec.md](./spec.md) | **Contracts**: [body-edits-api.md](./contracts/body-edits-api.md), [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md) | **Data model**: [data-model.md](./data-model.md)

These scenarios check the feature end to end. Scenarios 1 to 8 are manual browser walkthroughs.
Scenario 9 is the opt-in real-k6 check. `npm test` covers the same behavior with AP-029's fake
runner and the k6 sandbox, and needs no k6.

## Prerequisites

- `npm install` at the repository root, then `npm run dev`.
- **Scenario 9 only:** k6 1.0.0 or later that you installed, on `PATH` or named in
  `K6_BINARY_PATH`. ApiPilot does not install it.
- **Stub target:** `npm run perf:stub -w backend` (`http://127.0.0.1:4600`). Never point these
  scenarios at a system you are not authorized to load.
- **Specifications:**
  - `backend/tests/fixtures/openapi/body-edits.yaml`, added by this feature. It has:
    - `GET /errors/conflict`, with no body;
    - `POST /orders`, a JSON body with a required `quantity` (`minimum: 1`), a `status` enum and a
      `customerEmail` of `format: email`;
    - `POST /accounts`, a JSON body with a `pin` of `format: password`;
    - `POST /notes`, a `text/plain` body;
    - `POST /uploads`, `multipart/form-data`;
    - one operation with an optional body the positive scenario does not send.
  - `backend/tests/fixtures/openapi/performance.yaml` (AP-029), for the guided workflow journey
    with a workflow variable in a body.
  - `backend/tests/fixtures/openapi/quick-performance.yaml` (AP-032), for the run in scenario 9.

## 1. Every step shows its body or says it has none (User Story 1; FR-001, FR-002; SC-005)

1. Start a quick performance test with `body-edits.yaml`.
2. Open `GET /errors/conflict`. **Expect** "This request has no body." and no editor.
3. Open `POST /orders`. **Expect** the as-sent body, with `customerEmail` shown as unique per
   virtual user and iteration.
4. Open the operation with an optional body. **Expect** the statement that the operation accepts a
   body this step does not send, and an empty editor with "Add a body".
5. Open `POST /uploads`. **Expect** the statement that form and multipart bodies cannot be edited.

## 2. Edit, save and generate (User Story 2; FR-003, FR-004, FR-006 to FR-008, FR-015; SC-001, SC-002, SC-004)

1. Generate the script. Then, in `POST /orders`, change `quantity` to `3` and save. Time this
   from opening the step to the new script being generated. **Expect** under 1 minute (SC-001).
2. **Expect** the preview to show `"quantity": 3`, the row to carry "Body edited", the table to
   show "Body edited · 1", and the script to be marked out of date.
3. Generate again and download the script. **Expect** its `JOURNEYS` entry for the step to hold
   the same body text as the preview.
4. Generate a second time without changes. **Expect** byte-identical script and environment
   template files.
5. Type `{"quantity": }` and save. **Expect** "Not valid JSON at line 1, column 14." next to the
   editor, nothing saved, and the script state unchanged.
6. Change a value and choose Cancel. **Expect** the body unchanged.

## 3. Schema mismatch warning (User Story 2 AS4; FR-005)

1. In `POST /orders`, remove `quantity` and set `status` to `"unknown"`. Save.
2. **Expect** the edit to be saved, with two warnings: `quantity` required and missing, and
   `status` not a documented value. **Expect** script generation to stay available.
3. Set `quantity` to `"{{qty}}"`. **Expect** no warning for `quantity`, and `qty` listed as a
   value the target environment must supply.

## 4. References and secrets (User Story 3; FR-009 to FR-013; SC-003, SC-003a)

1. In `POST /orders`, add `"warehouseId": "{{warehouseId}}"` and save. **Expect** `warehouseId` in
   the values checklist (present or missing for the chosen environment) and in the environment
   template.
2. Remove `customerEmail` and save. **Expect** the notice that the step no longer sends a unique
   value for `customerEmail`.
3. In `POST /accounts`, change only `name` and save. **Expect** a refusal naming `pin`, because
   the generated value is still a literal (FR-012a). Set `pin` to `"1234"` and save. **Expect**
   the same refusal. Set it to `"{{accountPin}}"`. **Expect** it to save, with `accountPin`
   marked secret wherever it is listed.
4. Write `"{{apipilot_unique_0}}"` in any field and save. **Expect** a refusal: the name is
   reserved.
5. Guided path: complete a guided workflow on `performance.yaml` up to the Performance Testing
   stage. Edit the consuming step of a workflow journey, keep the consumer field and change
   another value. **Expect** the variable still to come from the producing step. Remove the
   consumer field. **Expect** the notice naming the variable.
6. Download the script and the template. Search them for `1234`. **Expect** no match.

## 5. Text bodies (Edge cases; FR-004)

1. In `POST /notes`, replace the text with `Load note {{noteTag}}` and save. **Expect** no JSON
   check, `noteTag` listed as a needed value, and the preview to show the text as sent.

## 6. Reset (User Story 4; FR-017; SC-006)

1. With edits on three steps, choose "Reset to generated body" on one and confirm. **Expect** its
   marker to go and the count to read 2.
2. Choose "Reset all edited bodies". **Expect** the confirmation to say 2 steps will change. Confirm.
   **Expect** no marker, and every preview back to the generated body.

## 7. Removal, restore and rebuild (Edge cases; FR-018)

1. Edit `POST /orders`, then remove it from the plan. In the Removed view, open it. **Expect** the
   edited body, read-only, marked "Body edited".
2. Restore it. **Expect** the edit back, with the marker.
3. Guided path: edit a step, then go back to scenario review, change that operation's approved
   scenario, and return. **Expect** the edit discarded and a note naming the operation.
4. Quick path: start a new quick test with a new file. **Expect** the confirmation to say the
   current plan and its body edits will be replaced.

## 8. Runs and reports keep no body (FR-014; SC-003)

1. With `POST /orders` edited and the script generated, start a run against the stub target (k6
   installed) or use the automated test for this scenario.
2. Open the report. **Expect** `POST /orders` marked "Body edited by you", and the provenance
   section to state that one step sent a body written by the engineer.
3. **Expect** the report, `GET /runs/:runId` and the stored `plan_snapshot` row to contain none of
   the edited body text (covered by an automated scan).

## 9. Real k6 (opt-in; FR-006)

1. `npm run test:k6-real -w backend`. **Expect** the added case to pass: a quick plan on
   `quick-performance.yaml` with an edited `POST /orders` body completes a run against the test
   target, and the target observes the edited body. The test target in
   `performance.k6.real.test.ts` gains request recording if it has none. `npm test` asserts the
   same body through the k6 sandbox (`tests/fixtures/performance/k6Sandbox.ts`), which records
   every request.

## Automated checks

```bash
npm test
npm run lint
npm run build
```

`renderScript.test.ts`'s golden files must stay byte-identical. The plan they render has no body
edits (research R10).
