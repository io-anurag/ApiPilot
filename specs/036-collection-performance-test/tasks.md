---

description: "Task list for AP-036 Performance Test from a Postman Collection"
---

# Tasks: Performance Test from a Postman Collection (AP-036)

**Input**: Design documents from `specs/036-collection-performance-test/`

**Prerequisites**:
- [plan.md](./plan.md)
- [spec.md](./spec.md) (FR-001 to FR-029, SC-001 to SC-006, Clarifications 2026-10-02)
- [research.md](./research.md) (R1 to R22)
- [data-model.md](./data-model.md)
- [contracts/collection-performance-api.md](./contracts/collection-performance-api.md)
- [contracts/changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md)
- [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution XXI and XXXI make automated tests part of done, and research R21
defines the test plan. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md US1 to US4), so each story can be built
and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependency on an incomplete task).
- **[Story]**: the user story the task belongs to (US1 to US4).
- Paths are relative to the repository root. Workspaces are `backend/`, `frontend/` and
  `packages/shared-domain/`.

## Standing rules for every task

- **Governance gate.** Constitution v2.7.0 (commit 173cb1b on `AP-036`) extends XVII's 2026-09-24
  exception to collection plans. Implementation MUST NOT start until that amendment is merged (plan
  Constitution Check). T001 records this.
- **Commits.** Do not commit. The user reviews the diff and commits it.
- **Scope.**
  - No AI anywhere in this feature (FR-026).
  - No new dependency, environment variable, configuration or SQLite table. `postman-collection`
    4.5.0 and `acorn` 8 are already backend dependencies. Newman is never invoked.
  - The guided and quick paths keep their HTTP behaviour and plan fingerprints (plan Constraints).
- **Scripts are read, never run (FR-005).** No collection script is executed, evaluated or passed
  to `postman-sandbox`. Building a plan sends no request. Recognition matches acorn AST nodes against
  research R5's closed grammar only.
- **Data, never code (FR-023).**
  - Collection content (URLs, headers, bodies, field paths, header names, capture names) reaches the
    script only inside the JSON data constants.
  - The `RUNTIME` text in `backend/src/performance/k6/renderScript.ts` must be identical for every
    plan.
- **No values anywhere (FR-015, FR-024, XVIII).** No variable value, captured value or literal from
  an auth field or credential header may enter the plan, script, environment template, run
  snapshot, report, UI response or logs. The only reader of values is R17's server-side copy.
- **Never log** scripts, excerpts, collection names, request names, URLs, variable names or values.
  Logs carry ids, counts and reason codes (contract Logging).
- **Ordering.** Never use `localeCompare`; use `compareCodeUnits` from
  `backend/src/postman/ordering.ts`. The same collection, selection, order and choices give a
  byte-identical script (FR-023, R19).
- **Nothing guessed (XIV).** No expected status is pre-filled from a method or request (FR-012). No
  relationship between requests is inferred beyond the collection's own setters and references
  (XV). Classification of credential requests uses only where captured values are used (R8).
- **Refusals** never quote a value, and leave the plan unchanged (validate everything before
  applying anything).
- **Labels.** Never present collection content as specification content. Statuses read "from the
  collection's test" or "set by you"; typed capture paths read "Not documented in a specification"
  (constitution I, R15).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The governance check, fixtures and the stub target used by tests and the quickstart.

- [X] T001 Confirm that constitution v2.7.0 (`.specify/memory/constitution.md` and
  `specs/constitution.md`, identical) is merged to `main`, and record the merge commit in
  `specs/036-collection-performance-test/validation.md` (new file, heading "Governance"). If it is
  not merged, stop and report; do not start T002 onward.
- [X] T002 [P] Add `backend/tests/fixtures/collections/apifoundry.postman_collection.json` (Postman
  v2.1, stable item ids) mirroring spec User Story 1 and quickstart Prerequisites:
  - collection-level bearer auth `{{access_token}}`;
  - folder `Auth`: `POST {{baseUrl}}/auth/token` with `noauth`, a JSON body using `{{client_id}}`
    and `{{client_secret}}`, and the test
    `pm.test("ok", () => pm.response.to.have.status(200)); pm.environment.set("access_token", pm.response.json().access_token);`;
  - folder `Customers`: `GET {{baseUrl}}/api/v1/customers` (200); `POST {{baseUrl}}/api/v1/customers`
    with body `{ "name": "{{$randomFullName}}", "email": "{{$randomEmail}}" }` and the test
    `const body = pm.response.json(); pm.collectionVariables.set("customer_id", body.id); pm.test("created", () => pm.response.to.have.status(201));`;
    `GET`, `PATCH` and `DELETE {{baseUrl}}/api/v1/customers/{{customer_id}}` (200, 200, 204);
  - root: `GET {{baseUrl}}/health` and `GET {{baseUrl}}/version` (200), each with a `pm.test` status
    assertion.

  Add `backend/tests/fixtures/collections/apifoundry.postman_environment.json` with `baseUrl`,
  `client_id` and `client_secret` (placeholder values only, never real credentials).
- [X] T003 [P] Add `backend/tests/fixtures/collections/collectionBuilders.ts`: small pure builders for
  inline Postman collections used by unit tests (`collectionOf(items, {auth, event, variable})`,
  `requestItem(id, name, {method, url, header, body, auth, event})`, `folderItem(id, name, items,
  {auth, event})`, `testScript(lines)`, `prerequestScript(lines)`). Ids are explicit strings, never
  random. Add `apifoundryCollection({ dynamicBody })`, which loads T002's fixture and, when
  `dynamicBody` is `false`, replaces the customer `POST` body with the literal
  `{ "name": "Ada Lovelace", "email": "ada@example.com" }`. User Story 1 tests use
  `dynamicBody: false`, because supported dynamic variables arrive only in User Story 2.
- [X] T004 [P] Extend `backend/tests/fixtures/execution/customersTarget.ts` (and keep every existing
  option and count unchanged) with an opt-in `{ auth: { expiresIn?: number; tokenStatus?: number } }`
  option:
  - `POST /auth/token` issues a counter-based bearer token (never random), with `expires_in` when
    `expiresIn` is set, or answers `tokenStatus` when set;
  - every `/api/v1/customers` request without a currently valid issued token answers 401;
  - `PATCH /api/v1/customers/{id}` is handled like `PUT` (counted as `patches`);
  - with `rejectRepeatedEmail: true`, a `POST` repeating an earlier email answers 409 (counted as
    `conflicts`); every received body is recorded for uniqueness checks;
  - `GET /health` and `GET /version` answer 200.

  Wire it into `backend/scripts/perfStubTarget.ts` as `PERF_STUB_MODE=customers-auth`, with
  `PERF_STUB_EXPIRES_IN`, `PERF_STUB_TOKEN_STATUS` and `PERF_STUB_REJECT_REPEATED_EMAIL`, and print
  the new counts on exit.
