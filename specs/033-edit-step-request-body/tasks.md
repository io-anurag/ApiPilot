---

description: "Task list for AP-033 Edit a Performance Step's Request Body"
---

# Tasks: Edit a Performance Step's Request Body (AP-033)

**Input**: Design documents from `specs/033-edit-step-request-body/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md) (R1 to R14),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done. Write each story's
tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md US1 to US4) so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US4)
- Paths are relative to the repository root. Workspaces: `backend/`, `frontend/`, `packages/shared-domain/`.

## Standing rules for every task

- Do not commit. The user reviews the diff and commits it.
- No new dependency, environment variable, database column or AI. The body editor is a plain
  `<textarea>`, and no JSON Schema library is used (research R7, R13).
- Never log body text, a JSON parser message, a field value or an environment value (R14).
- A plan with no body edits keeps its exact fingerprint, script and environment template (R10).
  `backend/tests/unit/performance/renderScript.test.ts`'s golden comparison must pass unchanged
  after every task.
- Byte-identical output for the same plan and edits (FR-015). Use `compareCodeUnits` from
  `backend/src/postman/ordering.ts` for ordering, never `localeCompare`.
- Never evaluate a `pattern` from the specification (R7).
- Tailwind utilities and existing tokens only; text, not colour alone, for every state
  (constitution XXXIII).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The fixture that several stories' tests and the quickstart need.

- [X] T001 [P] Create `backend/tests/fixtures/openapi/body-edits.yaml`, OpenAPI 3.0, with a comment header naming AP-033 and the quickstart. It needs:
  - `GET /errors/conflict`, with no request body and a documented 200;
  - `POST /orders`, `application/json` with a required integer `quantity` (`minimum: 1`), a string `status` enum (`new`, `paid`), a `customerEmail` of `format: email`, and a nested object `shipping` with a required string `city`;
  - `POST /accounts`, `application/json` with a required `pin` of `type: string, format: password` and a `name` string;
  - `POST /notes`, `text/plain` with a string schema;
  - `POST /uploads`, `multipart/form-data`;
  - `PATCH /profiles/{profileId}`, with an optional (`required: false`) JSON body.

  Every operation documents a 2xx response. Before relying on it in US1 T015, confirm with a unit assertion whether the positive scenario for `PATCH /profiles/{profileId}` sends a body. If it does, find or add an operation whose positive scenario sends none, and record that choice in the fixture header.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, the typed error, and the one place an edit is applied, carried through every plan change. Every story builds on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add the AP-033 types to `packages/shared-domain/src/performance.ts` as in [data-model.md](./data-model.md), with doc comments citing the FR and R numbers:
  - new: `BodyEdit` (discriminated on `kind`), `BodyEditInput`, `BodyEditNotice`, `BodyMismatch`, `StepBodyStatus`, `StepBodyEditModel`;
  - `PerformancePlan`: `bodyEdits: BodyEdit[]`, `bodyEditNotices: BodyEditNotice[]`, `discardedBodyEdits: string[]`. Document which are fingerprinted (R10);
  - `PerformanceStep`: `bodyEdited?: true`;
  - `StepRequestPreview`: `bodyStatus: StepBodyStatus` and `bodyEdit: StepBodyEditModel | null`.

  The package index already re-exports `./performance`. Run `npm run build -w packages/shared-domain`.
- [X] T003 [P] Add `InvalidBodyEditError` to `backend/src/performance/errors.ts`. Its constructor takes `code` (`"invalid_body_edit" | "body_not_accepted" | "body_too_large" | "invalid_body" | "reserved_reference" | "body_secret_literal"`), `stepId`, a message, and optional `extra` (`limitBytes`, `line`, `column`, `reference`, `fieldPath`). Map it in `handleKnownError` in `backend/src/api/performanceHttp.ts` to `400 {error: code, message, stepId, ...extra}`.
- [X] T004 Write failing unit tests in `backend/tests/unit/performance/bodyEdits.test.ts` for `effectiveScenario`:
  - no edit returns the same scenario object;
  - a JSON edit replaces `request.body` with the stored value;
  - a text edit replaces it with the string;
  - the input scenario is never mutated.
- [X] T005 Create `backend/src/performance/plan/bodyEdits.ts` with `effectiveScenario(scenario, edit | undefined)` (research R3), which makes T004 pass. Add a module doc comment citing AP-033 R1 to R3.
- [X] T006 Thread body edits through plan assembly in `backend/src/performance/plan/buildPlan.ts` and `backend/src/performance/plan/buildJourneys.ts`:
  - `PlanChoices` gains `bodyEdits: BodyEdit[]`, and `defaultChoices` gives `[]`;
  - `choicesOf` copies `plan.bodyEdits`;
  - `buildJourneys` takes a `ReadonlyMap<stepId, BodyEdit>`;
  - `makeStep` applies `effectiveScenario` only when the edit's `scenarioId` equals the selected scenario's id. It then uses the result for `buildStepRequest` and for `uniqueValueCandidates`, and sets `bodyEdited: true` on the step;
  - `assemblePlan` keeps an edit when its step exists with the same scenario, **or** its `operationKey` is in `excludedOperationKeys`, so removing an operation never drops its edit (FR-018; the rebuild rule is US4 T045). It sorts them by `stepId` with `compareCodeUnits`, and sets `bodyEditNotices: []` (filled in US3 T034) and `discardedBodyEdits: []`;
  - `planFingerprint` includes `bodyEdits` only when it is not empty, and excludes `bodyEditNotices` and `discardedBodyEdits` (R10).

  Update the `finalizePlan` input type accordingly.
- [X] T007 Use the same effective scenario in `stepRequestFor` in `backend/src/performance/plan/planStepRequest.ts`: look up the step's edit in `plan.bodyEdits`, check its `scenarioId`, and pass `effectiveScenario(...)` to `buildStepRequest`. `uniqueTokensOf`'s `original` value must come from the effective body too.
- [X] T008 Extend `backend/tests/unit/performance/buildPlan.test.ts`:
  - with a plan that has an edit injected through choices, `requiredValues`, `uniqueValueFields`, the step's `bodyEdited` and the fingerprint all change;
  - with `bodyEdits: []`, the fingerprint equals the value computed before this feature. Before starting T006, run the test once on the unchanged code to capture the fingerprint of the plan built by `readyPlan()` as a literal, then assert against that literal.

  Confirm that every existing AP-029 and AP-032 backend test still passes (`npm test -w backend`).
- [X] T009 [P] Make every frontend fixture plan carry the new fields: add `bodyEdits: []`, `bodyEditNotices: []`, `discardedBodyEdits: []` in `frontend/tests/unit/performanceFixtures.ts`. Add `bodyStatus` and `bodyEdit` to the preview fixtures in `frontend/tests/unit/StepRequestPreview.test.tsx`. Run `npm test -w frontend`.
- [X] T010 [P] Extend the client in `frontend/src/services/performanceTestingClient.ts`:
  - `PlanUpdate` gains `bodyEdits?: Record<string, BodyEditInput | null>`;
  - `PerformanceErrorResult` gains the optional extras `stepId`, `line`, `column`, `reference`, `fieldPath` and `limitBytes`, copied in `request` as the existing extras are.

  Add a case to `frontend/tests/unit/performanceTestingClient.test.ts` asserting that the extras are mapped.

**Checkpoint**: an edit injected into the plan changes what the preview and the script send, with no route or UI yet. All existing tests and the golden files pass.

---

## Phase 3: User Story 1 - See every step's body, or that it has none (Priority: P1) 🎯 MVP

**Goal**: Every step says what body it sends, that it has none, that it could send one, or that its body type cannot be edited (FR-001, FR-002).

**Independent Test**: On `body-edits.yaml` in the quick path, open `GET /errors/conflict`, `POST /orders`, the optional-body operation and `POST /uploads`, and check the four statements (quickstart 1).

### Tests for User Story 1

- [X] T011 [P] [US1] Extend `backend/tests/unit/performance/requestPreview.test.ts`:
  - `bodyStatus` is `not-documented` with `bodyEdit: null` for a GET without a body;
  - `sent` with `bodyEdit.text` equal to `JSON.stringify(scenarioBody, null, 2)` and `edited: false` for `POST /orders`;
  - `documented-not-sent` with `bodyEdit.text === ""` for the optional-body operation;
  - `unsupported-content-type` with `bodyEdit: null` for `POST /uploads`;
  - the text kind for `POST /notes`.
- [X] T012 [P] [US1] Extend `frontend/tests/unit/StepRequestPreview.test.tsx`: each `bodyStatus` renders its sentence ("This request has no body.", the documented-but-not-sent sentence, the form/multipart sentence), and `sent` still renders the `CodeBlock` body with its reference notes.

### Implementation for User Story 1

- [X] T013 [US1] In `backend/src/performance/plan/requestPreview.ts`, compute `bodyStatus` and `bodyEdit` (research R12, data-model `StepBodyEditModel`):
  - the kind comes from `primaryRequestBodyContentType` in `backend/src/testDesign/requestHelpers.ts`, where JSON-like (`application/json`, `*+json`, none declared) means `json` and `text/*` means `text`;
  - the base text is the edit if there is one, otherwise the effective scenario's body before substitutions;
  - `mismatches` is `[]` for now (US2 T024).

  `buildRemovedOperationPreview` in `backend/src/performance/plan/removedOperationPreview.ts` returns the same fields with no change.
- [X] T014 [US1] Render the body statements in `frontend/src/components/performance/StepRequestPreview.tsx`:
  - "This request has no body." for `not-documented`;
  - "This operation accepts a body that this step does not send." for `documented-not-sent`;
  - "Form and multipart bodies are shown but cannot be edited." for `unsupported-content-type`.

  Keep "View only. Secret values are never shown." for parameters and removed operations.
- [X] T015 [US1] Add a Supertest case to `backend/tests/integration/performance/bodyEditRoutes.test.ts` (a new file for AP-033 route tests, instead of growing `quickRoutes.test.ts`): upload `body-edits.yaml` and check `GET /api/quick-performance/plan/steps/:stepId/request` returns each `bodyStatus` above.

**Checkpoint**: US1 works on both paths. No editing yet.

---

## Phase 4: User Story 2 - Edit the body a step sends (Priority: P1)

**Goal**: Save, cancel and see an edit; the script sends it; the plan marks it; runs and reports record it without content (FR-003 to FR-008, FR-014 to FR-016).

**Independent Test**: Quickstart 2, 3 and 8.

### Tests for User Story 2

- [X] T016 [P] [US2] Add failing tests for `validateBodyEdits` to `backend/tests/unit/performance/bodyEdits.test.ts`, one per check of research R6, in order:
  - `invalid_request` for a malformed entry;
  - `invalid_body_edit` for an unknown step and for a removed operation's step;
  - `body_not_accepted` for `GET /errors/conflict`, for `POST /uploads`, and for `kind: "text"` on `POST /orders`;
  - `body_too_large` at 65,537 bytes UTF-8, but accepted at 65,536;
  - `invalid_body` with `line: 1, column: 14` for `{"quantity": }`, with `line` and `column` at the end of the text for the unfinished `{"quantity": 1`, with the right line for an error on line 3 of a multi-line body, and with a message that never contains the input text;
  - `jsonErrorOffset` stays linear: a 64 KiB invalid body is located in well under a second, with no per-prefix re-parsing;
  - a top-level `3` is saved (any JSON value is accepted) and, for the object schema of `POST /orders`, reported as a `type` mismatch at the root (T024).

  Also: `null` is a reset; an edit equal to the generated base body is not stored; and the whole update is refused when one entry fails (nothing applied).
- [X] T017 [P] [US2] Create `backend/tests/unit/performance/bodySchemaMismatches.test.ts`, one case per rule of research R7 on the `POST /orders` schema:
  - a missing required `quantity`, and a missing nested required `shipping.city`;
  - a wrong type;
  - an enum miss;
  - an `email` format miss;
  - `minimum`, `maxLength` and `maxItems` violations;
  - array items (`items[1].sku`);
  - a string that is exactly `{{qty}}` in an integer field is not reported;
  - a `pattern` in the schema is never evaluated. Use a spy or a schema whose pattern would throw if compiled;
  - traversal stops at `MAX_TRAVERSAL_DEPTH`;
  - messages are plain words naming the field.
- [X] T018 [P] [US2] In `backend/tests/integration/performance/bodyEditRoutes.test.ts`, cover both paths (guided and quick) with a `PUT /plan {bodyEdits}` that:
  - returns `200` with `bodyEdits` stored, `bodyEdited: true` on the step, and `script.outOfDate: true` after an earlier `POST /script`;
  - makes `GET /plan/steps/:stepId/request` show the edited body and `bodyEdit.edited: true`;
  - returns each 400 error of [body-edits-api.md](./contracts/body-edits-api.md) with its extra fields and an unchanged plan;
  - lets `POST /script` succeed while the edited body has schema mismatches (FR-005);
  - on the guided path only, leaves the workflow's approved test model and its generated Postman collection deep-equal before and after the edit (FR-016).
- [X] T019 [P] [US2] Extend `backend/tests/unit/performance/renderScript.test.ts`:
  - with an edited `POST /orders` body, the `JOURNEYS` entry's `request.body` equals `stepRequestFor(...).built.template.body` and the preview's `body.text`;
  - the k6 sandbox (`backend/tests/fixtures/performance/k6Sandbox.ts`) records that edited body being sent;
  - the golden test is unchanged and passing;
  - generating twice with the same edits gives byte-identical script and template.
- [X] T020 [P] [US2] Extend `backend/tests/unit/performance/report.test.ts` and `backend/tests/unit/persistence/performanceRunRepository.test.ts`:
  - `planSnapshotForRun` empties `bodyEdits` and `discardedBodyEdits` and keeps `bodyEdited`;
  - the stored `plan_snapshot` row, `GET /runs/:runId` and the HTML report contain none of a seeded edited-body marker string;
  - the report shows "Body edited by you" on the step and the count in provenance;
  - a row written without the new fields reads back with them empty.
- [X] T021 [P] [US2] Create `frontend/tests/unit/StepBodyEditor.test.tsx`:
  - the textarea has an accessible label and shows `bodyEdit.text`;
  - Save sends `PUT /plan {bodyEdits: {[stepId]: {kind, text}}}` (through a `stubFetch` route);
  - Cancel restores the text and sends nothing;
  - a `400 invalid_body` shows "Not valid JSON at line L, column C." next to the editor, with focus kept in it;
  - mismatches are listed in words;
  - Save is disabled while busy.
- [X] T022 [P] [US2] Extend `frontend/tests/unit/PerformancePlanScreen.test.tsx`:
  - an edited step shows the "Body edited" text badge in its row;
  - the table shows "Body edited · 1";
  - the filter lists only edited steps;
  - after a save, the script state shows out of date.

### Implementation for User Story 2

- [X] T023 [US2] Implement `validateBodyEdits(plan, context, raw)` in `backend/src/performance/plan/bodyEdits.ts`, following research R6 checks 1 to 4 (including the 64 KiB limit) and throwing `InvalidBodyEditError`:
  - For `invalid_body`, keep `JSON.parse` as the parser. When it fails, compute the offset with a new pure, single-pass `jsonErrorOffset(text)` in the same module (R6 check 4), convert it to a 1-based `line` and `column`, and always use ApiPilot's own message, "Not valid JSON at line L, column C.".
  - It returns the next `BodyEdit[]`, dropping edits equal to the generated base body (compare with `canonicalJson` from `backend/src/performance/plan/identifiers.ts`) and removing `null` entries.
  - Leave hooks for checks 5 and 6, which are implemented in US3.
- [X] T024 [US2] Create `backend/src/performance/plan/bodySchemaMismatches.ts` with `bodySchemaMismatches(schema: SchemaConstraint, value: unknown): BodyMismatch[]` (research R7). It is pure, recursive over properties and array `items`, bounded by `MAX_TRAVERSAL_DEPTH`, reports in code-unit order of `fieldPath`, reports a top-level type difference at `fieldPath` `""`, and has no `pattern` support. Use it in `requestPreview.ts` for JSON edits only.
- [X] T025 [US2] Accept `bodyEdits` in `applyPlanUpdate` in `backend/src/performance/plan/planUpdate.ts`. Validate it together with every other field before anything is applied, and pass the result into `choicesOf(...)` before `assemblePlan`. Any `PUT /plan` clears `discardedBodyEdits` (R9).
- [X] T026 [US2] Create `backend/src/performance/plan/runSnapshot.ts` with `planSnapshotForRun(plan)` (R11), and use it where `POST /runs` stores `planSnapshot` in `backend/src/api/performanceRuns.ts`. In `backend/src/persistence/performanceRunRepository.ts`, `toRun` defaults `bodyEdits`, `bodyEditNotices` and `discardedBodyEdits` to `[]` for older rows.
- [X] T027 [US2] In `backend/src/performance/report/renderHtmlReport.ts`:
  - mark steps with `bodyEdited` as "Body edited by you" in `stepRows`;
  - add to `provenance` "N step(s) sent a body written by the engineer, not generated from the specification." when N > 0.

  Everything goes through `escapeHtml`, and the existing disclaimer stays.
- [X] T028 [US2] Add `bodyEditCount` to the `performance_plan_built` event in `backend/src/performance/plan/buildPlan.ts`. Log no other body data (R14).
- [X] T029 [US2] Create `frontend/src/components/performance/StepBodyEditor.tsx`. Its props are `stepId`, `operationKey`, `model: StepBodyEditModel`, `busy`, `onSave(input)`, `onReset()` and `error?: PerformanceErrorResult`. It renders:
  - a labelled monospace `<textarea>` (`font-mono text-xs`, horizontal scroll, `min-h` sized for about 12 lines);
  - Save and Cancel buttons (`BUTTON_STYLES`), plus "Add a body" when `model.text === ""`;
  - error text tied to the textarea with `aria-describedby`;
  - the mismatch list, headed "Differs from the specification", in text;
  - `aria-live` feedback on save.

  No inline styles.
- [X] T030 [US2] Host the editor in `frontend/src/components/performance/StepRequestPreview.tsx`, shown when `bodyEdit` is not null and a new `editable` prop is true. `JourneyList`'s `OperationInspector` passes `editable` and an `onSaveBody` callback; `OtherOperationsTable`'s `RemovedDetails` does not (FR-003). After a save, the preview reloads so the as-sent body updates.
- [X] T031 [US2] Wire saving in `frontend/src/components/performance/PerformancePlanScreen.tsx`: `onSaveBody(stepId, input)` calls `apply({bodyEdits: {[stepId]: input}}, "Body saved.")`. A failure with a body-edit error code goes to that step's editor rather than only to the screen problem banner. `explain` handles the new codes in plain words.
- [X] T032 [US2] In `frontend/src/components/performance/JourneyList.tsx`:
  - show `<StatusBadge label="Body edited" />` in the Request cell of edited rows;
  - add a "Body edited · N" filter chip next to "Needs expected status", with the same reset rules as the other filters (the chip disappears at 0 and its filter stops applying);
  - include "body edited" in the row search text.

**Checkpoint**: US1 and US2 work on both paths: edit, save, cancel, warnings, out of date, report marker, and nothing stored in runs.

---

## Phase 5: User Story 3 - Keep references working and secrets out (Priority: P1)

**Goal**: ApiPilot's references stay applied, dropped ones are announced, engineer references become needed values, reserved names and password literals are refused, and the body is only data in the script (FR-009 to FR-013).

**Independent Test**: Quickstart 4 and 5.

### Tests for User Story 3

- [X] T033 [P] [US3] Add failing tests to `backend/tests/unit/performance/bodyEdits.test.ts`:
  - **Reserved names:** `reserved_reference` for `{{apipilot_unique_0}}`, for a plan workflow variable name, and for a token source's `tokenVariable`, naming the reference.
  - **`body_secret_literal`** on `POST /accounts`: a literal `pin` is refused and names `pin`; `pin: "{{accountPin}}"` is accepted; `pin` left at its generated value while only `name` changed is **refused** (FR-012a, finding C1); a body without `pin` is not refused by this check; a nested `format: password` field is also checked.
  - **Notices:** a dropped workflow consumer field gives `workflow-variable-dropped` with the variable name, and the field is **not** re-created in the sent body. A dropped `customerEmail` gives `unique-field-dropped`, and `uniqueValueFields` no longer lists it.
  - **Engineer references:** `{{warehouseId}}` in an edited body appears in `requiredValues`, `userSuppliedValues` (source `body-reference`, `secret: false`) and the environment template. Removing it again removes it from all three. `{{accountPin}}` as the whole value of `pin` (`format: password`) is `body-reference` with `secret: true`. A name that is also a generated credential elsewhere keeps `secret: true`.
- [X] T034 [P] [US3] Extend `backend/tests/unit/performance/renderScript.test.ts` with the hostile-content test from research R5. An edited body containing `"`, `\`, a backtick, `${1}`, `</script>`, `*/`, U+2028 and U+2029 renders a script that `new Function` (or the k6 sandbox) parses, and the step's `request.body` is byte-identical to the expected text.
- [X] T035 [P] [US3] Add one seeded-secret scan for a plan with body edits to `backend/tests/integration/performance/bodyEditRoutes.test.ts`: an edited body references a secret environment value as `{{accountPin}}`, and the preview, plan, values checklist, script, template, run response, stored row and report must not contain the seeded secret. (Done as one end-to-end test rather than a case in each of the four AP-032 test files, so every output is covered in one place.)
- [X] T036 [P] [US3] Extend `frontend/tests/unit/StepBodyEditor.test.tsx`:
  - the literal-values statement is always visible;
  - the "Replaced at run time" list shows each preview body reference with its source (unique, workflow variable, credential, environment), with secret environment references marked "secret";
  - a `body_secret_literal` error names the field;
  - the step inspector lists `bodyEditNotices` in words.

### Implementation for User Story 3

- [X] T037 [US3] Implement checks 5 (`reserved_reference`) and 6 (`body_secret_literal`) of research R6 in `validateBodyEdits` in `backend/src/performance/plan/bodyEdits.ts`:
  - Reserved names are `UNIQUE_TOKEN_PREFIX` names, `workflowVariableName(...)` values of the plan's workflows, and token sources' `tokenVariable` values (from `planAuth`).
  - Sensitive fields are those whose schema declares `format: password`, walked like the mismatch checker (R8). Every such field present in the edited body must hold exactly one `{{name}}` reference; the generated value is not accepted.
- [X] T038 [US3] Guard body consumers for edited steps in `backend/src/performance/plan/stepRequest.ts` (R4). Add a `bodyEdited` option to `StepRequestOptions`, and when it is set, drop `consumes` entries with `consumerLocation === "body"` whose field path is absent from the effective body before calling `applyWorkflowSubstitutions`. Unedited steps keep today's path exactly. Pass the option from `makeStep` (`buildJourneys.ts`) and from `stepRequestFor` (`planStepRequest.ts`).
- [X] T039a [US3] Classify engineer-written references (research R4): add `"body-reference"` to `UserSuppliedValueSource` in `packages/shared-domain/src/performance.ts`, add `bodyReferenceNames` and `bodySecretReferenceNames` to `BuiltStepRequest` in `backend/src/performance/plan/stepRequest.ts` (computed from the edit only), and use them in `listUserSuppliedValues` in `backend/src/performance/plan/userSuppliedValues.ts`. Update every frontend label map keyed by the source (the compiler lists them).
- [X] T039 [US3] Compute `bodyEditNotices` in `assemblePlan` (`backend/src/performance/plan/buildPlan.ts`, helper in `bodyEdits.ts`):
  - `workflow-variable-dropped` for each body consumer T038 dropped;
  - `unique-field-dropped` for each unique candidate of the generated body that the effective body no longer has.

  Sort by `stepId`, then `name`, with `compareCodeUnits`.
- [X] T040 [US3] In `frontend/src/components/performance/StepBodyEditor.tsx`:
  - show "Values you type are written into the script. Reference secrets from the environment as `{{name}}`." at all times;
  - show a "Replaced at run time" list built from the preview's `body.references`, using the existing reference wording in `StepRequestPreview.tsx`'s `referenceText`, which moves to a shared helper in the same folder if both files need it.
- [X] T041 [US3] Show the step's `bodyEditNotices` in `OperationInspector` in `frontend/src/components/performance/JourneyList.tsx`, for example "This step no longer sends the value of `orderId` from step J1.1." and "This step no longer sends a unique value for `customerEmail`.". Count them in the pending bar's `notes` in `PerformancePlanScreen.tsx`, where they are informational and do not block anything.

**Checkpoint**: US1 to US3 work. References, secrets and data-only embedding are covered by tests.

---

## Phase 6: User Story 4 - Go back to the generated body (Priority: P2)

**Goal**: Reset one step or all edited steps with confirmation, and keep or discard edits correctly across removal, restore, plan reset, rebuild and quick replacement (FR-017, FR-018).

**Independent Test**: Quickstart 6 and 7.

### Tests for User Story 4

- [X] T042 [P] [US4] Add failing tests to `backend/tests/unit/performance/bodyEdits.test.ts` and `backend/tests/unit/performance/buildPlan.test.ts`:
  - a removed operation keeps its edit, and restoring brings back the same step id with the edit;
  - `buildRemovedOperationPreview` shows the edit with `step.bodyEdited: true`;
  - `POST /plan/reset` (`rebuildPlan` with `keepOrder: false`) keeps edits;
  - a guided rebuild whose approved scenario for the step changed discards the edit and lists the operation key in `discardedBodyEdits`;
  - the next `applyPlanUpdate` clears `discardedBodyEdits`;
  - `{[stepId]: null}` for every edited step resets them all in one update.
- [X] T043 [P] [US4] Extend `frontend/tests/unit/StepBodyEditor.test.tsx` and `frontend/tests/unit/PerformancePlanScreen.test.tsx`:
  - "Reset to generated body" opens `ConfirmDialog`, and confirming sends `{[stepId]: null}`;
  - "Reset all edited bodies" states the count and sends every edited step as `null` in one `PUT`;
  - Cancel sends nothing;
  - the discarded-edits note names the operations.
- [X] T044 [P] [US4] Extend `frontend/tests/unit/QuickPerformancePage.test.tsx`: the replace confirmation says the current plan and its body edits will be replaced.

### Implementation for User Story 4

- [X] T045 [US4] Complete the carry-over rule of research R9 in `backend/src/performance/plan/buildPlan.ts` (with helpers in `bodyEdits.ts`):
  - confirm `assemblePlan`'s keep rule from T006 (same step and scenario, or operation removed) with the T042 tests;
  - `rebuildPlan` carries `bodyEdits`, and records in `discardedBodyEdits` (code-unit sorted) each operation whose edit it had to drop;
  - `choicesOf` carries `discardedBodyEdits` so that only `applyPlanUpdate` (T025) and the next rebuild clear it.
- [X] T046 [US4] Add "Reset to generated body" to `frontend/src/components/performance/StepBodyEditor.tsx`. It is shown when `model.edited`, and confirmed through `ConfirmDialog` (`frontend/src/components/ConfirmDialog.tsx`) with `affectedCount={1}`. On confirm it calls `onReset`, which `PerformancePlanScreen.tsx` maps to `apply({bodyEdits: {[stepId]: null}}, "Body reset to the generated body.")`.
- [X] T047 [US4] Add "Reset all edited bodies" to `frontend/src/components/performance/JourneyList.tsx`, next to the "Body edited · N" chip and shown when N > 0. It uses `ConfirmDialog` with `affectedCount={N}` and the message "Every edited body goes back to the body generated from the specification.". A new `onResetBodies(stepIds)` prop, wired in `PerformancePlanScreen.tsx`, sends one `PUT`.
- [X] T048 [US4] Show `plan.discardedBodyEdits` in `frontend/src/components/performance/PerformancePlanScreen.tsx` as an informational note above the operations table, for example "Body edits were discarded for 2 operations whose scenario changed: …", listing the operations with `CountedOperationList`.
- [X] T049 [US4] Update the replace confirmation text in `frontend/src/pages/QuickPerformancePage.tsx` to say that the current plan, including its body edits, will be replaced (R9).
- [X] T050 [US4] In `RemovedDetails` in `frontend/src/components/performance/OtherOperationsTable.tsx`, show `<StatusBadge label="Body edited" />` next to the scenario when `state.preview.step.bodyEdited`, with the preview still read-only (no editor, FR-003). Add a case to `frontend/tests/unit/PerformancePlanScreen.test.tsx`: a removed operation with a kept edit shows the badge and the edited body, and offers no Save (quickstart 7.1, FR-018).

**Checkpoint**: All four stories work on both paths.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, contracts, the real-k6 check, the version, and the definition of done (constitution XXXI).

- [X] T051 [P] Add the opt-in edited-body case to `backend/tests/integration/performance.k6.real.test.ts` (quickstart 9). If the test target cannot yet observe request bodies, add request recording to it, then assert that the edited `POST /orders` body was received.
- [X] T052 [P] Update `docs/USER_MANUAL.md` §3.11:
  - rewrite "The request a step sends" (it is no longer view-only for the body);
  - add editing, the "Replaced at run time" list, references and `{{name}}`, the password-field rule, the literal-values warning (including the limit recorded in research R8), mismatch warnings, the "Body edited" marker and filter, and resetting one step or all;
  - add what happens on removal, restore, reset plan, a guided rebuild and a quick replacement;
  - add the report marker.

  Add a pointer from §5 (quick test) if needed.
- [X] T053 [P] Update `docs/architecture.md`, adding a "Step body edits (AP-033)" subsection under "k6 performance testing". It covers `bodyEdits` in the plan, `effectiveScenario` as the single application point, the fingerprint rule, the edited-step consumer guard, `planSnapshotForRun`, and the frontend `StepBodyEditor` under "Frontend architecture".
- [X] T054 [P] Add a change note pointing to `specs/033-edit-step-request-body/contracts/` in `specs/031-k6-performance-testing/contracts/performance-api.md` and `specs/032-quick-performance-test/contracts/quick-performance-api.md`, as AP-032 did for AP-029.
- [X] T055 [P] Update `specs/ROADMAP.md`:
  - add the AP-033 row (status, summary, version 19.10.0, a Next Actions reference);
  - add a Next Actions entry for the implementation and the constitution v2.5.0 amendment;
  - close or update Next Actions #35 (the CRLF golden-template failure, fixed by the root `.gitattributes`).
- [X] T056 Bump the version from 19.9.0 to 19.10.0 in the root `package.json`, `backend/package.json`, `frontend/package.json` and `packages/shared-domain/package.json`, and update `package-lock.json` through npm, for example `npm version 19.10.0 --workspaces --include-workspace-root --no-git-tag-version`. Confirm that no git tag or commit was created.
- [X] T057 Run `npm test`, `npm run lint` and `npm run build` at the repository root, and record the exact counts in `specs/033-edit-step-request-body/validation.md` (create it, following `specs/032-quick-performance-test/validation.md`). Never report a check as passing unless it was run.
- [X] T058 Review the full diff against research R5, R8, R11 and R14. Confirm:
  - no body text, parser message or value is logged;
  - no body content reaches `plan_snapshot`, run responses or the report;
  - no `pattern` is evaluated;
  - no inline styles, `any` or `eslint-disable` were added.

  Record the result in `validation.md`.
- [ ] T059 Hand quickstart scenarios 1 to 8 to the user as the manual browser walkthrough (constitution XXXI), including the SC-001 timing in scenario 2, and list them as outstanding in `validation.md` until the user reports them done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: none.
- **Foundational (T002 to T010)**: after Setup. It blocks every story.
  - T002 comes first.
  - T003, T009 and T010 can run in parallel after T002.
  - T004 comes before T005, then T006, T007 and T008.
- **US1 (T011 to T015)**: after Foundational.
- **US2 (T016 to T032)**: after Foundational. It uses US1's preview fields (T013) for the editor model, so start it after T013.
- **US3 (T033 to T041)**: after US2's T023 (the validation hooks) and T029 (the editor).
- **US4 (T042 to T050)**: after US2 T025 (`applyPlanUpdate`) and T029. It is independent of US3.
- **Polish (T051 to T059)**: after the stories to be shipped. T056 and T057 come last.

### Within each story

Write the tests first and see them fail. Then work in this order: backend domain (pure modules), routes and error mapping, then frontend components and wiring.

### Parallel opportunities

- Foundational: T003, T009 and T010 in parallel.
- US1: T011 and T012 in parallel, then T013 and T014 in parallel (backend and frontend).
- US2 tests: T016 to T022 are all in different files and can run in parallel. Implementation: backend T023 to T028 alongside frontend T029 to T032, once T023 has fixed the error codes.
- US3: T033 to T036 in parallel. T037 to T039 (backend) alongside T040 and T041 (frontend).
- US4: T042 to T044 in parallel. T045 alongside T046 to T050.
- Polish: T051 to T055 in parallel.

## Parallel Example: User Story 2

```bash
# Tests first, all in different files:
Task: "validateBodyEdits tests in backend/tests/unit/performance/bodyEdits.test.ts"            # T016
Task: "mismatch checker tests in backend/tests/unit/performance/bodySchemaMismatches.test.ts"   # T017
Task: "PUT /plan bodyEdits route tests in backend/tests/integration/performance/*Routes.test.ts" # T018
Task: "StepBodyEditor tests in frontend/tests/unit/StepBodyEditor.test.tsx"                     # T021

