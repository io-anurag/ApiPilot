---

description: "Task list for AP-035 User-Defined Journeys and Captured Values"
---

# Tasks: User-Defined Journeys and Captured Values for Performance Tests (AP-035)

**Input**: Design documents from `specs/035-user-defined-journeys/`

**Prerequisites**:
- [plan.md](./plan.md)
- [spec.md](./spec.md) (FR-001 to FR-033, Clarifications 2026-10-01 and 2026-10-02)
- [research.md](./research.md) (R1 to R20)
- [data-model.md](./data-model.md)
- [contracts/plan-journeys-api.md](./contracts/plan-journeys-api.md)
- [contracts/changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md)
- [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done, and research R19
defines the test plan. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md US1 to US3), so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an incomplete task).
- **[Story]**: the user story the task belongs to (US1 to US3).
- Paths are relative to the repository root. Workspaces are `backend/`, `frontend/` and
  `packages/shared-domain/`.

## Standing rules for every task

- **Commits.** Do not commit. The user reviews the diff and commits it.
- **Scope.**
  - No AI anywhere in this feature (FR-032).
  - No new dependency, environment variable or SQLite table.
  - The quick path still infers nothing: its context keeps `workflows: []` and
    `relationships: []` (FR-030).
- **ApiPilot never builds a journey or binding on its own (FR-006).** The only server-built
  definition comes from `editProposedJourney` (R14).
- **Data, never code (FR-018).**
  - Captures and bindings reach the script only inside the JSON data constants.
  - The `RUNTIME` text in `backend/src/performance/k6/renderScript.ts` must be identical for every
    plan.
  - No capture path, header name or capture name is ever concatenated into script code.
- **No captured value anywhere (FR-020).** Captured values exist only in the k6 `scope.vars` of
  one journey run. Never put one in the plan, script, environment template, run record, report, UI
  or logs.
- **Never log** capture names, field paths, header names or values. Logs carry journey and step
  ids, counts and error codes (contract Logging).
- **Ordering.** Never use `localeCompare`; use `compareCodeUnits` from
  `backend/src/postman/ordering.ts`. The same plan gives a byte-identical script (FR-021).
- **Plans without user journeys are unchanged.** Their journey ids, step ids, fingerprint and
  rendered data stay as they are. The one intended change to every generated script is the runtime
  rule of T013 (FR-033, R7). Existing performance tests must keep passing after every
  foundational task, with the golden fixture updated only in T014.
- **Refusals** never quote a value. Each refusal names the capture and steps, and leaves the plan
  unchanged (`applyPlanUpdate` validates everything before applying anything).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Fixtures and the stub target used by tests and the quickstart.

- [X] T001 [P] Add `backend/tests/fixtures/openapi/user-journeys.yaml` (OpenAPI 3.0), documenting:
  - `POST /api/v1/customers`: request body `{name}`. Response 201 with body `{id: string, name:
    string}` and a `Location` header.
  - `GET`, `PUT` and `DELETE /api/v1/customers/{id}`: `id` is a required string path parameter.
    `PUT` has body `{name}`. `GET` and `PUT` answer 200, `DELETE` answers 204, all three answer 404.
  - `POST /api/v1/orders`: body `{customerId: string, items: [{sku: string}]}`. Response 201 with
    `{id: string}`.
  - `GET /api/v1/orders/{id}`: query parameter `customer`. Response 200.

  Use no `oneOf`, `anyOf` or `allOf`, and no security scheme.
- [X] T002 [P] Add `userJourneysContext()` to `backend/tests/fixtures/performance/context.ts`, so
  tests can build a quick-path `PerformanceContext` from `user-journeys.yaml`. Model it on the
  existing quick context loader, with stable scenario ids.
- [X] T003 [P] Add builders to `backend/tests/fixtures/performance/builders.ts`:
  - `userJourneyFixture(...)`, `captureFixture(...)` and `bindingFixture(...)`, producing the
    data-model.md shapes;
  - a seeded value `SEEDED-CAPTURED-ID-5e2d`, which tests search every artifact for (SC-005).
- [X] T004 [P] Add a stateful customers mode to `backend/scripts/perfStubTarget.ts`
  (`PERF_STUB_MODE=customers`):
  - each `POST /api/v1/customers` returns 201 with a new id (a counter, never random) and a
    `Location: /api/v1/customers/<id>` header;
  - `GET`, `PUT` and `DELETE /api/v1/customers/:id` answer 404 for an id never issued or already
    deleted;
  - `PERF_STUB_DROP_ID_EVERY=<n>` omits `id` from every n-th POST body;
  - it prints counts of requests per route and of 404s, never ids.

  If `TargetServer` (`backend/tests/fixtures/execution/targetServer.ts`) needs a handler hook for
  this, add it additively and keep its existing configured-route behaviour unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, the path grammar, ids, plan plumbing, the request-builder refactor and
the one runtime change every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for the foundation (write first, confirm they fail)

- [X] T005 [P] Write `backend/tests/unit/performance/capturePath.test.ts` (R6). It must cover:
  - **Accepted:** `id`, `data.items[0].id`, `a-b.$c_d`, `x[12]`.
  - **Canonical segments:** for example `[{field:"data"},{field:"items"},{index:0},{field:"id"}]`.
  - **Refused, with the position:** `*`, `?`, `..`, `[]`, quotes, `items[*]`, `a[?(@.x)]`,
    `f()`, an empty segment, a leading `.`, an index over 6 digits, a path over 256 characters,
    and more than 16 segments.
