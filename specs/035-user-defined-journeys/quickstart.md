# Quickstart: User-Defined Journeys and Captured Values (AP-035)

**Feature**: [spec.md](./spec.md) | **Contracts**: [plan-journeys-api.md](./contracts/plan-journeys-api.md), [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md) | **Data model**: [data-model.md](./data-model.md) | **Research**: [research.md](./research.md)

These scenarios check the feature end to end:
- Scenarios 1 to 7 are manual browser walkthroughs.
- Scenario 8 is the opt-in real-k6 check.

`npm test` covers the same behaviour without k6, using the script sandbox
(`backend/tests/fixtures/performance/k6Sandbox.ts`) and the fake runner (research R19).

## Prerequisites

- `npm install` at the repository root, then `npm run dev`.
- **Scenarios 3, 4, 6 and 8 only:** k6 1.0.0 or later, installed by you, on `PATH` or named in
  `K6_BINARY_PATH`. ApiPilot does not install it.
- **Added by this feature:**
  - `backend/tests/fixtures/openapi/user-journeys.yaml`, which documents these operations:
    - `POST /api/v1/customers`: 201 with body `{id, name}`, and a `Location` header.
    - `GET`, `PUT` and `DELETE /api/v1/customers/{id}`.
    - `POST /api/v1/orders`: body `customerId`.
    - `GET /api/v1/orders/{id}?customer=`.
  - A stateful customers mode in `npm run perf:stub -w backend` (`http://127.0.0.1:4600`):
    - each POST returns a new id and a `Location` header;
    - PUT, GET and DELETE answer 404 for an id it did not issue or already deleted;
    - it prints counts of 404s and of requests per route, never ids.
  - Setting `PERF_STUB_DROP_ID_EVERY=<n>` omits `id` from every n-th POST response.
- **An environment** `Local stub`: Local tier, base URL `http://127.0.0.1:4600`.

Never point these scenarios at a system you are not authorized to load.

## 1. Compose a journey on the quick path (User Story 1 AS1 to AS5; FR-001 to FR-004, FR-007, FR-009, FR-011, FR-012, FR-015, FR-031)

1. Start a quick performance test with `user-journeys.yaml`. **Expect**:
   - every operation is a single-step journey;
   - the scope note says requests are not chained unless you build a journey, and points to **New
     journey** (FR-031);
   - the values checklist lists `customer_id` (the path parameter `{id}`). It has the same name as
     the capture you will add in step 3, which is allowed (spec Edge Cases, "Names").
2. Choose **New journey** and name it "Customer lifecycle". Add `POST /api/v1/customers`, then
   `PUT …/{id}`, then `DELETE …/{id}`. **Expect**:
   - the journey is marked "Defined by you";
   - the plan states that the three operations no longer run on their own (FR-003).
3. On the POST step, open **Captures** and add `customer_id`. **Expect**:
   - the field list shows `id` and `name`, sorted;
   - `id` is marked as matching a later step's parameter (FR-009).
   Pick `id`.
4. On the PUT step's parameters, set `{id}` to "Value captured by an earlier step" and pick
   `customer_id` from step 1. Do the same on the DELETE. **Expect**:
   - both steps show "Uses captured value";
   - the request preview shows `customer_id` from step 1, and no value (FR-012);
   - `customer_id` is no longer listed for those steps in the values checklist.
5. Try to move the PUT above the POST. **Expect** a refusal naming `customer_id`, and an unchanged
   order (FR-015).
6. Try to remove the POST step, then to remove its capture. **Expect** each to be refused, naming
   `customer_id` and the PUT and DELETE steps.
7. Add a capture named `1st` and one with path `items[*].id`. **Expect** each to be refused with
   its reason (FR-026, FR-008).
8. Choose **Also run on its own** for `GET …/{id}`. **Expect** it to stay as a single-step journey
   (FR-003).

## 2. Determinism and out of date (FR-018, FR-021; SC-004)

1. Generate the script and download it twice. **Expect** byte-identical files, and no captured or
   environment value in either.
2. Rename the journey. **Expect** the script to be marked out of date. Regenerate it.
3. Compare the script's runtime section with a script from a plan without journeys. **Expect** it
   to be identical. Only the data constants differ.

## 3. Run the chain (User Story 1 AS6, AS8; FR-017, FR-029; SC-002)

1. Start the stub in customers mode. Run a smoke load with 2 virtual users for 30 seconds on
   `Local stub`. **Expect**:
   - the stub reports 0 responses of 404;
   - every PUT and DELETE counted.
