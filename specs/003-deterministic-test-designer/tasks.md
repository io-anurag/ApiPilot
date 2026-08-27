---

description: "Task list template for feature implementation"
---

# Tasks: Deterministic Test Designer

**Input**: Design documents from `/specs/003-deterministic-test-designer/`

**Prerequisites**: [plan.md](./plan.md) (required), [spec.md](./spec.md) (required for user stories), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: This feature is a deterministic rule-evaluation pipeline governed by constitution
XXI (Testability at Every Boundary), XIV (No Silent Assumptions), and I (Specification Is
the Source of Truth), so test tasks are included for each rule module, for the shared
assertion/value-generation infrastructure, and for the new endpoint contract, in addition
to the acceptance-scenario-driven tests per user story.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Extends the AP-001/AP-002 web application monorepo (per [plan.md](./plan.md) Project Structure):

- `backend/src/testDesign/`, `backend/src/testDesign/rules/`, `backend/src/api/`, `backend/src/openapi/`, `backend/tests/`
- `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/services/`, `frontend/tests/`
- `packages/shared-domain/src/`
- Root: `README.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add fixture `ApiModel`s needed before any rule/assertion logic exists

- [X] T001 [P] Create `backend/tests/fixtures/testDesign/nestedRequiredApiModel.ts`: an `ApiModel` fixture with one operation whose request body has required fields nested two levels deep inside object-typed properties, for recursive required-field/invalid-type/invalid-format tests (implemented as a typed `.ts` module exporting an `ApiModel` object rather than literal `.json`, for compile-time type safety against the `ApiModel` interface)
- [X] T002 [P] Create `backend/tests/fixtures/testDesign/constraintsApiModel.ts`: an `ApiModel` fixture covering an enum field, a `format`/`pattern` field, numeric/string/array boundary constraints, a required path parameter, a required query parameter, and an operation whose only documented responses are error status codes (no 2xx), for boundary/format/enum/parameter/assertion-gap tests (implemented as a typed `.ts` module, same rationale as T001)

**Checkpoint**: Fixtures available for all later test tasks

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core domain types and reusable rule infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Extend `SchemaConstraint` in `packages/shared-domain/src/apiModel.ts`: add optional `minLength`, `maxLength`, `minItems`, `maxItems` fields per [data-model.md](./data-model.md)
- [X] T004 Extend `extractSchemaConstraint` in `backend/src/openapi/buildApiModel.ts` to populate `minLength`/`maxLength`/`minItems`/`maxItems` from raw schema nodes, mirroring the existing `minimum`/`maximum`/`pattern` extraction pattern (depends on T003)
- [X] T005 [P] Define `TestModel`, `TestScenario`, `ScenarioCategory`, `GeneratedRequest`, `Assertion`, and `Provenance` types in `packages/shared-domain/src/testModel.ts` per [data-model.md](./data-model.md), and re-export them from `packages/shared-domain/src/index.ts`
- [X] T006 [P] Implement deterministic synthetic value generators in `backend/src/testDesign/valueGenerators.ts`: specification-conformant ("positive") values, incompatible-type values, format/pattern-violating values, enum-violating values, and boundary-adjacent (below/at/above) numeric/string/array values, per [research.md](./research.md) (depends on T005)
- [X] T007 Implement deterministic response-assertion selection in `backend/src/testDesign/assertions.ts`: a `status-code` assertion for the lowest documented 2xx (or lowest documented status overall) for positive scenarios and the lowest documented 4xx for negative scenarios; a `schema-conformance` assertion (FR-011) copied from the matching documented response schema whenever one is declared; and an empty `assertions` array with a gap description in `Provenance` when no applicable documented response exists, per [research.md](./research.md) (depends on T005)
- [X] T008 Implement the `generateTestModel.ts` orchestrator skeleton in `backend/src/testDesign/generateTestModel.ts`: iterates `ApiModel.operations`, skips operations/fields flagged in `apiModel.summary.issues` (unresolved-ref/circular-ref/unsupported-construct) rather than fabricating a scenario (FR-018), and exposes a registration point for the rule modules implemented in later tasks (depends on T005, T007)

**Checkpoint**: Domain types and shared rule infrastructure ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Generate a Baseline Test Suite from an Analyzed Specification (Priority: P1) 🎯 MVP

**Goal**: A QA engineer triggers baseline test-suite generation for an analyzed
specification and receives a positive scenario plus every applicable missing/null/empty,
invalid-type, invalid-format, invalid-enum, and boundary scenario for each operation.

**Independent Test**: Analyze a specification with known operations and schema
constraints, generate the baseline suite, and confirm a positive scenario and the
applicable negative/boundary scenarios are produced for each operation.

### Tests for User Story 1

- [X] T009 [P] [US1] Unit test for the extended `extractSchemaConstraint` boundary-field extraction in `backend/tests/unit/openapi/buildApiModel.test.ts` (`minLength`/`maxLength`/`minItems`/`maxItems`) (uses fixtures from T001, T002)
- [X] T010 [P] [US1] Unit tests for `valueGenerators.ts` in `backend/tests/unit/testDesign/valueGenerators.test.ts`
- [X] T011 [P] [US1] Unit tests for `assertions.ts` in `backend/tests/unit/testDesign/assertions.test.ts`: positive 2xx selection, negative 4xx selection, schema-conformance assertion generation when a response schema is documented (FR-011), and the no-documented-response gap case (uses fixtures from T002)
- [X] T012 [P] [US1] Integration test for `POST /api/test-models` in `backend/tests/integration/testModels.test.ts` using Supertest: covering the positive scenario, missing/null/empty-value scenarios for both top-level and nested required fields, path-parameter exclusion from missing/null/empty, and invalid-type/invalid-format/invalid-enum/boundary scenarios, per [contracts/test-models-api.md](./contracts/test-models-api.md) (uses fixtures from T001, T002)

### Implementation for User Story 1

- [X] T013 [P] [US1] Implement `positiveScenario.ts` rule in `backend/src/testDesign/rules/positiveScenario.ts` producing one happy-path scenario per operation using conformant values (FR-001) (depends on T006, T007)
- [X] T014 [P] [US1] Implement `requiredFieldScenarios.ts` rule in `backend/src/testDesign/rules/requiredFieldScenarios.ts`: recursively traverses nested request-body object properties plus query/header parameters to generate missing/null/empty-value scenarios, explicitly excluding path parameters (FR-002, FR-009) (depends on T006, T007)
- [X] T015 [P] [US1] Implement `invalidTypeScenarios.ts` rule in `backend/src/testDesign/rules/invalidTypeScenarios.ts` covering path/query/header/body fields at any nesting depth (FR-003) (depends on T006, T007)
- [X] T016 [P] [US1] Implement `invalidFormatScenarios.ts` rule in `backend/src/testDesign/rules/invalidFormatScenarios.ts` for declared `format`/`pattern` constraints, only firing when one is present (FR-008, FR-015) (depends on T006, T007)
- [X] T017 [P] [US1] Implement `invalidEnumScenarios.ts` rule in `backend/src/testDesign/rules/invalidEnumScenarios.ts`, only firing when an `enum` is declared (FR-004, FR-015) (depends on T006, T007)
- [X] T018 [P] [US1] Implement `numericBoundaryScenarios.ts` rule in `backend/src/testDesign/rules/numericBoundaryScenarios.ts`, only firing when `minimum`/`maximum` is declared (FR-005, FR-015) (depends on T004, T006, T007)
- [X] T019 [P] [US1] Implement `stringBoundaryScenarios.ts` rule in `backend/src/testDesign/rules/stringBoundaryScenarios.ts`, only firing when `minLength`/`maxLength` is declared (FR-006, FR-015) (depends on T004, T006, T007)
- [X] T020 [P] [US1] Implement `arrayBoundaryScenarios.ts` rule in `backend/src/testDesign/rules/arrayBoundaryScenarios.ts`, only firing when `minItems`/`maxItems` is declared (FR-007, FR-015) (depends on T004, T006, T007)
- [X] T021 [US1] Wire rule modules T013-T020 into `generateTestModel.ts` (depends on T008, T013, T014, T015, T016, T017, T018, T019, T020)
- [X] T022 [US1] Implement `POST /api/test-models` route in `backend/src/api/testModels.ts`: validate the request body has a minimally valid `apiModel.operations` array (400 `invalid_api_model` otherwise) and call `generateTestModel`, per [contracts/test-models-api.md](./contracts/test-models-api.md) (depends on T021)
- [X] T023 [US1] Register the test-models route in `backend/src/app.ts` (depends on T022)
- [X] T024 [P] [US1] Implement `testModelsClient.ts` in `frontend/src/services/testModelsClient.ts` calling `POST /api/test-models`
- [X] T025 [US1] Implement `TestScenarioList.tsx` in `frontend/src/components/TestScenarioList.tsx` grouping scenarios by operation and category, and add a "Generate Baseline Test Suite" action to `frontend/src/pages/SpecificationUploadPage.tsx` (FR-016) (depends on T024)
- [X] T026 [US1] Document the baseline test-suite generation workflow in a new "Deterministic Test Designer" section of root `README.md`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently (MVP)

---

## Phase 4: User Story 2 - Understand Why Each Scenario Was Generated (Priority: P2)

**Goal**: A QA engineer can inspect any generated scenario and see its category, the rule
that produced it, and its expected status code/schema-conformance assertions.

**Independent Test**: Inspect any generated scenario and confirm it displays its category,
rule, and expected outcome, without needing AI-enhanced or reviewed scenarios to exist.

### Tests for User Story 2

- [X] T027 [P] [US2] Unit test verifying every generated `Assertion.expectedStatusCode` corresponds to a status code documented in the source `ApiModel` for that operation (SC-006), extending `backend/tests/unit/testDesign/assertions.test.ts`
- [X] T028 [P] [US2] Component test for `TestScenarioDetail.tsx` in `frontend/tests/unit/TestScenarioDetail.test.tsx` confirming category, rule, generated request, and expected assertions are rendered

### Implementation for User Story 2

- [X] T029 [P] [US2] Implement `TestScenarioDetail.tsx` in `frontend/src/components/TestScenarioDetail.tsx` showing a selected scenario's category, targeted field/parameter, generated request, expected assertions, and rule provenance (depends on T024)
- [X] T030 [US2] Wire `TestScenarioDetail` into `TestScenarioList`/`SpecificationUploadPage.tsx` so selecting a scenario shows its detail (depends on T025, T029)
- [X] T031 [US2] Document the `TestScenario`/`Provenance` shape and how to interpret an empty-assertions gap in the "Deterministic Test Designer" `README.md` section (depends on T026)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Receive a Clean, Non-Redundant Baseline Suite (Priority: P3)

**Goal**: The generated baseline suite contains no duplicate scenarios within the same
operation, while remaining traceable to every rule that would have produced them.

**Independent Test**: Analyze a specification where two or more rules would otherwise
produce an identical request/assertion combination for the same operation, and confirm
only one representative scenario is retained.

### Tests for User Story 3

- [X] T032 [P] [US3] Unit tests for `deduplicate.ts` in `backend/tests/unit/testDesign/deduplicate.test.ts`: identical request+assertions within an operation merge into one scenario with a combined `duplicateOfRules`; identical-looking requests on different operations are NOT merged

### Implementation for User Story 3

- [X] T033 [US3] Implement `deduplicate.ts` in `backend/src/testDesign/deduplicate.ts`: per-operation canonical-JSON dedup key over `{ method, path, request, assertions }`, merging duplicate rule identifiers into the retained scenario's `Provenance.duplicateOfRules` (FR-012) (depends on T007)
- [X] T034 [US3] Wire `deduplicate.ts` into `generateTestModel.ts` as the final step before returning the `TestModel` (depends on T021, T033)
- [X] T035 [US3] Manually validate: generate a baseline suite for a specification containing two rules that would produce an identical request/assertion combination, and confirm only one scenario is retained (SC-004)

**Checkpoint**: All three user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T036 [P] Add clear frontend error messaging for the `invalid_api_model` 400 response in `frontend/src/pages/SpecificationUploadPage.tsx`
- [X] T037 [P] Add a documented maximum-traversal-depth safeguard (mirroring `buildApiModel.ts`'s `MAX_SCHEMA_DEPTH`) to `generateTestModel.ts`'s recursive field traversal, guarding against adversarially deep, non-circular schemas
- [X] T038 Final pass on root `README.md` for the "Deterministic Test Designer" section
- [X] T039 [P] Performance test in `backend/tests/unit/testDesign/generateTestModel.performance.test.ts`: generate a synthetic 50-100 operation `ApiModel` and assert `generateTestModel` completes in under 30 seconds (SC-001)
- [X] T040 Execute the full [quickstart.md](./quickstart.md) validation checklist end-to-end and confirm every item passes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion only
- **User Story 2 (Phase 4)**: Depends on Foundational completion; extends the UI shell and `testModelsClient.ts` introduced in US1
- **User Story 3 (Phase 5)**: Depends on Foundational completion; extends `generateTestModel.ts` introduced in US1
- **Polish (Phase 6)**: Depends on all three user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P2)**: Builds on the scenario data and UI shell introduced by US1 (same components, later tasks) — independently testable once its own tasks are done
- **User Story 3 (P3)**: Builds on the same `generateTestModel.ts` pipeline — independently testable once its own tasks are done

### Within Each User Story

- Tests before implementation (T009-T012 before T013-T026; T027-T028 before T029-T031; T032 before T033-T035)
- Shared/domain types before consumers
- Rule modules before orchestrator wiring, before the endpoint, before the frontend
- Story complete before moving to the next priority

### Parallel Opportunities

- T001 and T002 (Setup) can run in parallel
- T005 and T006 (Foundational) can run in parallel once T005 exists; T004 can run in parallel with T005/T006
- T009-T012 (US1 tests) can be written in parallel once T001/T002 fixtures exist
- T013-T020 (all eight US1 rule modules) can be implemented in parallel — each is a separate file with no dependency on the others
- T024 (US1 frontend client) can run in parallel with T013-T023 (backend)
- T027-T028 (US2 tests) can run in parallel with each other
- T032 (US3 test) can run in parallel with US1/US2 polish work
- T036 and T037 in Polish can run in parallel

---

## Parallel Example: User Story 1

```bash
# All eight rule modules are independent files and can be implemented in parallel:
Task: "Implement positiveScenario.ts in backend/src/testDesign/rules/positiveScenario.ts"
Task: "Implement requiredFieldScenarios.ts in backend/src/testDesign/rules/requiredFieldScenarios.ts"
Task: "Implement invalidTypeScenarios.ts in backend/src/testDesign/rules/invalidTypeScenarios.ts"
Task: "Implement invalidFormatScenarios.ts in backend/src/testDesign/rules/invalidFormatScenarios.ts"
Task: "Implement invalidEnumScenarios.ts in backend/src/testDesign/rules/invalidEnumScenarios.ts"
Task: "Implement numericBoundaryScenarios.ts in backend/src/testDesign/rules/numericBoundaryScenarios.ts"
Task: "Implement stringBoundaryScenarios.ts in backend/src/testDesign/rules/stringBoundaryScenarios.ts"
Task: "Implement arrayBoundaryScenarios.ts in backend/src/testDesign/rules/arrayBoundaryScenarios.ts"

# Frontend client can be built in parallel with the backend rule modules:
Task: "Implement testModelsClient.ts in frontend/src/services/testModelsClient.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Generate a baseline suite for the fixture `ApiModel`s and confirm the expected scenario categories appear for each operation
5. This is a demoable MVP: "ApiPilot generates a deterministic baseline test suite from an analyzed specification"

### Incremental Delivery

1. Complete Setup + Foundational → domain types and rule infrastructure ready
2. Add User Story 1 → Validate manually → Demo (MVP!)
3. Add User Story 2 → Validate manually → Demo (every scenario is explainable, not a black box)
4. Add User Story 3 → Validate manually → Demo (the suite stays clean as specifications grow)
5. Polish → Final quickstart validation

### Parallel Team Strategy

With multiple developers, after Setup + Foundational are done:

- Developer A: User Story 1 rule modules + endpoint (T013-T023)
- Developer B: User Story 1 frontend (T024-T025), then User Story 2 (T029-T031) once US1's UI shell exists
- Developer C: User Story 3 (T032-T035), starting once Foundational's `generateTestModel.ts` skeleton (T008) exists