- [X] T005 [P] Add `backend/tests/fixtures/performance/collectionPlans.ts`: helpers that store a
  collection (and optional environment) for the current test session through the existing
  `uploadedCollectionStore`, and build a collection plan from it, for unit and integration tests.

**Checkpoint**: Fixtures load; `npm test` is unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, the `PlanEngine` seam (R2), the one runtime change for every plan (R10),
the run tag, errors and persistence. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for the foundation (write first, confirm they fail)

- [X] T006 [P] Write `backend/tests/unit/performance/openApiEngine.test.ts` (R2): for the guided and
  quick fixture contexts, each of the six `PlanEngine` operations returns exactly what the wrapped
  function returns today (`applyPlanUpdate`, `rebuildPlan`, `buildStepRequestPreview`,
  `buildRemovedOperationPreview`, the documented-field listing, `scriptInputsFromContext`).
- [X] T007 [P] Extend `backend/tests/unit/performance/renderScript.test.ts` (R2, R9, R10), using
  `k6Sandbox`:
  - `renderScript(plan, context)` equals `renderScriptFrom(plan, scriptInputsFromContext(plan,
    context))` byte for byte;
  - **Token sources:** an AP-029 source renders one capture from `responseField` and no `expected`,
    and behaves as before; a source with `expected` and two captures fails on an unexpected status,
    fails a non-scalar capture, and on failure counts `apipilot_token_refresh{outcome:"setup-failed",
    scheme, capture}` and leaves its token variables empty;
  - **`tokenSchemes`:** a step using two token sources refreshes each through `maybeRefresh`;
  - **Form body:** `bodyKind: "form"` fills references with `encodeURIComponent`;
  - **Dynamic values (R9 table):** for each supported kind, the format matches (UUID v4 with variant
    bits, `@example.com` email, `NNN-NNN-NNNN`, `[0-9a-z]`, `"true"|"false"`, 0 to 1000); values are
    reproducible for the same VU, iteration, `k` and tag; `$guid`, `$randomUUID`, `$randomUserName`
    and `$randomEmail` are unique over 10 VUs × 10 iterations × 4 occurrences, and differ between two
    tags; an `APIPILOT_RUN_TAG` not matching `^[0-9a-f]{6}$` is treated as no tag;
  - **Runtime text:** byte-identical across a guided plan, a user-journey plan and a plan with
    `DYNAMIC` entries; `DYNAMIC` renders as `{}` when unused;
  - **AP-034:** every golden still passes `checkUserScript`, and `APIPILOT_RUN_TAG` appears in its
    `envNames`.
- [X] T008 [P] Extend `backend/tests/unit/performance/buildPlan.test.ts` (R19): a plan without
  `collection` keeps its fingerprint; a plan with `collection` fingerprints it without `review` and
  `collectionState`. Extend the snapshot test so `planSnapshotForRun` empties every
  `collection.findings[].excerpt` and keeps owner, line and kind (R16).
- [X] T009 [P] Extend `backend/tests/unit/performance/aggregate.test.ts`: `setup-failed` samples of
  `apipilot_token_refresh` fill `TokenRefreshResult.setupFailed` with `{scheme, capture}`, sorted
  with `compareCodeUnits`.
- [X] T010 [P] Extend `backend/tests/unit/persistence/` run-repository tests: `plan_source =
  'collection'` maps to `"collection"`, unknown values still map to `"guided"`, and listing by source
  returns only that source's runs.

### Implementation for the foundation

- [X] T011 Add the shared types of data-model.md to `packages/shared-domain/src/performance.ts` and
  export them from `packages/shared-domain/src/index.ts`. Every change is additive:
  - **New types:** `CollectionPlanInfo`, `CollectionRequestRef`, `LeftOutRequest`, `LeftOutReason`,
    `CredentialRequestView`, `ConversionFinding`, `FindingKind` (every value in data-model), and
    `CaptureOrigin`;
  - **Union members:** `PerformancePlanSourceKind` `+ "collection"`; `PerformanceJourney.source`
    `+ {kind:"collection"; collectionId; collectionName}`; `StepAuthKind` `+ "collection-auth"`;
    `ExpectedStatus.source` `+ "collection"`; `BindingTarget` `+ {kind:"reference"; name;
    locations}`; `UserSuppliedValueSource` `+ "collection-variable" | "collection-literal"`;
    `PreviewReference` `+ {kind:"generated-value"; name; variable}`; `scenarioChoice`
    `+ "collection-request"`; `PerformanceRun.planSource` and `PerformanceRunSummary.planSource`
    `+ "collection"`;
  - **Optional fields:** `PerformancePlan.collection?`, `PerformanceStep.collectionRequest?`,
    `Capture.origin?`, `TokenRefreshResult.setupFailed`.

  Fix every exhaustive `switch` the new members break, in backend and frontend, without changing
  existing behaviour.
- [X] T012 Split `backend/src/performance/k6/renderScript.ts` (R2): extract
  `scriptInputsFromContext(plan, context): ScriptInputs` and `renderScriptFrom(plan, inputs):
  RenderedScript`, with `ScriptInputs` as in data-model.md. `renderScript` stays their composition,
  with the same signature and output. Existing tests pass unchanged before T014.
- [X] T013 Add `backend/src/performance/plan/openApiEngine.ts` with the `PlanEngine` interface of
  research R2 and `openApiEngine(context)`. Replace `PlanHandle.context` with `PlanHandle.engine` in
  `backend/src/api/performanceRoutes.ts`, moving the six call sites (`PUT /plan`, `POST /plan/reset`,
  step preview, removed-operation preview, response fields, `POST /script`) to the engine;
  `responseFields` returning `null` answers `404 not_applicable`. `PerformancePlanSource.kind`
  accepts `"collection"`. Pass `openApiEngine(context)` from `backend/src/api/performanceTesting.ts`
  and `backend/src/api/quickPerformance.ts`. All existing route tests pass unchanged. Make T006 pass.