2. Open the report. **Expect**:
   - the PUT and DELETE steps show `{id}` from `customer_id`, step 1, response field `id`;
   - the POST step shows `customer_id` with its success count and 0 failures;
   - the provenance says "In a journey defined by you".

## 4. A failed capture cuts the journey short (User Story 1 AS7; FR-010, FR-019; SC-003)

1. Restart the stub with `PERF_STUB_DROP_ID_EVERY=5`, then run the same load. **Expect**:
   - the stub's PUT and DELETE counts are each 1/5 lower than the POST count;
   - there are still 0 responses of 404;
   - the report shows `customer_id` failures matching the dropped responses;
   - the journey is cut short the same number of times, at the POST step;
   - the findings name `customer_id` as the capture that cut the most journeys short.
2. Configure the stub's POST to answer 500 for one run. **Expect**:
   - its captures are counted as failed;
   - no PUT or DELETE is sent;
   - the POST is counted as failed (FR-010).

## 5. Other sources and targets, and repeated operations (User Story 2; FR-002, FR-011, FR-013, FR-023)

1. Build a journey with these steps:
   - `POST /customers`, capturing `customer_id` from `id` and `customer_url` from the `Location`
     header;
   - `POST /orders`, binding body field `customerId` to `customer_id`;
   - `GET /orders/{id}?customer=`, binding query `customer` to `customer_id`;
   - `GET /customers/{id}` twice.
2. Open the order step's body editor. **Expect** `customerId` under "Replaced at run time", with
   `customer_id` as its source (FR-013).
3. Remove `customerId` from the edited body and save. **Expect** the binding to be gone, and the
   step's details to say so.
4. Bind a path parameter that has an edited value. **Expect** a confirmation first. Confirming
   drops the edited value (FR-014).
5. **Expect** each GET occurrence to have its own expected status. **Expect** the write summary to
   count each POST step and name its journey (FR-023).
6. Add a capture with path `meta.trace` (not documented). **Expect** "Not documented in the
   specification", and generation still allowed (FR-009).

## 6. Edit and revert a proposed workflow journey (User Story 3 AS1, AS2; FR-024)

1. On the guided path with `performance.yaml`, reach the Performance Testing stage with its
   approved workflow journey. Choose **Edit journey**. **Expect**:
   - a journey marked "Based on workflow";
   - the workflow's variables shown as captures and bindings, with their confidence.
2. Add a step and bind it, then generate and run a smoke load. **Expect** the report to say
   "Based on workflow …".
3. Choose **Revert to proposed journey** and confirm. **Expect**:
   - the confirmation names the step you added, whose settings will be discarded;
   - the proposed journey back, with its original step ids;
   - an expected status you set on a workflow step while it was edited, still on that step.

## 7. Restore, removal and missing targets (User Story 3 AS3, AS4; FR-016, FR-025, FR-027, FR-028; SC-007)

1. After a run with user journeys, delete the journey and change the load profile. Restore the
   run's settings. **Expect** the journey, its steps, captures and bindings to match the run's.
2. Remove `PUT …/{id}` from the plan. **Expect**:
   - the journey is marked "Incomplete", naming `PUT …/{id}`;
   - generation is still allowed;
   - the pending bar lists the journey as a note;
   - the run trigger names it as not run;
   - the journey is not in the script.
   Restore the operation, and the journey is complete again.
3. On the guided path, change the API review selection so that a bound body field leaves the step's
   scenario. **Expect**:
   - "Target no longer exists" on the binding;
   - a pending-bar item;
   - `POST /script` refused with `binding_target_missing`.
4. On the guided path, with one journey defined by you and one edited workflow journey, reset the
   plan. **Expect**:
   - the confirmation names the edited workflow journey that will be reverted;
   - your journey is kept, re-checked against the rebuilt plan;
   - the workflow journey is back as proposed, with the settings of its workflow steps.
5. Inspect the run record (`GET …/runs/:id`). **Expect** journey names, origins, captures and
   bindings, and no captured value (FR-027).

## 8. Opt-in real-k6 check (SC-002, SC-003, SC-005; research R8, R19)

Run `npm run test:k6-real -w backend`. This is never part of `npm test`. **Expect**:
- the create, update and delete journey with 0 not-found responses;
- the dropped-id run cut short with 0 PUTs or DELETEs for those iterations;
- a seeded id absent from the plan, script, environment template, run record, report and logs;
- a capture of a repeated response header equal to the value k6 reports, unsplit. The test records that value's form for the user manual (research R8).

## Validation commands

```bash
npm test
npm run lint
npm run build
```