- [X] T006 [P] Write `backend/tests/unit/performance/userJourneyNames.test.ts` (R11, FR-026, R8):
  - capture names must match `^[A-Za-z_][A-Za-z0-9_]{0,63}$` (accept `customer_id`, `_x`;
    refuse `1st`, `a-b`, `é`, and 65 characters);
  - journey names are "trimmed, 1 to 100 characters, no control characters";
  - header names are an RFC 9110 token "1 to 128 characters", stored lowercased.
- [X] T007 [P] Extend `backend/tests/unit/performance/renderScript.test.ts` (FR-033, R7), using
  `k6Sandbox`:
  - **Proposed workflow journey:**
    - a producer that returns an unexpected status attempts no capture, counts its captures as
      failed, and cuts the journey short;
    - an object or array value fails;
    - a string, number or boolean succeeds as `String(value)`;
    - a field read from an error response is never sent onward.
  - **Runtime text:** the `RUNTIME` text is byte-identical across two different plans (FR-018).
  - **Existing checks:** the generated script still passes `checkUserScript` (AP-029 FR-022a).

### Implementation for the foundation

- [X] T008 Add the types of data-model.md to `packages/shared-domain/src/performance.ts` and
  export them from `packages/shared-domain/src/index.ts`. Every change is additive:
  - **New types:** `BodyPathSegment`, `CaptureSource`, `Capture` (without `id`), `BindingTarget`,
    `ValueBinding`, `UserJourneyStepDefinition` (with `fromProposedStepId?`) and
    `UserJourneyDefinition`.
  - **`PerformanceJourneySource`:** gains the `kind: "user"` variant.
  - **`PerformanceJourney`:** gains `incompleteReason?`.
  - **`PerformanceStep`:** gains `captures?`, `bindings?` and `userDefined?: true`.
  - **`PerformancePlan`:** gains `userJourneys`, `alsoStandalone`, `nextUserJourneyNumber` and
    `bindingsNeedingAttention`.
  - **`BodyEditNotice` kind:** gains `"capture-binding-dropped"`.
  - **`PreviewReference`:** gains the `kind: "capture"` variant.
  - **Result fields:** `StepResult.captures?` and `JourneyResult.cutShortByCapture?`.
- [X] T009 [P] Implement `backend/src/performance/plan/capturePath.ts` (R6): `parseCapturePath(text)`
  and `formatCapturePath(segments)`. It is pure, and returns a typed refusal `{code:
  "capture_path_invalid", position}`. Make T005 pass.
- [X] T010 [P] Implement the name rules of T006 in
  `backend/src/performance/plan/userJourneyNames.ts` (pure). Make T006 pass.

- [X] T011 [P] Implement the pure function `laterStepParameterMatches(field, laterParameterNames)` in
  `packages/shared-domain/src/performance.ts` (R9, FR-009): a field matches when its last segment
  equals a parameter name of a later step in the same journey. It binds nothing (FR-006). Test it in
  `packages/shared-domain/tests/unit/userJourneyMatches.test.ts`.
- [X] T012 Plumb user journeys through `backend/src/performance/plan/buildPlan.ts`, with no
  behaviour yet:
  - `PlanChoices` and `defaultChoices` (`userJourneys: []`, `alsoStandalone: []`,
    `nextUserJourneyNumber: 1`), and `choicesOf`;
  - `planFingerprint` includes them **only when** `userJourneys` or `alsoStandalone` is non-empty
    (R17);
  - `bindingsNeedingAttention: []`;
  - add `userJourneyIdFor(n)` and `userJourneyStepIdFor(journeyId, k)` to
    `backend/src/performance/plan/identifiers.ts` (R2).

  Assert in `backend/tests/unit/performance/buildPlan.test.ts` that an existing plan's journey
  ids, step ids and fingerprint are unchanged.
- [X] T013 Refactor `backend/src/performance/plan/planStepRequest.ts` so that `stepRequestFor`
  reads consumes from `step.variableBindings` and produces from the step's captures, instead of
  recomputing both from the workflow by position (R5). Workflow variables are expressed as captures
  whose key is the existing `workflowVariableName` key. The existing request-preview and plan tests
  must pass unchanged.
- [X] T014 Change `backend/src/performance/k6/renderScript.ts` (R7, R13, FR-033). This depends on
  T013.
  - **Rendered data:** `RenderedStep.produces` becomes `captures: {key, name, source: {body:
    (string | number)[]} | {header: string}}`.
  - **Runtime:**
    - `captureValue(response, source)` walks the stored segments over own fields and array
      indexes, or matches a header case-insensitively, taking "the value exactly as k6 reports it",
      never split (R8);
    - captures are attempted only when `statusOk`;
    - only a string, finite number or boolean succeeds;
    - add `const capture = new Counter("apipilot_capture")`, tagged `{step, journey, capture,
      outcome: "ok" | "failed"}`;
    - add a `capture` tag (the first failed capture) to `apipilot_cut_short`.
  - **Other:** add `apipilot_capture` to `KNOWN_METRICS` in
    `backend/src/performance/k6/metricsStream.ts`. Keep the `extraction` check.
  - **Golden:** regenerate `backend/tests/fixtures/performance/golden/script.js` once, and list
    its diff in the review summary.

  Make T007 pass.