- [X] T014 Change the fixed `RUNTIME` in `backend/src/performance/k6/renderScript.ts` once, additively
  (R9, R10). This depends on T012.
  - a `DYNAMIC` data constant, and `resolve` calling `dynamicValue(kind, k)` for `apipilot_dyn_<k>`
    tokens after captures and tokens and before unique values; word lists (24 first names, 24 last
    names) and the fixed 32-bit `mix(VU, ITER, k)` hash written into the runtime; `APIPILOT_RUN_TAG`
    read once and validated;
  - token sources with `captures: [{key, source}]` and optional `expected`; `acquire` checks
    `expected` when present and takes each capture with AP-035's scalar rule; AP-029 sources render
    one capture built from `responseField`, with no `expected`;
  - `tokenScheme` replaced by `tokenSchemes: string[]` on rendered steps;
  - `bodyKind: "form"`;
  - the `setup-failed` outcome on `apipilot_token_refresh`, tagged `scheme` and `capture`.

  Regenerate `backend/tests/fixtures/performance/golden/script.js` and
  `backend/tests/fixtures/performance/golden/user-journeys-script.js` once, and list their diff in
  the review summary (it must hold only these changes). Make T007 pass.
- [X] T015 [P] Set `APIPILOT_RUN_TAG` (first 6 hex characters of SHA-256 of the run id) in
  `valueEnvironment`'s output in `backend/src/performance/runPerformanceTest.ts` for every run, and
  extend its unit test (R9; contract changes "AP-029 run start"). The tag is never stored.
- [X] T016 [P] Include `collection` (minus `review` and `collectionState`) in `planFingerprint` and
  `finalizePlan` in `backend/src/performance/plan/buildPlan.ts` only when present, and empty
  findings' `excerpt` in `backend/src/performance/plan/runSnapshot.ts`. Make T008 pass.
- [X] T017 [P] Read `apipilot_token_refresh{outcome:"setup-failed"}` into
  `TokenRefreshResult.setupFailed` in `backend/src/performance/report/aggregate.ts`; keep
  `KNOWN_METRICS` in `backend/src/performance/k6/metricsStream.ts` accepting the outcome. Make T009
  pass.
- [X] T018 [P] Map `plan_source = 'collection'` in `toSummary` in
  `backend/src/persistence/performanceRunRepository.ts`. No schema change. Make T010 pass.
- [X] T019 [P] Add the error classes of contracts/collection-performance-api.md to
  `backend/src/performance/errors.ts` and map them in `backend/src/api/performanceHttp.ts`:
  `collection_plan_not_found` (404), `collection_plan_exists` (409), `too_many_requests` (422, count
  in the message), `collection_plan_out_of_date` (409, with `state`), `conversion_not_reviewed`
  (409), `collection_deleted` (409), `not_supported_for_collection_plan` (400, naming the field),
  `base_url_missing` (422), `not_applicable` (404). Reuse AP-026's `uploaded_collection_not_found`,
  `invalid_run_order`, `no_requests_selected` and the environments' `duplicate_environment_name`. No
  message quotes a value. Extend the mapping test.
- [X] T020 [P] Add `frontend/src/services/collectionPerformanceClient.ts` (contract changes
  "Frontend"): `createPerformanceClient("/api/collection-performance")` plus `buildCollectionTest
  (collectionId, orderedRequestIds, replaceExisting)`, `fetchCollectionTest()`,
  `rebuildCollectionTest()` and `createEnvironmentFromCollection(name)`. Extend `PlanUpdate` in
  `frontend/src/services/performanceTestingClient.ts` with `excludedRequestIds`, `addedCaptures`,
  `addedBindings` and `conversionReviewed`, and the new error extras (`state`, `field`, `count`).
  Test it in `frontend/tests/unit/collectionPerformanceClient.test.ts`.

**Checkpoint**: Foundation ready. `npm test` passes, with only the two goldens changed (T014).

---

## Phase 3: User Story 1 - Load-test a collection flow without defining its steps again (Priority: P1) 🎯 MVP

**Goal**: From a stored collection's run panel, build a plan whose steps are the selected requests,
with captures, bindings and expected statuses converted from test scripts, credential requests run
once before the load, a review gate, out-of-date tracking, a generated script, a run and a report.

**Independent Test**: Quickstart scenarios 1 to 4 and 7. Against the `customers-auth` stub, build the
plan from `apifoundryCollection({ dynamicBody: false })`, review it, generate the script and run 2
virtual users: no step needed `access_token` or `customer_id` from the environment, no 401 or 404
was received, and the token request was sent once before the load (SC-001, SC-002). Until User
Story 2, a request using any `{{$…}}` is left out with its variable named, so the full fixture's
customer `POST` is left out.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T021 [P] [US1] Write `backend/tests/unit/performance/collection/readCollectionRequests.test.ts`
  (R3, R4, R11): identity (item id, name, folder path, folder ids); upper-cased method; URL with
  `{{name}}` kept and disabled query parameters dropped; `:name` path segments filled from
  `url.variable`; enabled headers only; body modes (`raw` json by header or language, `raw` text,
  `urlencoded` as `form` with enabled pairs, `none`); auth inherited request → folder → collection
  with its owner; scripts in Postman order (collection, folders outward-in, request) with owners;
  left-out reasons `unsupported-auth` (each listed type, with detail), `unsupported-body`
  (`formdata`, `file`, `graphql`), `reserved-name` (`{{apipilot_x}}`), and, with no supported
  dynamic variables yet, `unsupported-dynamic-variable` for a known `{{$name}}` and
  `unknown-dynamic-variable` for any other, each naming the variable.
- [X] T022 [P] [US1] Write `backend/tests/unit/performance/collection/recognizeScript.test.ts` (R5,
  FR-006, FR-007, FR-010):
  - **Setters:** every `SCOPE.set`, `postman.setEnvironmentVariable`, `postman.setGlobalVariable`;
    values from `pm.response.json()`, `JSON.parse(responseBody)` and an alias (`const`, `let`,
    `var`), with `.ident`, `["str"]` and `[0]` segments; headers via `pm.response.headers.get("X")`
    and `postman.getResponseHeader("X")`, lowercased; result segments are `BodyPathSegment[]`;
  - **Placement:** top level and directly inside `pm.test` callbacks (function and expression-bodied
    arrow); a setter inside `if`, `for`, a function or `try` gives `condition`, `loop`, `function`,
    `try`;
  - **Findings:** `computed-name`, `computed-value` (including a whole-body value with no path),
    `send-request`, `set-next-request` (both forms), `skip-request`, `iteration-data`
    (`pm.iterationData`, `data.`), `unset` (`.unset(`, `.clear(`), `assertion-not-converted`,
    `no-effect` (`console.*`), `unsupported-statement`, `unreadable-script` (line and column, nothing
    converted), an alias reassigned anywhere in the script is not an alias;
  - **Excerpts:** at most 160 characters;
  - **Determinism:** the same text gives the same captures, assertions and findings in source order;
    top-level `return` parses.
