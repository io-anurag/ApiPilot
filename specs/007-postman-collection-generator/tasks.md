---

description: "Task list for AP-007 Postman Collection Generator"
---

# Tasks: Postman Collection Generator

**Input**: Design documents from `/specs/007-postman-collection-generator/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/postman-collection-api.md, quickstart.md

**Tests**: Test tasks ARE included. plan.md names the test surfaces explicitly (Vitest in all three workspaces, Supertest for the endpoint, React Testing Library for the export UI, a dedicated determinism test), and contracts/postman-collection-api.md lists guarantees to be asserted by contract tests.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Web application in an npm-workspaces monorepo, per plan.md: `backend/src/`, `frontend/src/`, `packages/shared-domain/src/`, with tests under each workspace's `tests/` directory. `vitest.workspace.ts` already includes `tests/**/*.test.ts(x)` in every workspace, so no test-runner configuration is needed for the new folders.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the artifact contracts and shared test fixtures. No dependencies are added — plan.md's Technical Context specifies zero new packages.

- [X] T001 Create the artifact contract module in `packages/shared-domain/src/postmanArtifact.ts` with the types from data-model.md: `ExportOptions`, `ArtifactVariable`, `PostmanCollection` (info/auth/variable/item), `PostmanFolder`, `PostmanRequestItem`, `PostmanUrl`, `PostmanBody`, `PostmanEvent`, `PostmanEnvironment`, `PostmanEnvironmentValue`, `ValidationReport`, `GenerationLimitation` with its seven `kind` values, `ExportSummary`, `ExportResult`, and the failure-outcome codes; keep the module framework-agnostic and do not modify `ApiModel`, `TestModel`, `TestScenario`, or `Provenance`
- [X] T002 Re-export the artifact contracts from `packages/shared-domain/src/index.ts` alongside the existing `export * from "./testScenarioReview"` lines
- [X] T003 [P] Add export test fixtures in `backend/tests/fixtures/postman/exportFixtures.ts`: an `ApiModel` covering tagged and untagged operations, path/query/header parameters, a JSON request body, a non-JSON request body, `http`/`bearer`, `http`/`basic`, `apiKey`, and `oauth2` security schemes, plus analysis issues; and an approved `TestModel` covering positive and negative scenarios, a scenario with an exact status code, a wildcard (`4XX`) code, a `default` code, a schema-conformance assertion, and a scenario with no assertions

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The determinism primitives and the shared credential-detection predicates every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Unit test for content-derived identifiers in `backend/tests/unit/postman/identifiers.test.ts`: the same scenario id always yields the same item id, different scenario ids yield different ids, the collection id is a pure function of the ordered scenario id list, ids are valid UUID-formatted strings, and no identifier changes between two calls in the same process
- [X] T005 [P] Unit test for the deterministic ordering helpers in `backend/tests/unit/postman/ordering.test.ts`: the comparator is locale-independent code-unit comparison (assert against strings where `localeCompare` and code-unit order disagree), the request sort key is `(path, method, category, scenario id)`, and sorting is stable and independent of input order
- [X] T006 [P] Unit test for the extracted credential-detection predicates in `backend/tests/unit/testDesign/sensitiveValueDetection.test.ts`: sensitive header names, bearer-token values, and sensitive body field names are detected; ordinary values are not
- [X] T007 [P] Contract shape test for the artifact types in `packages/shared-domain/tests/unit/postman-artifact.test.ts`, following the pattern of `packages/shared-domain/tests/unit/ai-scenario-design.test.ts`
- [X] T008 [P] Implement content-derived identifiers in `backend/src/postman/identifiers.ts` using Node's built-in `crypto` SHA-256 formatted as a UUID, per research.md; never call `randomUUID`, `Math.random`, or any time-based source
- [X] T009 [P] Implement the deterministic ordering helpers in `backend/src/postman/ordering.ts`: a fixed code-unit string comparator (explicitly not `localeCompare`), the folder and request sort keys, and a serializer that emits object keys in a fixed order determined by the emitting types rather than by input iteration order
- [X] T010 Extract the credential-detection predicates from `backend/src/testDesign/reviewSensitiveValues.ts` into `backend/src/testDesign/sensitiveValueDetection.ts` (sensitive header names, bearer-token pattern, sensitive field-name pattern) and refactor `reviewSensitiveValues.ts` to consume them without changing its redaction behaviour; `backend/tests/unit/testDesign/` and the AP-006 review tests must still pass unchanged

**Checkpoint**: Determinism primitives and shared detection predicates are in place — user story implementation can begin.

---

## Phase 3: User Story 1 - Export an Executable Collection (Priority: P1) 🎯 MVP

**Goal**: Turn an approved `TestModel` into a collection artifact containing exactly one runnable request per approved scenario, organized into navigable folders, carrying only the checks the approved scenarios defined, and byte-identical across repeated exports.

**Independent Test**: Post an `ApiModel` and an approved `TestModel` covering several operations to `POST /api/test-models/postman-collection` and confirm the returned collection has one item per approved scenario with the correct method, URL, path/query parameters, headers, and body, grouped into folders whose names identify the operation and scenario purpose; export twice and confirm the two responses are byte-identical.

### Tests for User Story 1

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T011 [P] [US1] Unit test for grouping and naming in `backend/tests/unit/postman/folders.test.ts`: folder name from the operation's first declared tag, fallback to the first path segment, fallback to a single `Ungrouped` folder when the path has no segment, deterministic numeric-suffix disambiguation for names that collide after normalization, request names of the form `METHOD /path — category`, deterministic disambiguation of colliding request names, and no empty folder emitted
- [X] T012 [P] [US1] Unit test for request items in `backend/tests/unit/postman/requestItem.test.ts`: the URL is `{{baseUrl}}` plus the operation path with each path parameter as a `:name` segment and its approved value in the URL `variable` list, approved query parameters appear in the URL `query` list, approved headers are copied verbatim, the body content type is re-derived through `primaryRequestBodySchema` from `backend/src/testDesign/requestHelpers.ts`, a deliberately schema-violating negative body is preserved exactly as approved, and a content type that cannot be represented faithfully produces an `unsupported-content-type` limitation rather than a converted body
- [X] T013 [P] [US1] Unit test for assertion translation in `backend/tests/unit/postman/assertionScripts.test.ts`: an exact status code becomes a status check on that code, a wildcard `4XX` becomes a status-class check, `default` produces no check and a `undocumented-status-code` limitation, `schema-conformance` becomes a JSON-schema check whose schema copies only the constraints actually declared (absent constraints omitted, `required` only when non-empty, recursive `properties` and `items`), a scenario with no assertions produces no `event` and a `no-expected-outcome` limitation, and no check is emitted that the scenario did not carry
- [X] T014 [P] [US1] Unit test for generation orchestration in `backend/tests/unit/postman/generateCollection.test.ts`: exactly one item per approved scenario, no item for a scenario absent from the approved model, and explicit refusals for an empty approved `TestModel`, a scenario referencing an operation the `ApiModel` does not contain, and a `TestModel` carrying multi-step workflow intent
- [X] T015 [P] [US1] Determinism test in `backend/tests/unit/postman/determinism.test.ts`: generating twice from identical input in one process yields byte-identical serialized collection, environment, and README; generating from a shuffled scenario order yields the same output as the unshuffled order
- [X] T016 [P] [US1] Integration test in `backend/tests/integration/postmanCollection.test.ts` using Supertest, following `backend/tests/integration/enhancedTestModels.test.ts`: `200` with the contract's response shape, `400 invalid_request` for a body missing `apiModel`/`testModel`, `400 empty_approved_test_model`, `400 unknown_operation`, `400 workflow_intent_unsupported`, `405` for non-POST, and an identical response body for a repeated identical request
- [X] T017 [P] [US1] Frontend test in `frontend/tests/unit/PostmanExportPanel.test.tsx`: the export control has an accessible name, the loading, success, empty, and failure states are each rendered with text (not colour alone), the failure state includes recovery guidance, and a successful export writes `collection.json`

### Implementation for User Story 1

- [X] T018 [P] [US1] Implement grouping, naming, disambiguation, and folder/request ordering in `backend/src/postman/folders.ts` using the comparator from `backend/src/postman/ordering.ts`
- [X] T019 [P] [US1] Implement assertion translation and the `SchemaConstraint`-to-JSON-Schema converter in `backend/src/postman/assertionScripts.ts`, emitting a single `test` event only when the scenario carries assertions and returning the limitations it records
- [X] T020 [US1] Implement scenario-to-item conversion in `backend/src/postman/requestItem.ts`: URL composition through `{{baseUrl}}`, path parameters as `:name` segments with approved values in the URL variable list, query parameters, headers, and the body with its content type re-derived from the `ApiModel`; the item id comes from `backend/src/postman/identifiers.ts` (depends on T008, T018, T019)
- [X] T021 [US1] Implement `backend/src/postman/generateCollection.ts`: map the approved `TestModel` plus `ApiModel` to an `ExportResult`, accumulate `GenerationLimitation` entries, build `info` with the content-derived collection id and the v2.1.0 schema identifier, and return explicit refusals for the empty approved model, an unresolvable operation, and multi-step workflow intent (detected as workflow/ordering/extraction fields the current `TestScenario` contract does not define, per research.md) (depends on T020)
- [X] T022 [US1] Implement the thin route adapter in `backend/src/api/postmanCollections.ts` for `POST /api/test-models/postman-collection`, following the request-shape guards and `405` handling in `backend/src/api/testScenarioReviews.ts`, and mapping refusals to the contract's `400` error codes; keep all generation logic out of the route (depends on T021)
- [X] T023 [US1] Register the router in `backend/src/app.ts` alongside the existing `/api` routers (depends on T022)
- [X] T024 [P] [US1] Implement `frontend/src/services/postmanCollectionsClient.ts`: one POST per export returning a discriminated ok/error result in the style of `frontend/src/services/reviewsClient.ts`, plus the file-writing helper that saves artifacts from the single response
- [X] T025 [US1] Implement `frontend/src/components/PostmanExportPanel.tsx` with semantic HTML and no styling framework (per research.md): an accessible export button, distinct loading, success, empty, and failure states with text-based status and recovery guidance, and `collection.json` download (depends on T024)
- [X] T026 [US1] Wire the export panel into `frontend/src/pages/TestScenarioReviewPage.tsx`, passing the current `apiModel` and the workspace's `approvedTestModel` (depends on T025)

**Checkpoint**: An approved test set exports to a runnable, deterministically organized collection through the UI. MVP is complete and independently testable.

---

## Phase 4: User Story 2 - Run Without Embedding Secrets (Priority: P1)

**Goal**: Every address and credential the collection needs is a named variable declared in a companion environment artifact; supplied values live only in that environment, marked sensitive, and never in the collection.

**Independent Test**: Export from an approved test set whose operations declare authentication, supplying a base address and a credential value, then confirm every request URL begins with `{{baseUrl}}`, authentication is configured through named variables, the environment declares every referenced variable, the supplied credential appears only in `environment.values` typed `secret`, and no literal host or credential appears anywhere in the collection.

### Tests for User Story 2

- [X] T027 [P] [US2] Unit test for authentication mapping in `backend/tests/unit/postman/authMapping.test.ts`: `http`/`bearer` maps to bearer auth with `{{token}}`, `http`/`basic` to basic auth with `{{username}}` and `{{password}}`, `apiKey` to API-key auth carrying the declared parameter name and location with `{{apiKey}}`, `oauth2` and `openIdConnect` produce no auth and an `unsupported-auth-scheme` limitation, and an operation declaring several alternative requirement sets uses the first declared set and records an `alternative-auth-requirement-selected` limitation
- [X] T028 [P] [US2] Unit test for the environment artifact in `backend/tests/unit/postman/environment.test.ts`: one entry per `ArtifactVariable` ordered by name, `type: "secret"` for credential variables and `default` otherwise, `_postman_variable_scope` always `environment`, unsupplied variables carry an empty value with no invented host or token, and supplied values appear here and nowhere else
- [X] T029 [P] [US2] Unit test for credential substitution in `backend/tests/unit/postman/credentialSubstitution.test.ts`: a request value the shared predicates identify as a credential is emitted as `{{token}}`, `{{apiKey}}`, or `{{password}}` rather than literally, `[redacted]` is never emitted into a runnable artifact, and non-credential values are untouched
- [X] T030 [P] [US2] Integration test in `backend/tests/integration/postmanCollectionSecrets.test.ts`: with a supplied `baseUrl` and credential values, no literal host and no credential value appears in `collection` or `readme`, every `{{…}}` reference in the collection is declared in both `collection.variable` and `environment.values`, and `options.variableValues` naming a variable the collection does not reference returns `400 unknown_variable`
- [X] T031 [P] [US2] Frontend test in `frontend/tests/unit/PostmanExportPanelSecrets.test.tsx`: the base-address and credential inputs have accessible labels, a supplied credential value is never rendered back to the page, and a successful export writes `environment.json`

### Implementation for User Story 2

- [X] T032 [P] [US2] Implement `backend/src/postman/authMapping.ts`: map `SecuritySchemeDefinition` to collection auth exactly as research.md specifies, return the `ArtifactVariable`s each mapping requires, and record a limitation for every scheme type that cannot be configured — never substitute a different mechanism
- [X] T033 [US2] Apply credential substitution in `backend/src/postman/requestItem.ts` using `backend/src/testDesign/sensitiveValueDetection.ts`, replacing detected credential values with the matching variable reference while leaving the rest of the approved request intact (depends on T010, T020)
- [X] T034 [US2] Aggregate declared variables in `backend/src/postman/generateCollection.ts`: `baseUrl` always, the variables the mapped security schemes require, one variable per path parameter that has no approved value (recording an `unresolved-path-parameter` limitation), each with a non-empty `purpose` and its `secret` marking; emit them in `collection.variable` with empty values so the collection imports and runs without the environment file (depends on T021, T032, T033)
- [X] T035 [US2] Implement `backend/src/postman/environment.ts`: build the environment artifact from the aggregated `ArtifactVariable` set, ordered by name using the shared comparator, with supplied values applied only here and credential variables typed `secret` (depends on T034)
- [X] T036 [US2] Validate `options` in `backend/src/api/postmanCollections.ts` and `generateCollection.ts`: accept `baseUrl`, `collectionName`, and `variableValues`, and refuse with `unknown_variable` when a supplied name is not a variable the generated collection references, rather than ignoring it silently (depends on T034)
- [X] T037 [US2] Extend `frontend/src/components/PostmanExportPanel.tsx` and `frontend/src/services/postmanCollectionsClient.ts` with labelled base-address and credential inputs, send them as `options`, write `environment.json` from the same response, and never render a supplied credential value back to the page (depends on T025, T035)

**Checkpoint**: Exported artifacts are shareable — no host and no secret is embedded in the collection.

---

## Phase 5: User Story 3 - Trust and Understand the Artifact (Priority: P2)

**Goal**: Every export is validated before delivery, an invalid artifact is refused rather than returned, and the engineer receives a document stating coverage, organization, required variables, how to run, and every known limitation.

**Independent Test**: Export from an approved test set that includes a scenario with no expected response, an `oauth2` operation, and operations carrying analysis issues; confirm the response reports the validation result, that a deliberately corrupted collection is refused with `collection_validation_failed` and its artifacts withheld, and that the README states the request count, folder organization, counts by origin, required variables, run instructions, and each limitation.

### Tests for User Story 3

- [X] T038 [P] [US3] Unit test for collection validation in `backend/tests/unit/postman/validateCollection.test.ts`, one case per invariant from data-model.md: required top-level and item fields present, every URL beginning with `{{baseUrl}}`, no literal host, no credential-pattern value outside a `{{…}}` reference, every `{{…}}` reference declared as an `ArtifactVariable`, unique item ids, folders and items in the defined order, and no field outside the emitted subset; assert that each reported problem names a location and an expectation and contains no payload, specification content, or variable value
- [X] T039 [P] [US3] Unit test for the accompanying document in `backend/tests/unit/postman/readme.test.ts`: request count, folder organization, counts by origin, each required variable with its purpose, import-and-run instructions, and the full limitation list grouped by kind; assert the document contains no request payload and no variable value, and that identical input produces an identical document
- [X] T040 [P] [US3] Integration test in `backend/tests/integration/postmanCollectionValidation.test.ts`: a collection that fails validation returns `500 collection_validation_failed` with a `problems` array and without `collection`, `environment`, or `readme`; a successful export reports `validation.valid` as `true` and returns recorded limitations without blocking
- [X] T041 [P] [US3] Frontend test in `frontend/tests/unit/PostmanExportLimitations.test.tsx`: the validation outcome and the limitation list are rendered with accessible text, a validation failure is presented as a failed export rather than a success, and an export with limitations is still presented as successful

### Implementation for User Story 3

- [X] T042 [P] [US3] Implement `backend/src/postman/validateCollection.ts` over the serialized collection, checking every invariant listed in T038 and returning a `ValidationReport` whose problems name failing locations and expectations only (research.md: structural validation of the emitted subset; the official v2.1.0 schema is deliberately not vendored)
- [X] T043 [US3] Wire the validation gate into `backend/src/postman/generateCollection.ts` and `backend/src/api/postmanCollections.ts` so a failing validation refuses the export with `collection_validation_failed` and withholds the artifacts, while recorded limitations never block delivery (depends on T042)
- [X] T044 [US3] Aggregate the full limitation set in `backend/src/postman/generateCollection.ts`, adding `specification-analysis-issue` entries from `ApiModel.summary.issues` for the operations actually exported, and order limitations deterministically (depends on T021, T032)
- [X] T045 [US3] Implement `backend/src/postman/readme.ts` rendering the `ArtifactDocument` deterministically from the `ExportResult`, with counts by origin derived from each approved scenario's `Provenance.source` (depends on T044, T046)
- [X] T046 [US3] Reconcile the `summary.byProvenance` example in `specs/007-postman-collection-generator/contracts/postman-collection-api.md` and the origin wording in `specs/007-postman-collection-generator/data-model.md` with what the approved `TestModel` actually carries: `Provenance.source` is `RULE` or `AI` only, and `isUserModified` lives on `ReviewScenario`, which this boundary does not receive — either drop the `USER` count or specify how the export learns it; do not report a `USER` count the input cannot support
- [X] T047 [P] [US3] Implement `frontend/src/components/PostmanExportLimitations.tsx` rendering the limitation list grouped by kind with accessible text and no colour-only status
- [X] T048 [US3] Extend `frontend/src/components/PostmanExportPanel.tsx` to report the validation outcome, render `PostmanExportLimitations`, and write `README.md` from the same response so one action produces all three files (depends on T037, T047)

**Checkpoint**: Exports are validated before delivery and arrive documented; all three artifacts come from one action.

---

## Phase 6: User Story 4 - Re-export After Further Review (Priority: P3)

**Goal**: Re-exporting after a review change produces a diff limited to the affected scenario, and an unchanged re-export is identical.

**Independent Test**: Export an approved test set, remove one accepted scenario, re-export, and confirm the only difference is that scenario's item — every other item id, folder, check, and variable is unchanged; re-export with no change and confirm the artifacts are identical.

### Tests for User Story 4

- [X] T049 [P] [US4] Re-export stability test in `backend/tests/unit/postman/reexportStability.test.ts`: removing one approved scenario changes only that scenario's item and leaves every other item id and the folder order untouched; an unchanged re-export is byte-identical including folder, request, check, and variable ordering; and the declared variable set is unchanged for the scenarios that remain
- [X] T050 [P] [US4] Integration test in `backend/tests/integration/postmanCollectionReexport.test.ts`: two exports differing by one removed approved scenario produce responses whose difference is confined to that scenario's item

### Implementation for User Story 4

- [X] T051 [US4] Verify and, where found, remove any positional coupling in `backend/src/postman/identifiers.ts`, `backend/src/postman/folders.ts`, and `backend/src/postman/environment.ts` so that item ids, folder membership, and the declared variable set depend only on the scenarios present and never on a scenario's index; the collection-level id may change with the scenario set, but no surviving item's id may (depends on T049, T050)

**Checkpoint**: The collection is maintainable across review cycles — a single decision change produces a single-item diff.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T052 [P] Performance test in `backend/tests/unit/postman/generateCollection.performance.test.ts` following `backend/tests/unit/testDesign/generateTestModel.performance.test.ts`: 500 approved scenarios export in under 10 seconds (SC-010), asserting the target rather than assuming it
- [X] T053 [P] No-network test in `backend/tests/unit/postman/noNetwork.test.ts`: generation issues no request — stub `globalThis.fetch` and `node:http`/`node:https` request entry points to fail the test if called (SC-012, FR-023)
- [X] T054 [P] Diagnostics safety test in `backend/tests/integration/postmanCollectionDiagnostics.test.ts`: no error response body and no logged message produced during a failed export contains a request payload, specification content, or a variable value (FR-025)
- [X] T055 [P] Update the Source Code structure section of `specs/007-postman-collection-generator/plan.md` to list `backend/src/postman/ordering.ts`, the shared comparator and fixed-key serializer extracted from the ordering rule in research.md
- [X] T056 [P] Document the export capability in `README.md` alongside the existing AP-00x sections: the endpoint, the three artifacts, the variables an engineer must supply, the module boundaries under `backend/src/postman/`, and the explicit statement that AP-007 uses no AI and executes nothing
- [ ] T057 Run the quickstart validation in `specs/007-postman-collection-generator/quickstart.md`, including the manual import-and-run acceptance step for SC-007 and the secret-leak and refusal-path checks — **partially done**: every automated command in the quickstart was run and passes, and the secret-leak and refusal paths are covered by `backend/tests/integration/postmanCollectionSecrets.test.ts`, `postmanCollectionValidation.test.ts`, and `postmanCollectionDiagnostics.test.ts`. The manual step (import `collection.json` and `environment.json` into Postman, fill in the variables, confirm every request resolves without a manual edit) remains outstanding: it needs a real collection runner and a target the operator is authorized to call, which this feature deliberately does not provide
- [X] T058 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and resolve every failure without weakening TypeScript or ESLint configuration and without disabling tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — no dependency on other stories
- **User Story 2 (Phase 4)**: Depends on Foundational; T033/T034 extend files created in US1, so run after US1 when worked sequentially
- **User Story 3 (Phase 5)**: Depends on Foundational; T043/T044 extend `generateCollection.ts` and T048 extends the export panel
- **User Story 4 (Phase 6)**: Depends on US1 for the generator and on US2 for the variable set it asserts stability over
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### Within Each User Story

- Tests are written first and must fail before implementation
- Pure generator modules before orchestration; orchestration before the route; the route before the frontend service; the service before the component
- `identifiers.ts` and `ordering.ts` (T008, T009) precede every module that emits an id or an ordered list

### Story Independence Notes

US1 is fully independent. US2 and US3 each extend `generateCollection.ts`, `requestItem.ts`, and `PostmanExportPanel.tsx` rather than replacing them, so they remain independently testable but touch shared files — do not run US2 and US3 implementation tasks concurrently against those three files.

### Parallel Opportunities

- All Phase 1 and Phase 2 test tasks (T004–T007) run in parallel
- T008 and T009 run in parallel; T010 touches `testDesign/` and is independent of both
- Within each story, every test task marked [P] runs in parallel
- T018, T019, T032, T042, T047, and the Phase 7 tasks T052–T056 are each in their own file and run in parallel
- With multiple developers: after Phase 2, US1 can start immediately; US2's `authMapping.ts` (T032) and US3's `validateCollection.ts` (T042) can be built in parallel with US1 since they are new, self-contained modules

---

## Parallel Example: User Story 1

```bash
# Write all User Story 1 tests together, then confirm they fail:
Task: "Unit test for grouping and naming in backend/tests/unit/postman/folders.test.ts"
Task: "Unit test for request items in backend/tests/unit/postman/requestItem.test.ts"
Task: "Unit test for assertion translation in backend/tests/unit/postman/assertionScripts.test.ts"
Task: "Unit test for generation orchestration in backend/tests/unit/postman/generateCollection.test.ts"
Task: "Determinism test in backend/tests/unit/postman/determinism.test.ts"
Task: "Integration test in backend/tests/integration/postmanCollection.test.ts"
Task: "Frontend test in frontend/tests/unit/PostmanExportPanel.test.tsx"