- [X] T015 Add the error classes of contracts/plan-journeys-api.md to
  `backend/src/performance/errors.ts`, and map them in `backend/src/api/performanceHttp.ts`, each
  `400` with the listed extras:
  - `invalid_user_journey`, `journey_too_long`, `too_many_captures`;
  - `capture_name_invalid`, `capture_name_taken`, `capture_path_invalid`,
    `capture_header_invalid`;
  - `binding_capture_unknown`, `capture_in_use`, `binding_target_unknown`, `binding_target_taken`;
  - `parameter_edited`, `invalid_standalone`, `not_a_proposed_journey`, `not_based_on_workflow`.

  Also map `binding_target_missing` as `422`. No message quotes a value.
- [X] T016 [P] Extend `frontend/src/services/performanceTestingClient.ts`:
  - `PlanUpdate` gains `userJourneys`, `alsoStandalone`, `editProposedJourney` and
    `revertProposedJourney`;
  - `PerformanceClient` gains `fetchResponseFields(operationKey)` (`GET
    /plan/response-fields?operationKey=`);
  - `STRING_EXTRAS` gains `capture`, `captureName`, `name`, `operationKey`, `journeyId` and
    `path`, and `NUMBER_EXTRAS` gains `position`;
  - `target` is a typed extra.

  Extend `frontend/tests/unit/performanceTestingClient.test.ts`.

**Checkpoint**: Foundation ready. `npm test` passes, with only the golden script changed.

---

## Phase 3: User Story 1 - Chain create, update and delete with a captured id (Priority: P1) 🎯 MVP

**Goal**: The engineer composes a journey on either path, captures a response body field, and
binds it to a later step's path parameter. Each virtual user then chains POST, PUT and DELETE with
its own id, and the report counts captures.

**Independent Test** (spec US1): with `user-journeys.yaml`, build POST, then PUT, then DELETE,
capturing `customer_id` from `id` and binding `{id}` on PUT and DELETE. Then check:
- every bound request carries the same virtual user's same-iteration capture;
- the report shows the capture's counts;
- a dropped `id` cuts the journey short and sends no PUT or DELETE.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T017 [P] [US1] Write `backend/tests/unit/performance/userJourneys.test.ts` for validation
  (R10, R11).
  - **Limits:** "at most 20 steps" (`journey_too_long`) and "at most 10 captures" per step
    (`too_many_captures`).
  - **Names:** a duplicate capture name in a journey gives `capture_name_taken`.
  - **Bindings:**
    - a binding to a capture of a later or the same step gives `dependency_order_violation` with
      `variable` set to the capture name;
    - an unknown capture gives `binding_capture_unknown`;
    - an undocumented path parameter gives `binding_target_unknown`.
  - **Removals:** removing a step or capture still bound gives `capture_in_use`, with `capture`
    and `stepIds`.
  - **Input:** an unknown journey or step id is refused, and a client-sent `origin` or
    `fromProposedStepId` is ignored.
- [X] T018 [P] [US1] Extend `backend/tests/unit/performance/buildPlan.test.ts` for assembly (R2,
  R4).
  - **Ids:** sequence-based ids are stable across rename and reorder. The same operation twice in
    one journey gives two distinct step ids.
  - **Single-step journeys:** an operation in a user journey loses its single-step journey unless
    it is in `alsoStandalone`. Deleting the definition returns it, unless it is in another
    journey.
  - **Incomplete journeys:** an excluded operation makes the journey incomplete, with
    `incompleteReason.missingOperationKeys`. It is not counted in `stepsNeedingExpectedStatus`, and
    is complete again once the operation is restored.
  - **Order:** a new journey is appended to the journey order.
  - **Bindings:** a bound path parameter is not in `userSuppliedValues` (FR-012), and appears as
    a `consumes` binding with `producerStepId`.
  - **Out of scope:** a guided rebuild in which an operation leaves scope (approvals or API review
    selection) makes the journey incomplete, naming the operation, rather than shortening it (spec
    Edge Cases).
- [X] T019 [P] [US1] Extend `backend/tests/unit/performance/renderScript.test.ts` for user
  journeys, using `k6Sandbox`:
  - **Isolation:** with two virtual users and three iterations, every PUT and DELETE uses that
    virtual user's own POST id from that iteration (FR-017, SC-002).
  - **Failed capture:** a missing `id` sends no PUT or DELETE in that iteration. It records
    `apipilot_cut_short` with `capture: "customer_id"`, and `apipilot_capture` outcome `failed`
    (FR-019, SC-003).
  - **Incomplete journeys:** an incomplete journey is absent from `JOURNEYS`.
  - **Determinism:** ten generations are byte-identical (SC-004).
  - **Second golden:** add `backend/tests/fixtures/performance/golden/user-journeys-script.js`.
  - **Seeded value:** the sandbox's POST returns `SEEDED-CAPTURED-ID-5e2d` as `id`. Assert that it
    reaches the bound PUT and DELETE requests, and appears in no metric tag, check name, `JOURNEYS`
    data or recorded output other than those request URLs (SC-005, FR-020).
- [X] T020 [P] [US1] Write `backend/tests/unit/performance/responseFields.test.ts` (R9). It
  covers:
  - scalar fields of 2xx `application/json` and `+json` schemas, as R6 paths, with `[0]` for
    arrays;
  - sorted by `compareCodeUnits`;
  - `statusCodes` per field;
  - depth 8 and 300-field caps with `truncated`;
  - empty constraints contribute nothing.