- [X] T023 [P] [US1] Write `backend/tests/unit/performance/collection/statusAssertions.test.ts` (R7):
  every row of the R7 table (`status(n)`, `ok`, each named code, each class as `NXX`, `pm.expect(
  pm.response.code)` with `eql|equal|equals|eq` and through `.to.be.`, `oneOf`); `.not.` forms and
  `status("OK")` give no codes and an `assertion-not-converted` finding; intersection across
  assertions (exact within class, two exact codes, disjoint sets give empty plus
  `contradictory-assertions`); no assertion gives an empty set; source is `"collection"`.
- [X] T024 [P] [US1] Write `backend/tests/unit/performance/collection/bindCollectionPlan.test.ts`
  (R6, FR-008): a folder or collection test yields the capture on every inheriting step; the later
  setter of the same name wins and the earlier gives `superseded-setter`; references in URL,
  headers, body and auth bind to the latest earlier capture and are rewritten through `captureKeyOf`;
  `{{$…}}` is skipped; a reference before any capture stays an environment value; re-binding after a
  reorder and after removing the capturing step; one `scope-precedence` note per
  `collectionVariables` or `globals` capture; `dependsOn` refuses a move that places a binding
  before its capture with `dependency_order_violation`.
- [X] T025 [P] [US1] Write `backend/tests/unit/performance/collection/credentialRequests.test.ts` (R8,
  FR-027): a token step whose capture is used only in later bearer auth is a credential request; one
  whose captures also feed a path is a journey step; a capture never bound does not qualify; an
  `Authorization` header use qualifies; a credential request consuming another one's capture is
  ordered after it; consumers' references become `apipilot_t_<step>_<key>`; consumers get
  `chained-login` with `schemeName` set to the source's step id; credential requests are absent from
  `summarizeWriteOperations`.
- [X] T026 [P] [US1] Write `backend/tests/unit/performance/collection/collectionValues.test.ts` (R11,
  R12, FR-014 to FR-016): base-URL variable by majority leading `{{name}}` with a code-unit tie-break,
  rewritten to `{{baseUrl}}`; `other-host-variable` for other leading variables; literal hosts listed
  sorted; unbound references become `collection-variable` requirements; secret when used in an auth
  field or credential header (each listed header name and each substring rule, case-insensitive, with
  a `credential-header` note naming the substring); literals in auth fields and credential headers
  become `{{apipilot_literal_<owner>_<field>}}` `collection-literal` secrets and never appear in the
  output; a form body renders `key=value&...` with literals encoded and `Content-Type` added when
  absent; one `url-encoding` note lists names referenced in URL paths after the host.
- [X] T027 [P] [US1] Write `backend/tests/unit/performance/collection/assembleCollectionPlan.test.ts`
  (R13 to R15, R19): ids are `j_`/`s_` + `shortDigest` of collection id / item id and survive
  rebuild, reorder and removal; step fields per the R15 table; `excludedOperationKeys` and `omitted`
  empty; findings ordered step, owner, line; `conversionDigest` changes when bindings change and not
  when settings change, and a change resets `reviewed`; `collectionState` derives `current`,
  `changed` and `deleted` from the digest and the stored row; a plan whose requests are all left out
  has no steps; building twice gives an identical plan; a 100-request collection builds in under 5
  seconds (SC-005).
- [X] T028 [P] [US1] Write `backend/tests/unit/performance/collection/collectionScript.test.ts`
  (FR-023, SC-004): render the plan of `apifoundryCollection({ dynamicBody: false })` and compare
  with a new golden
  `backend/tests/fixtures/performance/golden/collection-script.js`; byte-identity over ten builds and
  renders; `checkUserScript` accepts it; every request is named after its step; a seeded-literal scan
  (a unique token placed in an auth field, a credential header and an environment value) finds it in
  neither the script, the environment template, the plan, the run snapshot nor captured logs.
- [X] T029 [P] [US1] Write `backend/tests/integration/performance/collectionPerformanceRoutes.test.ts`
  (Supertest, contract):
  - **Build:** 200 with the view; `invalid_request`; `invalid_run_order` and `no_requests_selected`;
    `uploaded_collection_not_found` including another session's id; 101 ids gives
    `422 too_many_requests` naming 101; `409 collection_plan_exists`, then replace with
    `replaceExisting: true`; no request reaches a `TargetServer` during build (FR-005); AP-026's
    first-run confirmation is not required (FR-018);
  - **Read:** every route except build answers `404 collection_plan_not_found` without a plan;
  - **Gates:** `POST /script` refuses `conversion_not_reviewed`, then `expected_status_missing`
    naming a credential request, then succeeds after `PUT /plan {conversionReviewed: true}` and
    statuses; editing the collection in the editor gives `collection_plan_out_of_date` with
    `state: "changed"` on `/script` and `/runs`, while `PUT /plan` still works; a functional run's
    value save-back does not; deleting the collection gives `state: "deleted"` and rebuild answers
    `409 collection_deleted`;
  - **Rebuild:** keeps load profile, thresholds, think time, removed ids and the engineer's expected
    statuses for surviving items, reports `notKept` and `droppedRequestIds`, and resets the review;
  - **`PUT /plan`:** refuses each field listed in the contract with
    `400 not_supported_for_collection_plan` naming it; `POST /plan/reset` keeps added captures and
    resets the review;
  - **Previews:** step and credential-request previews use `collection-auth`, show references and
    never show a secret; `GET /plan/response-fields` answers `404 not_applicable`;
  - **Runs:** with the fake runner, a run records `planSource: "collection"`, `GET /runs` lists only
    collection runs, the snapshot has no excerpts, and the one-run slot is shared with the quick
    plan.
- [X] T030 [P] [US1] Extend `backend/tests/unit/performance/report.test.ts` (R16, FR-024): for a
  collection plan the HTML report states the provenance sentence, labels steps `<folder path> /
  <request name>`, shows binding origins (capture, step, script line or "set by you"), counts each
  capture's successes and failures, shows the credential-request section (setups, refreshes ok and
  failed, setup failures naming request and capture) and the "from the collection's test" label, and
  contains no captured value, environment value, request or response content.