# Then the independent generator modules together:
Task: "Implement grouping and ordering in backend/src/postman/folders.ts"
Task: "Implement assertion translation in backend/src/postman/assertionScripts.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — determinism primitives block everything
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: export an approved test set end to end, confirm one request per approved scenario and byte-identical repeat exports
5. Demo the collection artifact

### Incremental Delivery

1. Setup + Foundational → determinism and detection primitives ready
2. Add US1 → runnable collection from approved scenarios (MVP)
3. Add US2 → shareable artifacts with no embedded host or secret
4. Add US3 → validated delivery plus the accompanying document
5. Add US4 → maintainable re-export across review cycles

---

## Notes

- [P] tasks = different files, no dependencies
- Every task in Phases 3–6 carries its story label for traceability
- No new dependency is introduced anywhere in this feature (plan.md, Technical Context)
- No AI provider, model download, or network access is involved in any task (FR-019, FR-023)
- Multi-step workflow rendering is deliberately absent: T021 detects and refuses workflow intent; rendering waits on AP-008's contract (FR-028–FR-030)
- T046 records a contract-versus-input conflict found while planning; resolve it before implementing T045 rather than reporting a count the input cannot support
- The requirements-quality findings in `specs/007-postman-collection-generator/checklists/export.md` remain open; several (credential-recognition criteria, the limitation-versus-refusal rule, the `USER` origin count) affect tasks in Phases 4 and 5
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