- [X] T021 [P] [US1] Extend `backend/tests/unit/performance/aggregate.test.ts`,
  `backend/tests/unit/performance/report/` findings tests and
  `backend/tests/unit/performance/report.test.ts` (R13, FR-029):
  - **Aggregate:** `apipilot_capture` produces `StepResult.captures`, and the `capture` tag
    produces `JourneyResult.cutShortByCapture`.
  - **Findings:** `cut-short-journeys` names the capture that cut the most journeys short, with
    ties broken by name. `PERFORMANCE_FINDINGS_RULESET_VERSION === 2`.
  - **HTML report:** it shows each bound value's capture, producing step and field, and "In a
    journey defined by you".
  - **Older runs:** a run without these fields renders as before.
- [X] T022 [P] [US1] Write `backend/tests/integration/performance/userJourneyRoutes.test.ts`
  (Supertest, both bases):
  - **`PUT /plan { userJourneys }`:** success returns assigned ids and an updated
    `script.outOfDate`. Each T017 refusal leaves the plan unchanged.
  - **`GET /plan/response-fields`:** `400 invalid_request` without `operationKey`, and `400
    unknown_operation`.
  - **`GET /plan/steps/:stepId/request`:** a user step returns a `capture` reference and no value.
  - **Run snapshot:** after `POST /runs` with the fake runner, `planSnapshot.userJourneys` is
    present.
  - **Seeded value:** `SEEDED-CAPTURED-ID-5e2d` appears in no response body, run record or report
    (SC-005).
- [X] T023 [P] [US1] Write the frontend tests in
  `frontend/tests/unit/UserJourneys.test.tsx`, using `performanceFixtures.ts` and `stubFetch`:
  - **New journey:** it asks for a name. **Add step** picks from the plan's operations.
  - **Group header:** "Defined by you" is shown in text.
  - **Single-step notice:** the plan says the operation no longer runs on its own.
  - **Reorder refusal:** a refused move shows "That order would run a step before the step that
    produces customer_id. The order is unchanged."
  - **`capture_in_use` message:** it names the capture and steps.
  - **Captures tab:** it lists documented fields, and marks a field matching a later step's
    parameter.
  - **Path-parameter source:** "Value captured by an earlier step" lists only earlier steps'
    captures.
  - **Delete:** asks to confirm.
  - **Incomplete journey:** shown with the missing operation, as a pending-bar note, and named at
    the run trigger (FR-025).
  - **Quick scope note:** follows FR-031.

  Use semantic queries, not class names.

### Implementation for User Story 1

- [X] T024 [US1] Implement validation and id assignment in
  `backend/src/performance/plan/userJourneys.ts` (pure).
  - **`validateUserJourneys(input, plan, context)`:** applies T010's rules and T009's parser.
    `operationKey` must be in the analysis (`unknown_operation`). Bindings are validated against
    documented path parameters (US1 scope; other targets come in T043). It throws the T015 errors.
  - **`assignIds(input, previous)`:** keeps known ids, assigns `userJourneyIdFor` and
    `userJourneyStepIdFor` from `nextUserJourneyNumber` and `nextStepNumber`, and resolves
    `captureStepIndex` to the assigned id. Server-only fields (`origin`, `fromProposedStepId`,
    `documented`, `state`, `confidence`, `relationshipId`) come from the stored definition, never
    from input.

  Make T017 pass.
- [X] T025 [US1] Implement `documentedResponseFields(operation)` in
  `backend/src/performance/plan/responseFields.ts` (R9), using `SchemaConstraint` `properties` and
  `items`. It is pure. Make T020 pass.

- [X] T026 [US1] Implement `resolveUserJourneys(definitions, choices, context)` in
  `backend/src/performance/plan/userJourneys.ts`, and call it from `assemblePlan` in
  `backend/src/performance/plan/buildPlan.ts` (R4, R5). It builds journeys in this order:
  1. proposed journeys;
  2. user journeys, complete or incomplete;
  3. single-step journeys, minus operations in user journeys, plus `alsoStandalone`.

  Each binding becomes a `consumes` `StepVariableBinding` with `producerStepId` and key
  `apipilot_c_<producer step id without "s_">_<capture name>`. Mark steps `userDefined: true`.
  Re-derive `documented` for body captures through T025's function. Append new journeys to the
  journey order. Make T018 pass.
- [X] T027 [US1] Add the `apipilot_c_` prefix to `reservedNamesOf` in
  `backend/src/performance/plan/bodyEdits.ts`, so an engineer's `{{name}}` cannot reach a capture
  key. Add a case to `backend/tests/unit/performance/bodyEdits.test.ts`.
- [X] T028 [US1] Wire `PUT /plan` in `backend/src/performance/plan/planUpdate.ts`:
  - `userJourneys` and `alsoStandalone` (refuse `invalid_standalone` for a key in no user
    journey);
  - validate everything before applying anything;
  - `stepOrder` and `expectedStatuses` accept user step ids.

  Add `GET /plan/response-fields` to `backend/src/api/performanceRoutes.ts` (thin, calls T025).
- [X] T029 [US1] Extend `backend/src/performance/plan/requestPreview.ts` so a bound target shows
  `{reference: {kind: "capture", captureName, producerStepId, source}}` and never a value (FR-012).
  A capture bound to a header, or to a field the request schema declares `format: password`, has
  `secret: true` on its reference (spec Edge Cases, "Captured secrets").