- [X] T031 [P] [US1] Write frontend tests:
  - extend `frontend/tests/unit/ExternalCollectionRunPanel.test.tsx`: **Set up a performance test**
    sits beside **Start run**, is disabled with no request selected, and passes the ordered selected
    ids;
  - write `frontend/tests/unit/CollectionPerformancePage.test.tsx`: loading, empty, error and loaded
    states; replacing an existing plan asks first; the collection header shows name and state; a
    `changed` plan shows **Rebuild** and disables **Generate script** and the run trigger; a
    `deleted` plan explains it cannot be rebuilt;
  - write `frontend/tests/unit/ConversionReview.test.tsx`: the "not generated or verified by
    ApiPilot" statement, findings with owner, event, line and reason, left-out requests, notes, and
    **Mark as reviewed**; the pending bar shows **Review the conversion** until reviewed;
  - write `frontend/tests/unit/CredentialRequestList.test.tsx`: "Run once before the load", the
    values provided and the steps using them, and the expected-status control;
  - extend `frontend/tests/unit/App.test.tsx`: the fifth tab "Collection Performance Test" appears
    when opened from a collection.

### Implementation for User Story 1

- [X] T032 [P] [US1] Implement `backend/src/performance/collection/readCollectionRequests.ts` (R3, R4,
  R11) with `parseStoredCollection` and the SDK (`forEachItem`, `getAuth`, `headers.all()`,
  `url.toString()`). Pure; returns `CollectionRequestSource | {leftOut, detail}` per ordered id. Make
  T021 pass.
- [X] T033 [P] [US1] Implement `backend/src/performance/collection/statusAssertions.ts` (R7): AST
  matchers for the table, and `intersectStatuses`. Make T023 pass.
- [X] T034 [US1] Implement `backend/src/performance/collection/recognizeScript.ts` (R5) with acorn
  (`ecmaVersion: "latest"`, `sourceType: "script"`, `allowReturnOutsideFunction: true`,
  `locations: true`), the closed grammar, alias tracking over every `AssignmentExpression` and
  `UpdateExpression`, status assertions via T033, and the finding codes. It never evaluates a node.
  Depends on T033. Make T022 pass.
- [X] T035 [P] [US1] Implement `backend/src/performance/collection/collectionValues.ts` (R11, R12):
  base URL, hosts, requirements, secrets, credential-header rule and notes, literal replacement
  names, form-body rendering and the `url-encoding` note. Make T026 pass.
- [X] T036 [US1] Implement `backend/src/performance/collection/bindCollectionPlan.ts` (R6): captures
  with `CaptureOrigin`, superseded setters, references, bindings with target `reference`, rewriting
  through `captureKeyOf`, scope notes and `dependsOn`. Depends on T034. Make T024 pass.
- [X] T037 [US1] Implement `backend/src/performance/collection/credentialRequests.ts` (R8):
  classification, ordering, `RenderedTokenSource` inputs with captures and `expected`, consumer
  rewriting to token variables, `chained-login` auth, `CredentialRequestView`. Depends on T036. Make
  T025 pass.
- [X] T038 [US1] Implement `backend/src/performance/collection/assembleCollectionPlan.ts` (R13 to
  R15, R19): `CollectionPlanChoices` → `PerformancePlan` with `collection` set, ids from
  `backend/src/performance/plan/identifiers.ts` (add `collectionJourneyIdFor` and
  `collectionStepIdFor`), `conversionDigest`, review reset, `collectionDigest`
  (`sha256Hex` of the stored JSON), and `finalizePlan`. `ScriptInputs.dynamic` is empty until T054.
  Depends on T032, T035, T037. Make T027 pass.
- [X] T039 [US1] Implement `backend/src/performance/collection/collectionPlanStore.ts` (R1): one
  `CollectionPerformanceTest` per session, cleared on `onExpire`, with `getCollectionTest`,
  `hasCollectionPlan`, `setCollectionTest` and `updateCollectionTest`, modelled on
  `backend/src/performance/quick/quickTestStore.ts`.
- [X] T040 [US1] Implement `backend/src/performance/collection/collectionEngine.ts` (R2): the six
  `PlanEngine` operations for a collection plan. `applyUpdate` accepts `excludedRequestIds`,
  `stepOrder`, `expectedStatuses` (step or credential-request ids), `thinkTimeMs`, `loadProfile`,
  `thresholds` and `conversionReviewed: true` (only when it matches the current digest), and refuses
  the contract's listed fields with `not_supported_for_collection_plan`; `reset` rebuilds from
  `orderedRequestIds` with default settings, keeping added captures and bindings; previews per the
  contract; `removedPreview` keyed by item id; `responseFields` returns `null`; `scriptInputs` throws
  `conversion_not_reviewed`, `collection_plan_out_of_date` or `expected_status_missing`. Depends on
  T038, T039.
- [X] T041 [US1] Add `backend/src/api/collectionPerformance.ts` (R1, R13, R18) with `POST`, `GET` and
  `POST /rebuild`, input validated at the route, `resolveRunOrder` from
  `backend/src/externalCollections/runOrder.ts`, the 100-id limit, replace confirmation, state
  recomputed on every handle acquisition, and the rebuild's kept settings, `notKept` and
  `droppedRequestIds`. Register the shared routes with `registerPerformanceRoutes(router,
  "/collection-performance", collectionSource, deps)`, with `POST /runs` also refusing
  `collection_plan_out_of_date`. Log only `collectionPlanSteps`, `leftOutCount`, `findingCount` and
  `credentialRequestCount`. Mount it in `backend/src/app.ts`. Depends on T040. Make T029 and T028
  pass (add the golden `collection-script.js` here, reviewed by hand).
- [X] T042 [US1] Extend `backend/src/performance/report/renderHtmlReport.ts` (R16): the provenance
  statement, collection step labels, binding and capture origins, the credential-request section and
  the status label. Make T030 pass.
- [X] T043 [P] [US1] Make `frontend/src/components/performance/performanceViewModel.ts` and its label
  call sites source-aware: "from the collection's test", "set by you", "Not documented in a
  specification", step labels `<folder path> / <request name>`.
- [X] T044 [P] [US1] Add `frontend/src/components/performance/collection/CollectionStepSource.tsx`:
  folder path, request name, captures with origin ("test script, line n" and owner), references and
  their bindings, as semantic lists with text states.
- [X] T045 [P] [US1] Add `frontend/src/components/performance/collection/CredentialRequestList.tsx`:
  "Run once before the load", method and path, values provided, steps that use them, expected-status
  control reusing the existing status editor, and removal.