# Then backend and frontend implementation side by side:
Task: "bodySchemaMismatches in backend/src/performance/plan/bodySchemaMismatches.ts"            # T024
Task: "StepBodyEditor in frontend/src/components/performance/StepBodyEditor.tsx"                # T029
```

## Parallel Example: User Story 3

```bash
Task: "reserved-reference and password-literal tests in backend/tests/unit/performance/bodyEdits.test.ts" # T033
Task: "hostile-content render test in backend/tests/unit/performance/renderScript.test.ts"               # T034
Task: "editor statement and replaced-at-run-time tests in frontend/tests/unit/StepBodyEditor.test.tsx"   # T036
```

## Implementation Strategy

### MVP first

1. Setup and Foundational (T001 to T010): edits flow through the plan, the preview and the script, with the golden files unchanged.
2. US1 (T011 to T015): every step states its body. This fixes the "empty body" confusion on its own and can ship alone.
3. **Stop and validate** with quickstart 1.

### Incremental delivery

1. **US2 and US3 together** are the editing MVP. US3's secret and reference rules must ship with editing (spec US3, "ships with Story 2"), so do not release US2 without US3.
2. **US4:** reset and the carry-over rules.
3. **Polish:** docs, contract notes, roadmap, version 19.10.0 and validation.

## Notes

- `[P]` tasks touch different files and do not depend on incomplete tasks.
- Every task cites the research decision it implements. When a task and research disagree, stop and raise it rather than choosing silently (CLAUDE.md §63).
- Do not commit. Leave the changes for the user's review.