- [X] T030 [US1] Keep `userJourneys`, `alsoStandalone` and `nextUserJourneyNumber` in
  `backend/src/performance/plan/runSnapshot.ts`. Read a missing value as `[]`, `[]` and `1` in
  `backend/src/persistence/performanceRunRepository.ts` (the `BODY_EDIT_DEFAULTS` pattern) (R12,
  FR-027). Extend `backend/tests/unit/persistence/performanceRunRepository.test.ts`.
- [X] T031 [US1] Implement the report changes (R13, FR-029):
  - **Aggregate:** read `apipilot_capture` and the `capture` tag in
    `backend/src/performance/report/aggregate.ts`.
  - **Findings:** name the capture in `cut-short-journeys` and bump
    `PERFORMANCE_FINDINGS_RULESET_VERSION` to 2, in `backend/src/performance/report/findings.ts`
    and `packages/shared-domain/src/performance.ts`.
  - **HTML report:** add bound sources, capture counts and journey origin to the step request and
    response blocks and provenance in `backend/src/performance/report/renderHtmlReport.ts`.

  Make T021 pass. Run T019 and T022 to confirm the end-to-end path.
- [X] T032 [P] [US1] Add labels to `frontend/src/components/performance/performanceViewModel.ts`:
  - journey origin: "Proposed from workflow", "Defined by you", "Based on workflow";
  - "Incomplete";
  - "Uses captured value";
  - "Captures n".

  Add the capture wording to `frontend/src/components/performance/PreviewReferenceNote.tsx`:
  "from captured value {captureName} (step {stepLabel})".

  Show a "secret" badge for a capture reference with `secret: true`, as for environment secrets.
- [X] T033 [US1] Create `frontend/src/components/performance/UserJourneyControls.tsx` and
  `frontend/src/components/performance/AddStepDialog.tsx`:
  - **New journey:** uses `PromptDialog`.
  - **Rename:** uses `PromptDialog`.
  - **Delete:** uses `ConfirmDialog`, saying operations return as single-step journeys.
  - **Add step:** a searchable operation list in `Dialog`, built from the plan's operations,
    including those already in journeys.
  - **Also run on its own:** a toggle.

  Every control is a `<button>` with an accessible name. Each change composes the full
  `userJourneys` list and calls `apply()` in `PerformancePlanScreen.tsx`.
- [X] T034 [US1] Create `frontend/src/components/performance/CaptureEditor.tsx`, the inspector's
  Captures tab:
  - **Adding:** a name input, and a body field picker from `fetchResponseFields` with the
    later-step match marked as text.
  - **Typing a path:** allowed. The server parses it and refusals show inline.
  - **Removing:** a capture can be removed.

  Create `frontend/src/components/performance/BindingSourceControl.tsx`: for a path parameter row,
  "Value captured by an earlier step" with only captures of earlier steps in the same journey.
- [X] T035 [US1] Update `frontend/src/components/performance/JourneyList.tsx`:
  - **Group header:** replace the hard-coded "Workflow" with the origin label, and treat
    user journeys as grouped.
  - **Badges:** show "Incomplete" with `missingOperationKeys`, and the step badges.
  - **Inspector:** add the Captures tab. Mount `UserJourneyControls` in the toolbar and group
    header.
  - **Step moves:** offer step moves within user journeys.

  Wire `BindingSourceControl` into `frontend/src/components/performance/StepParameterEditor.tsx`
  for path parameter rows.
- [X] T036 [US1] Update `frontend/src/components/performance/PerformancePlanScreen.tsx`:
  - **Messages:** `explain()` maps `capture_in_use` to "{capture} is used by step(s) {labels}.
    Remove those bindings first." and keeps the order message for `dependency_order_violation`.
  - **Single-step notice:** shown when an operation first joins a journey (FR-003).
  - **Incomplete journeys:** a non-blocking pending-bar note listing them.

  In `frontend/src/components/performance/PerformanceRunPanel.tsx`, the run trigger names each
  incomplete journey that will not run (FR-025).
- [X] T037 [US1] Change the scope note in `frontend/src/pages/QuickPerformancePage.tsx`: requests
  are not chained unless the engineer builds a journey, with **New journey** named, and no pointer
  to the guided workflow (FR-031). Update `frontend/tests/unit/QuickPerformancePage.test.tsx`.
  Make T023 pass.

**Checkpoint**: User Story 1 works on both paths. Run quickstart 1 to 4.

---

## Phase 4: User Story 2 - Pass captured values anywhere a request takes a value (Priority: P2)

**Goal**: The engineer can capture from headers, and bind to query, header and body targets. Bound
body fields appear in the body editor, an edited parameter is protected when bound, repeated
operations work, and the write summary counts steps.

**Independent Test** (spec US2): capture `customer_id` from a body and `order_url` from `Location`.
Bind `customer_id` to a body field, a query parameter and a header, and repeat a GET. Then check:
- each target received the value;
- the repeated GET counts as two steps;
- the script is byte-identical twice.

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [X] T038 [P] [US2] Extend `backend/tests/unit/performance/userJourneys.test.ts`:
  - **Header captures:** `capture_header_invalid` for an invalid header capture.
  - **Targets:**
    - query, header and body targets resolve;
    - a header the step's authentication covers gives `binding_target_unknown`;
    - a body field absent from the base body gives `binding_target_unknown`;
    - two bindings on one target give `binding_target_taken`;
    - binding a parameter with an AP-033 edit gives `parameter_edited`. It succeeds when the same
      request sends a `parameterEdits` entry without that parameter (FR-014).
  - **Rebuild:** a rebuild that removes a bound target marks `state: "target-missing"` and fills
    `bindingsNeedingAttention` (FR-016).
  - **Documented flag:** an undocumented body path gives `documented: false`. Header captures give
    `documented: null`.