- [X] T046 [P] [US1] Add `frontend/src/components/performance/collection/ConversionReview.tsx`: the
  statement (requests and scripts not generated or verified by ApiPilot; literals other than secrets
  are written into the script; captures are attempted only on an expected status), findings, left-out
  requests, pre-request scripts, notes, and **Mark as reviewed** sending `conversionReviewed: true`.
- [X] T047 [US1] Extend `frontend/src/components/performance/PerformancePlanScreen.tsx` for
  `plan.source === "collection"`: credential list above the journey, `CollectionStepSource` in the
  step inspector, Removed and Left out views through `OtherOperationsTable` keyed by item id,
  `PendingBar` items for the review and the out-of-date state, hosts and write requests at the run
  trigger (FR-021); hide AP-033's editors and AP-035's journey composer, and point to the collection
  editor instead (FR-020). Depends on T043 to T046.
- [X] T048 [US1] Add `frontend/src/pages/CollectionPerformancePage.tsx` (R20): composes
  `PerformancePlanScreen` with the collection client, adds the collection header (name, tier, state,
  **Rebuild** with the `notKept` list), the empty state, and the replace confirmation through the
  existing `ConfirmDialog`. Depends on T047.
- [X] T049 [US1] Wire the entry point: **Set up a performance test** in
  `frontend/src/components/ExternalCollectionRunPanel.tsx` (enabled with at least one selected
  request, passing the ordered selected ids); forward `onSetUpPerformanceTest(collectionId,
  orderedRequestIds)` through `frontend/src/pages/ExternalCollectionsPage.tsx`; add the fifth lazy
  tab `collection-performance` ("Collection Performance Test") in `frontend/src/App.tsx`, mounted
  when first opened. Depends on T048. Make T031 pass.

**Checkpoint**: User Story 1 is complete and testable on its own (quickstart 1 to 4 and 7).

---

## Phase 4: User Story 2 - Generated values from Postman's dynamic variables (Priority: P2)

**Goal**: Supported `{{$…}}` variables are generated at run time, unique per virtual user, iteration,
occurrence and run; unsupported ones leave their request out with the variable named.

**Independent Test**: Quickstart scenario 5. A plan from a collection whose POST body uses
`{{$randomFullName}}`, `{{$randomEmail}}` and `{{$guid}}` shows them as "generated at run time",
generates byte-identical scripts twice, and a 3-VU smoke run against the 409-on-repeat stub receives
no 409.

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [X] T050 [P] [US2] Write `backend/tests/unit/performance/collection/dynamicValues.test.ts` (R9, R4,
  FR-013): the supported list equals the 13 names of FR-013; occurrences are rewritten to
  `{{apipilot_dyn_<k>}}` with `k` assigned in plan order, credential requests first, then URL,
  headers, body and auth; a variable used twice gets two tokens; the `DYNAMIC` table maps each token
  to its kind; a known but unsupported Postman variable gives `unsupported-dynamic-variable` and an
  unknown one `unknown-dynamic-variable`, each naming the variable; dynamic names are never
  requirements; `generatedValueCount` is the occurrence count; the plan and script are byte-identical
  across builds. Add a second golden,
  `backend/tests/fixtures/performance/golden/collection-dynamic-script.js`, rendered from
  `apifoundryCollection({ dynamicBody: true })`, and check it passes `checkUserScript`.
- [X] T051 [P] [US2] Extend `backend/tests/integration/performance/collectionPerformanceRoutes.test.ts`:
  the step preview of the fixture POST shows `name` and `email` as `generated-value` references, and
  neither is listed under environment values; rebuilding after adding `{{$randomColor}}` in the
  collection editor lists the request under Left out.
- [X] T052 [P] [US2] Extend `frontend/tests/unit/StepRequestPreview.test.tsx`: a `generated-value`
  reference reads "generated at run time" with its `$name`, and a left-out reason reads "uses
  {{$name}}, which ApiPilot cannot generate".

### Implementation for User Story 2

- [X] T053 [US2] Implement `backend/src/performance/collection/dynamicValues.ts` (R9): the supported
  list, rewriting, the `DYNAMIC` inputs for `ScriptInputs.dynamic`, and left-out classification
  using `isPostmanDynamicVariable` from
  `backend/src/externalCollections/uploadedCollectionParsing.ts`. Make T050 pass.
- [X] T054 [US2] Wire T053 into `backend/src/performance/collection/assembleCollectionPlan.ts` and
  `backend/src/performance/collection/readCollectionRequests.ts` (left-out reasons) and into the
  engine's `scriptInputs` and previews in `backend/src/performance/collection/collectionEngine.ts`.
  `golden/collection-script.js` (no dynamic variables) must not change. Create
  `golden/collection-dynamic-script.js` and review it by hand. Make T050 and T051 pass.
- [X] T055 [P] [US2] Render `generated-value` references and the dynamic-variable left-out reasons in
  `frontend/src/components/performance/PreviewReferenceNote.tsx` and
  `frontend/src/components/performance/StepRequestPreview.tsx`. Make T052 pass.

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - See and fix what was not converted (Priority: P3)

**Goal**: The review is complete and navigable at scale, left-out requests are searchable with
reasons, and the engineer can add captures and bindings by hand (FR-019).

**Independent Test**: Quickstart scenario 6. With a `pm.sendRequest` pre-request script, an `if`
around a setter, a body assertion and Digest auth on `/version`, each appears in the review with
location and reason, `/version` is left out as `unsupported-auth: digest`, `etag` is an environment
value, and adding a capture `etag` from header `ETag` binds the later reference.

### Tests for User Story 3 ⚠️ (write first, confirm they fail)

- [X] T056 [P] [US3] Write `backend/tests/unit/performance/collection/addedCaptures.test.ts`
  (FR-019, data-model validation): added captures use AP-035 names, paths and limits (10 per step),
  carry `origin: {kind: "user"}`, and are refused with `capture_name_invalid`, `capture_name_taken`,
  `capture_path_invalid`, `capture_header_invalid` and `too_many_captures`; an added binding to an
  earlier capture removes the reference from environment values; a binding to a later or missing
  capture gives `binding_capture_unknown`; removing a capture still bound gives `capture_in_use`;
  added captures survive rebuild for surviving item ids and are named in `notKept` otherwise; they do
  not change `conversionDigest` (settings), but a later converted capture of the same name is
  reported.