- [X] T039 [P] [US2] Extend `backend/tests/unit/performance/renderScript.test.ts` and
  `backend/tests/unit/performance/bodyEdits.test.ts`:
  - **Header capture:** matches regardless of case, and takes the whole value as reported.
  - **Body binding:** fills the field with JSON escaping.
  - **Query and header bindings:** serialized as AP-029 FR-011.
  - **Body edit:** removing a bound field drops the binding, with a `capture-binding-dropped`
    notice (FR-013).
  - **Body editor model:** `StepBodyEditModel.replacements` lists bound fields with a `capture`
    reference.
- [X] T040 [P] [US2] Extend `packages/shared-domain` tests (or
  `frontend/tests/unit/WriteOperationSummary.test.tsx`) for `summarizeWriteOperations` (R15,
  FR-023):
  - `total` and `byMethod` count steps;
  - each entry lists `steps` with `journeyLabel`;
  - incomplete journeys are excluded;
  - a plan with each operation in one step gives today's numbers.
- [X] T041 [P] [US2] Extend `backend/tests/integration/performance/userJourneyRoutes.test.ts`:
  `POST /script` returns `422 binding_target_missing {stepIds}` after a guided rebuild removes a
  bound field. The refusal order is `nothing_to_test`, `expected_status_missing`,
  `binding_target_missing`.
- [X] T042 [P] [US2] Extend `frontend/tests/unit/UserJourneys.test.tsx`:
  - **Header captures:** can be added by name.
  - **Binding sources:** offered for query and header rows, and for body fields.
  - **Body editor:** "Replaced at run time" lists bound fields with the capture.
  - **Edited parameter:** binding one asks first (`ConfirmDialog`), and confirming sends the
    binding and the reduced `parameterEdits` in one `PUT`.
  - **Undocumented path:** "Not documented in the specification" is shown, and generation stays
    enabled.
  - **Missing target:** "Target no longer exists" is shown, a pending-bar item appears, and
    Generate is disabled with "A captured value's target no longer exists".
  - **Repeated operation:** shows as two steps, each with its own expected status.

### Implementation for User Story 2

- [X] T043 [US2] Extend `validateUserJourneys` and `resolveUserJourneys` in
  `backend/src/performance/plan/userJourneys.ts`:
  - **Header captures:** use T010's header rule.
  - **Targets:** query and header parameters the specification documents, excluding headers the
    step's authentication covers, and body fields of the current base body (R6 grammar).
  - **Uniqueness and edits:** `binding_target_taken`, and `parameter_edited` unless the same
    update's `parameterEdits` leaves the parameter out.
  - **Rebuild:** `target-missing` on rebuild, and fill `bindingsNeedingAttention`.

  Make T038 pass.
- [X] T044 [US2] In `backend/src/performance/plan/bodyEdits.ts`:
  - drop bindings whose body field an edit removed, with a `capture-binding-dropped` notice;
  - list bound fields in `replacements`;
  - make bound parameter rows `notEditable: "filled-at-run-time"` in the parameter edit model, so
    AP-033 FR-021 refuses edits to them.

  Make T039 pass.
- [X] T045 [US2] Add the `binding_target_missing` refusal to `POST /script` in
  `backend/src/api/performanceRoutes.ts`, after the existing two (FR-016). Make T041 pass.
- [X] T046 [P] [US2] Change `summarizeWriteOperations` in `packages/shared-domain/src/performance.ts`
  (R15). Keep `stepIds` for compatibility. Update
  `frontend/src/components/performance/WriteOperationSummary.tsx` and the run trigger's counts in
  `frontend/src/components/performance/PerformanceRunPanel.tsx` to show per-step counts with
  journey names. Make T040 pass.
- [X] T047 [US2] Frontend:
  - **Header captures:** add them in `CaptureEditor.tsx`.
  - **Binding source:** extend `BindingSourceControl.tsx` to query and header rows in
    `StepParameterEditor.tsx`, and to body fields in
    `frontend/src/components/performance/StepBodyEditor.tsx`. Binding an edited parameter shows a
    `ConfirmDialog` first (FR-014).
  - **Labels:** "Not documented in the specification" and "Target no longer exists" in
    `performanceViewModel.ts`.
  - **Pending bar:** a `bindings` item, plus `generateBlockedReason` in `PerformancePlanScreen.tsx`.

  Make T042 pass.

**Checkpoint**: User Stories 1 and 2 both work. Run quickstart 5.

---

## Phase 5: User Story 3 - Adjust a proposed workflow journey and keep journeys across runs (Priority: P3)

**Goal**: On the guided path, a proposed workflow journey can be edited into a "based on workflow"
journey and reverted, carrying settings back. Restoring a past run brings its journeys back.

**Independent Test** (spec US3): edit the proposed two-step journey, add two steps and bindings,
and run it. Then remove a step and regenerate. Restore the first run's settings, and check that the
journeys, captures and bindings match.

### Tests for User Story 3 ⚠️ (write first, confirm they fail)

- [X] T048 [P] [US3] Write `backend/tests/unit/performance/convertWorkflowJourney.test.ts` (R14).
  - **Conversion:**
    - one step per workflow step, each with `fromProposedStepId`;
    - each `WorkflowVariable` becomes a capture and binding, with `relationshipId` and
      `confidence`;
    - invalid variable names are sanitized (invalid characters to `_`, a `_` prefix before a
      digit, `_2`/`_3` on a clash, in variable order);
    - expected statuses, body edit and parameter edit are copied to the new step ids.
  - **Suppression:** while the definition exists, the proposed journey is absent.
  - **Revert:**
    - settings of converted steps return to the proposed step ids;
    - settings of added steps are discarded;
    - an edit whose `scenarioId` no longer matches is discarded, as usual (FR-024).
- [X] T049 [P] [US3] Extend `frontend/tests/unit/restoreFromRun.test.ts` and
  `frontend/tests/unit/PerformancePlanScreen.test.tsx` (R12, FR-028):
  - **Restore:** sends the snapshot's `userJourneys` and `alsoStandalone`.
  - **Order:** `restoreOrderFromRun` restores the order of user journeys.
  - **Message:** names each step that came back incomplete or with a missing target as not
    restored.
  - **Older runs:** a snapshot without `userJourneys` restores as before.
- [X] T050 [P] [US3] Extend `backend/tests/integration/performance/userJourneyRoutes.test.ts`:
  - **`editProposedJourney`:** succeeds on the guided base. It gives `not_a_proposed_journey` on
    the quick base, or for a single-step journey.
  - **`revertProposedJourney`:** succeeds, and gives `not_based_on_workflow` for a defined
    journey.
  - **Combining fields:** sending two of the three journey fields gives `invalid_request`.
  - **Restore round-trip:** `PUT /plan` with a snapshot's definitions gives the same journeys,
    captures and bindings (SC-007).
  - **Sequence numbers:** `nextUserJourneyNumber` and `nextStepNumber` end at least one above the
    restored maxima.
- [X] T051 [P] [US3] Extend `frontend/tests/unit/UserJourneys.test.tsx`:
  - **Edit journey:** on a proposed workflow journey, it produces "Based on workflow" with the
    confidence shown on bindings.
  - **Revert to proposed journey:** confirms first, naming added steps whose settings are
    discarded.
  - **Quick path:** no **Edit journey** is offered.

### Implementation for User Story 3

- [X] T052 [US3] Implement `convertWorkflowJourney(journey, plan, workflow)` and
  `revertWorkflowJourney(definition, choices)` in
  `backend/src/performance/plan/convertWorkflowJourney.ts` (pure). In `assemblePlan`, suppress
  the proposed journey for each `based-on-workflow` definition. Make T048 pass.
- [X] T053 [US3] Wire `editProposedJourney` and `revertProposedJourney` in
  `backend/src/performance/plan/planUpdate.ts`:
  - guided only;
  - mutually exclusive with each other and with `userJourneys` (`invalid_request`);
  - `not_a_proposed_journey` and `not_based_on_workflow`.

  On restore of explicit ids, set the sequence numbers to at least one above the maxima. Make T050
  pass.

- [X] T054 [US3] Extend `POST /plan/reset` (contracts/plan-journeys-api.md, spec Edge Cases "Resetting
  the plan"):
  - in `backend/src/api/performanceRoutes.ts` and `backend/src/performance/plan/buildPlan.ts`, keep
    `defined` definitions and `alsoStandalone` through `choicesOf`, and revert each
    `based-on-workflow` definition with `revertWorkflowJourney` (T052);
  - in `frontend/src/components/performance/PerformancePlanScreen.tsx`, the reset confirmation names
    the edited workflow journeys that will be reverted;
  - test it in `backend/tests/integration/performance/userJourneyRoutes.test.ts`: a defined journey
    survives reset, re-resolved, and a based-on-workflow journey is reverted with its settings
    carried back.
- [X] T055 [US3] Frontend:
  - **Edit journey and Revert to proposed journey:** add both to `UserJourneyControls.tsx` (guided
    only). Revert's `ConfirmDialog` names the added steps whose settings will be discarded.
  - **Confidence:** show it on converted bindings in `BindingSourceControl.tsx` and the
    inspector.
  - **Restore:** extend `frontend/src/components/performance/restoreFromRun.ts` and `restoreRun`
    in `PerformancePlanScreen.tsx` to send the definitions, and name the steps not restored.

  Make T049 and T051 pass.

**Checkpoint**: All three user stories work. Run quickstart 6 and 7.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T056 [P] Extend `backend/tests/integration/performance.k6.real.test.ts` (opt-in,
  `K6_TEST_REAL=1`, never in `npm test`), against a `TargetServer` in customers mode:
  - the create, update and delete journey has 0 not-found responses (SC-002);
  - with ids dropped, no PUT or DELETE is sent for those iterations, and they are cut short
    (SC-003);
  - a repeated `Set-Cookie`-style header capture equals the value k6 reports, and the test records
    its form for the manual (R8);
  - the seeded id is absent from all artifacts and captured logs (SC-005).
- [X] T057 [P] Add amendment pointers:
  - in `specs/031-k6-performance-testing/spec.md` at FR-010 (amended by AP-035 FR-033) and FR-024b
    (extended by AP-035 FR-028);
  - in `specs/032-quick-performance-test/spec.md` at FR-006 (AP-035 FR-030), and at FR-009 and
    FR-011 (counts are per step, AP-035 FR-023);
  - in `specs/031-k6-performance-testing/contracts/performance-api.md` at `PUT /plan`, pointing to
    `specs/035-user-defined-journeys/contracts/plan-journeys-api.md`;
- [X] T058 [P] Document the feature:
  - `docs/USER_MANUAL.md`: a new subsection on journeys and captured values, covering the
    capture rule (FR-033), the header value as k6 reports it, and incomplete journeys.
  - `docs/architecture.md`: definitions in plan choices, and the one substitution path.
  - `README.md`: the feature list, if it lists performance features.
- [X] T059 Add a log check to `backend/tests/integration/performance/userJourneyRoutes.test.ts`:
  logs captured during the route tests contain no capture name, field path, header name or seeded
  value (contract Logging, XX).
- [X] T060 Update `specs/ROADMAP.md`: add an AP-035 row and a Next Actions entry, following the
  AP-034 entries.
- [X] T061 Run `npm run version:bump -- feature` (19.15.0 → 19.16.0). This updates the 4
  `package.json` files and `package-lock.json` through npm.
- [X] T062 Run `npm test`, `npm run lint` and `npm run build`. Record the results in
  `specs/035-user-defined-journeys/validation.md`, exactly as run, including any failures.
- [ ] T063 Walk through quickstart.md scenarios 1 to 7 in the browser with k6 installed, and record
  each outcome in `specs/035-user-defined-journeys/validation.md`. If this cannot be done, leave
  the task unchecked and say so (constitution XXXI).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1):** no dependencies. T001 to T004 are all [P].