- [X] T057 [P] [US3] Write `backend/tests/integration/performance/collectionConversionReview.test.ts`
  for quickstart 6: one `prerequest-not-converted` finding per owner listing its steps (FR-009); the
  `if` setter as `condition` with its line; the body assertion as `assertion-not-converted`;
  `/version` left out with `unsupported-auth` and detail `digest`; a consumer of a left-out
  request's capture falls back to an environment value; `PUT /plan` with an added header capture binds
  the later reference.
- [X] T058 [P] [US3] Write frontend tests: extend `frontend/tests/unit/ConversionReview.test.tsx` for
  grouping by step and owner with counts, collapsing, and reason wording for every `FindingKind`;
  extend `frontend/tests/unit/PerformancePlanScreen.test.tsx` for the searchable Left out table and
  for adding a capture (typed path labelled "Not documented in a specification") and binding it on a
  later step.

### Implementation for User Story 3

- [X] T059 [US3] Accept `addedCaptures` and `addedBindings` in `applyUpdate` of
  `backend/src/performance/collection/collectionEngine.ts`, apply them in
  `backend/src/performance/collection/bindCollectionPlan.ts` before environment fallback, reusing
  AP-035's validators in `backend/src/performance/plan/userJourneyNames.ts` and
  `backend/src/performance/plan/capturePath.ts`; keep them across reset and rebuild per R13. Make T056
  and T057 pass.
- [X] T060 [US3] Extend `frontend/src/components/performance/collection/ConversionReview.tsx`: group
  findings by step and owner, counted and collapsible, with reason wording per `FindingKind`, the
  scope-precedence, url-encoding, credential-header and contradictory-assertions notes, and the
  capture-on-expected-status statement once (R20, XXXII).
- [X] T061 [US3] Extend `frontend/src/components/performance/PerformancePlanScreen.tsx` for collection
  plans: Left out as a searchable `OtherOperationsTable` with reasons; capture adding through
  `CaptureEditor` with no response-field list and typed paths labelled "Not documented in a
  specification"; binding through `BindingSourceControl` with the step's environment references as
  targets. Make T058 pass.

**Checkpoint**: User Stories 1 to 3 work independently.

---

## Phase 6: User Story 4 - An environment from the collection's values (Priority: P4)

**Goal**: **New environment from this collection** creates a target environment with the plan's
values, copied on the server, without returning any value.

**Independent Test**: Quickstart scenario 3 step 1. The values checklist shows `baseUrl`,
`client_id` and `client_secret` as **Present**, the create response holds no value, and a later
collection edit does not change the environment.

### Tests for User Story 4 ⚠️ (write first, confirm they fail)

- [X] T062 [P] [US4] Write `backend/tests/unit/performance/collection/seedEnvironment.test.ts` (R17,
  FR-017): name and tier; base URL from the base-URL variable; `collection-variable` values by the
  collection view's precedence (override, non-empty environment value, collection default);
  `collection-literal` values from the stored auth or header; unresolved names left out;
  `requestDelayMs: 0`; `base_url_missing` when the base-URL variable is absent or unresolved; the
  collection is unchanged.
- [X] T063 [P] [US4] Extend `backend/tests/integration/performance/collectionPerformanceRoutes.test.ts`:
  `POST /collection-performance/environment` returns 201 with id and name only (a seeded value is
  absent from the response body and logs); `invalid_request`, `duplicate_environment_name`,
  `collection_deleted`, `base_url_missing`; the environments routes open when only a collection plan
  exists; editing the collection afterwards leaves the environment unchanged.
- [X] T064 [P] [US4] Write `frontend/tests/unit/NewEnvironmentFromCollection.test.tsx`: naming,
  submitting, error states by code, and the values checklist refreshed afterwards showing
  present/missing only.

### Implementation for User Story 4

- [X] T065 [US4] Implement `backend/src/performance/collection/seedEnvironment.ts` (R17) using
  `createEnvironment` from `backend/src/execution/environmentStore.ts` and the collection view's
  variable precedence (`buildVariableBindings`). Values are read only here. Make T062 pass.
- [X] T066 [US4] Add `POST /collection-performance/environment` to
  `backend/src/api/collectionPerformance.ts`, and let `requireEnvironmentAccess` in
  `backend/src/api/testGenerationWorkflow.ts` also pass when `hasCollectionPlan()` is true. Make T063
  pass.
- [X] T067 [US4] Add `frontend/src/components/performance/collection/NewEnvironmentFromCollection.tsx`
  and place it beside the environment picker for collection plans in
  `frontend/src/components/performance/PerformancePlanScreen.tsx`. Make T064 pass.

**Checkpoint**: All user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T068 [P] Extend `backend/tests/integration/performance.k6.real.test.ts` (opt-in,
  `K6_TEST_REAL=1`, never in `npm test`) with two cases against `customersTarget({auth})`:
  - `apifoundryCollection({ dynamicBody: true })` with 2 VUs and `rejectRepeatedEmail: true`: no
    401, 404 or 409, one token issue before the load, and every
    GET, PATCH and DELETE using its own VU's id (SC-001, SC-002);
  - `expiresIn: 10` over a 40-second profile: refreshes from each VU before expiry and no
    authentication failure (FR-028); and with `tokenStatus: 500`, a setup failure naming the request
    and `access_token`.

  Also assert SC-006 (10 VUs × 10 iterations: no repeated `$randomEmail` or `$guid`, and none shared
  between two runs).
- [X] T069 [P] Add a log check to `backend/tests/integration/performance/collectionPerformanceRoutes.test.ts`:
  logs captured during the route tests contain no collection name, request name, URL, variable name,
  script text, excerpt or seeded value (contract Logging, XX).
- [X] T070 [P] Add amendment pointers (XXVI): in `specs/031-k6-performance-testing/spec.md` at FR-009,
  FR-015 and the token source (extended by AP-036 R8, R10), in
  `specs/026-external-collection-execution/spec.md` at the run panel (entry point, AP-036 FR-001), and
  in `specs/035-user-defined-journeys/spec.md` at FR-018 (runtime extended by AP-036 R10).
- [X] T071 [P] Document the feature: `docs/USER_MANUAL.md` new section 5a (building from a
  collection, recognised forms, credential requests, dynamic variables and the run tag, the review,
  out of date and rebuild, and limitations: form-data, URL encoding of path variables, scope
  precedence, iteration data, `setNextRequest`); `docs/architecture.md` (the `PlanEngine` seam and the
  `performance/collection/` package); `README.md` feature list.
- [X] T072 Update `specs/ROADMAP.md`: add an AP-036 row and a Next Actions entry, following the
  AP-035 entries.
- [X] T073 Run `npm run version:bump -- feature` (19.16.0 → 19.17.0). This updates the 4
  `package.json` files and `package-lock.json` through npm.