- **Foundational (Phase 2):** depends on T001 to T003. It blocks every user story.
  - T008 comes before everything else in the phase.
  - T009 and T010 depend on T005 and T006. T011 can run beside them.
  - T012 comes before T013, which comes before T014 (T014 needs T007 written first).
  - T015 and T016 can run beside T012 to T014.
- **US1 (Phase 3):** depends on Phase 2.
- **US2 (Phase 4):** depends on US1's T024, T026 and T028. It extends the same validator and
  resolver.
- **US3 (Phase 5):** depends on US1's T024, T026, T028 and T030. It is independent of US2. T054
  (reset) depends on T052.
- **Polish (Phase 6):** depends on the stories being delivered. T056 needs T004. T061 to T063 come
  last.

### Within Each User Story

- Tests first, and confirm they fail.
- Backend domain (`performance/plan/`) before routes, and routes before the frontend.
- `userJourneys.ts` is shared by T024, T026 and T043, so run those in order.
- T025 comes before T026, which re-derives `documented` through T025's function.
- `JourneyList.tsx` and `PerformancePlanScreen.tsx` are touched by several tasks, so run those in
  order.

### Parallel Opportunities

- **Phase 1:** T001 to T004.
- **Phase 2:** T005, T006 and T007 together. Then T009, T010, T011 and T016 beside the T012 →
  T013 → T014 chain.
- **US1:** tests T017 to T023 together. Then T032 beside the backend chain T024 → T025 → T026 →
  T028.
- **US2 and US3:** they can proceed in parallel once US1's backend tasks are done.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T017 userJourneys validation tests in backend/tests/unit/performance/userJourneys.test.ts"
Task: "T018 assembly tests in backend/tests/unit/performance/buildPlan.test.ts"
Task: "T020 response fields tests in backend/tests/unit/performance/responseFields.test.ts"
Task: "T022 route tests in backend/tests/integration/performance/userJourneyRoutes.test.ts"
Task: "T023 UI tests in frontend/tests/unit/UserJourneys.test.tsx"

# Then, beside the T024 → T025 → T026 → T028 backend chain:
Task: "T032 labels in frontend/src/components/performance/performanceViewModel.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup.
2. Phase 2: Foundational. The only change to existing output is the golden script (FR-033).
3. Phase 3: User Story 1.
4. **Stop and validate:** quickstart 1 to 4. A create, update and delete journey with a captured id
   runs on the quick path without 404s.

### Incremental Delivery

1. Setup and Foundational give the foundation and the stricter capture rule.
2. US1 is the MVP: compose, capture a body field, bind a path parameter, run, report.
3. US2 adds headers, query, header and body targets, editor integration, repeated operations and
   the write summary.
4. US3 adds edit and revert of a proposed journey, and restore.
5. Polish adds real k6, pointers, docs, the roadmap, version 19.16.0 and validation.

---

## Notes

- **Implementation record (2026-10-02).**
  - **Done:** 62 of 63 tasks.
  - **T056:** the opt-in real-k6 cases passed with k6 v2.3.0 on 2026-10-02.
  - **T063:** the browser walkthrough has not been performed.
  - **UI placement (T035, T047):** the capture editor and the "Value captured by an earlier step"
    control live in the **Your journeys** panel (`UserJourneysPanel.tsx`) on the Plan tab, not in a
    Captures tab of the operations table's inspector. The table shows the origin, "Incomplete",
    "Captures n", "Uses captured value" and "Target no longer exists" markers. The body editor's
    "Replaced at run time" list shows bound fields through the request preview.
  - **Details:** see `validation.md`.

- **No commits.** Leave every change uncommitted for the user's review.
- **Security-relevant tasks.** Flag these in the review summary:
  - T014 and T019 change what the generated script does at run time;
  - T024, T043 and T044 decide which plan input reaches the script as data;
  - T030 changes what run snapshots store.
- **Golden fixture.** `golden/script.js` changes only in T014. Any later change to it is a
  reviewed contract change; update research R7 first.