- [X] T074 Run `npm test`, `npm run lint` and `npm run build`. Record the results in
  `specs/036-collection-performance-test/validation.md`, exactly as run, including any failures.
- [ ] T075 Walk through quickstart.md scenarios 1 to 8 in the browser with k6 installed, and record
  each outcome in `specs/036-collection-performance-test/validation.md`. If this cannot be done,
  leave the task unchecked and say so (constitution XXXI).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1):** T001 gates everything. T002 to T005 are [P] after it.
- **Foundational (Phase 2):** depends on Phase 1. It blocks every user story.
  - T011 comes before everything else in the phase.
  - T012 → T013 and T012 → T014 (T014 needs T007 written first).
  - T015 to T020 can run beside the T012 → T014 chain.
- **US1 (Phase 3):** depends on Phase 2.
- **US2 (Phase 4):** depends on US1's T038 and T040 (assembly and engine). The runtime support is
  already in T014.
- **US3 (Phase 5):** depends on US1's T036, T040, T046 and T047. It is independent of US2.
- **US4 (Phase 6):** depends on US1's T039 to T041 and T047. It is independent of US2 and US3.
- **Polish (Phase 7):** depends on the stories being delivered. T068 needs T004. T073 to T075 come
  last.

### Within Each User Story

- Tests first, and confirm they fail.
- Pure modules in `performance/collection/` before the engine, the engine before the router, the
  router before the frontend.
- US1 backend chain: T033 → T034 → T036 → T037 → T038 → T040 → T041; T032 and T035 beside it until
  T038; T039 before T040.
- `collectionEngine.ts`, `assembleCollectionPlan.ts`, `collectionPerformance.ts`,
  `ConversionReview.tsx` and `PerformancePlanScreen.tsx` are touched by several stories, so run
  those tasks in order.

### Parallel Opportunities

- **Phase 1:** T002 to T005.
- **Phase 2:** T006 to T010 together. Then T015 to T020 beside the T012 → T013/T014 chain.
- **US1:** tests T021 to T031 together. Then T032, T033 and T035 together; frontend T043 to T046
  together beside the backend chain.
- **US2, US3 and US4:** can proceed in parallel once US1's backend chain is done, if their shared
  files are edited in order.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "T021 readCollectionRequests tests in backend/tests/unit/performance/collection/readCollectionRequests.test.ts"
Task: "T022 recognizeScript tests in backend/tests/unit/performance/collection/recognizeScript.test.ts"
Task: "T023 statusAssertions tests in backend/tests/unit/performance/collection/statusAssertions.test.ts"
Task: "T029 route tests in backend/tests/integration/performance/collectionPerformanceRoutes.test.ts"
Task: "T031 UI tests in frontend/tests/unit/"

# Then the pure modules, together:
Task: "T032 backend/src/performance/collection/readCollectionRequests.ts"
Task: "T033 backend/src/performance/collection/statusAssertions.ts"
Task: "T035 backend/src/performance/collection/collectionValues.ts"

# Beside the backend chain:
Task: "T043 labels in frontend/src/components/performance/performanceViewModel.ts"
Task: "T044 frontend/src/components/performance/collection/CollectionStepSource.tsx"
Task: "T045 frontend/src/components/performance/collection/CredentialRequestList.tsx"
Task: "T046 frontend/src/components/performance/collection/ConversionReview.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup, after confirming the constitution amendment is merged (T001).
2. Phase 2: Foundational. The only change to existing output is the two regenerated goldens (T014).
3. Phase 3: User Story 1.
4. **Stop and validate:** quickstart 1 to 4 and 7. The US1 collection runs under load without
   defining its steps again, with the token obtained once and each VU's own customer id.

### Incremental Delivery

1. Setup and Foundational give the seam, the runtime and the run tag.
2. US1 is the MVP: build, convert, review, generate, run, report, out of date and rebuild.
3. US2 adds Postman dynamic variables.
4. US3 adds the review at scale and captures and bindings set by the engineer.
5. US4 adds the environment seeded from the collection.
6. Polish adds real k6, pointers, docs, the roadmap, version 19.17.0 and validation.

---

## Notes

- **Implementation record (2026-10-02).**
  - **Done:** 74 of 75 tasks. **T075** (browser walkthrough) has not been performed.
  - **Real k6:** T068's four cases passed with k6 v2.3.0. Their first run found that k6 writes
    `undefined` in setup data as `null`; the runtime now checks token values with `Array.isArray`,
    and `k6Sandbox.ts` serialises setup data as k6 does, so the sandbox catches it too.
  - **Order changes:**
    - the environments gate (planned in T066) opened in US1 with T041, because a US1 run needs a
      target environment;
    - the engine uses the supported dynamic-variable list from the start; the US1 tests that leave
      `{{$…}}` requests out pass an empty list explicitly, and US1 fixtures use the literal body.
  - **Additions beyond data-model.md:** `CollectionPlanInfo.excludedRequests` and `addedBindings`,
    `tokenRefreshes.setupFailed` and `byScheme`, `PlanHandle.gate`, and the `APIPILOT_RUN_TAG`
    allowlist in `buildChildEnv`. Recorded under "Implementation notes" in data-model.md and
    contracts/changes-to-existing-apis.md.
  - **Test placement:** T031's App check is `frontend/tests/unit/AppCollectionPerformance.test.tsx`,
    because its module mocks apply to a whole file. FR-019's UI is a "Captures you add" panel on the
    Plan tab (`CollectionCapturesPanel.tsx`), as AP-035 placed its capture editor.
  - **Details:** see `validation.md`.

- **No commits.** Leave every change uncommitted for the user's review.
- **Security-relevant tasks.** Flag these in the review summary:
  - T014 changes what every generated script does at run time;
  - T015 adds a k6 environment variable to every run;
  - T034 reads collection scripts (it must only match AST nodes, never evaluate);
  - T035 decides which literals become secrets and which are written into the script;
  - T040 and T041 decide which collection content reaches the script as data;
  - T016 changes what run snapshots store;
  - T065 is the only code that reads collection values.
- **Golden fixtures.** `golden/script.js` and `golden/user-journeys-script.js` change only in T014.
  `golden/collection-script.js` is created in T041 and `golden/collection-dynamic-script.js` in T054.
  Any later change to them is a reviewed contract change; update research R10 first.
- **Run again.** Runs made before 19.17.0 need a regenerated script before **Run again** (plan Open
  item 6). Mention it in the manual (T071).
