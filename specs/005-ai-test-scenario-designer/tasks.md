---
description: "Task list for AI Test Scenario Designer implementation"
---

# Tasks: AI Test Scenario Designer

**Input**: Design documents from `/specs/005-ai-test-scenario-designer/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), and [contracts/](contracts/)

**Tests**: Included because the feature specification and quickstart require unit, integration, and contract validation.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an incremental slice.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing workspace and test surfaces are ready for AP-005 changes.

- [x] T001 Review the current shared-domain exports, AIProvider contract, deterministic TestModel generator, deduplicate helper, and Express route registration in `packages/shared-domain/src/index.ts`, `packages/shared-domain/src/aiProvider.ts`, `backend/src/testDesign/generateTestModel.ts`, `backend/src/testDesign/deduplicate.ts`, and `backend/src/app.ts`; record any incompatibilities with the AP-005 plan in `specs/005-ai-test-scenario-designer/research.md`
- [x] T002 [P] Add AP-005 fixture inputs for a valid operation, nested request schema, documented responses, and deterministic baseline scenarios in `backend/tests/fixtures/testDesign/aiScenarioDesignerFixtures.ts`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared contracts and reusable validation primitives before story-specific orchestration.

**CRITICAL**: Complete this phase before implementing any user story.

- [x] T003 Extend `Provenance` in `packages/shared-domain/src/testModel.ts` with the `AI` source discriminator and additive AI rationale, confidence, model/provider, assumptions, and duplicate-candidate fields while preserving existing RULE scenario compatibility
- [x] T004 Add the framework-independent AP-005 contracts in `packages/shared-domain/src/aiScenarioDesign.ts` for `AIScenarioCandidate`, validation findings, candidate outcome partitions, provider outcome, and `EnhancementResult`, then export them from `packages/shared-domain/src/index.ts`
- [x] T005 [P] Add shared-domain type tests covering AI provenance required fields, bounded confidence representation, enhancement outcome partitions, and backward-compatible RULE provenance in `packages/shared-domain/tests/unit/ai-scenario-design.test.ts`
- [x] T006 Define the versioned structured AI scenario response shape and deterministic prompt/context construction in `backend/src/testDesign/aiScenarioPrompt.ts`, using only the supplied `ApiModel` and deterministic `TestModel` and excluding unnecessary sensitive content
- [x] T007 Implement typed provider-response parsing and safe error mapping for malformed content and `AIErrorCategory` results in `backend/src/testDesign/parseAIScenarioResponse.ts`, without allowing partial unvalidated candidates through
- [x] T008 [P] Add the shared test-design validation utilities for allowed semantic categories, confidence bounds, non-empty rationale, candidate IDs, and safe validation findings in `backend/src/testDesign/validateAICandidate.ts`
- [x] T009 Run the shared-domain and backend TypeScript builds after foundational contract changes and resolve any type/export errors before beginning user story work

## Phase 3: User Story 1 - Enrich Deterministic Coverage With Semantic Scenarios (Priority: P1) 🎯 MVP

**Goal**: Request semantic AI candidates for an analyzed API and add only candidates that can be mapped to existing API operations and supported test intent.

**Independent Test**: Submit a valid `ApiModel` and deterministic `TestModel` to the enhancement service with a provider response containing a supported semantic candidate; verify the candidate is structured, operation-linked, and added without replacing the deterministic baseline.

### Tests for User Story 1

- [x] T010 [P] [US1] Add unit tests for valid candidate parsing, supported semantic categories, and provider request construction in `backend/tests/unit/testDesign/aiScenarioPrompt.test.ts`
- [x] T011 [P] [US1] Add unit tests for structural candidate validation and operation/field/status-code reference validation in `backend/tests/unit/testDesign/validateAICandidate.test.ts`
- [x] T012 [P] [US1] Add unit tests for converting a validated candidate into an AI-provenanced `TestScenario` in `backend/tests/unit/testDesign/aiScenarioCandidate.test.ts`

### Implementation for User Story 1

- [x] T013 [US1] Implement structural and ApiModel semantic validation for candidate operation paths, methods, parameter locations, request fields, response fields, schemas, documented status codes, and supported request/assertion values in `backend/src/testDesign/validateAICandidate.ts`
- [x] T014 [US1] Implement validated candidate-to-scenario conversion with explicit AI provenance, bounded confidence, rationale, assumptions, provider/model identity, and stable candidate-derived scenario identity in `backend/src/testDesign/aiScenarioCandidate.ts`
- [x] T015 [US1] Implement the core enhancement orchestration in `backend/src/testDesign/enhanceTestModel.ts` to build the provider request, call only `AIProvider`, parse/validate candidates, retain the deterministic baseline, and return structured candidate outcomes
- [x] T016 [US1] Add the stateless `POST /api/test-models/enhance` route adapter with minimal request-shape validation and safe response mapping in `backend/src/api/enhancedTestModels.ts`
- [x] T017 [US1] Register `enhancedTestModelsRouter` under `/api` in `backend/src/app.ts` without moving domain logic into the Express route
- [x] T018 [US1] Add integration coverage for a valid enhancement request returning structured AI candidates and an enhanced TestModel in `backend/tests/integration/enhancedTestModels.test.ts`

**Checkpoint**: A valid semantic enhancement request works independently and preserves every deterministic baseline scenario.

## Phase 4: User Story 2 - Understand and Trust AI Suggestions (Priority: P2)

**Goal**: Make AI origin, rationale, confidence, assumptions, and unsupported inferences explicit in every returned candidate or outcome.

**Independent Test**: Process valid, low-confidence, and unsupported candidates and verify that executable candidates expose AI provenance while unsafe candidates remain non-executable with actionable findings.

### Tests for User Story 2

- [x] T019 [P] [US2] Add unit tests for AI provenance serialization, rationale, assumptions, model/provider identity, and confidence boundary values in `packages/shared-domain/tests/unit/ai-scenario-design.test.ts`
- [x] T020 [P] [US2] Add unit tests for low-confidence, missing-rationale, unsupported-reference, and unknown-category findings in `backend/tests/unit/testDesign/validateAICandidate.test.ts`
- [x] T021 [US2] Add integration assertions that successful and non-executable candidates expose distinguishable AI provenance and safe validation findings in `backend/tests/integration/enhancedTestModels.test.ts`

### Implementation for User Story 2

- [x] T022 [US2] Complete AI provenance mapping and candidate status partitioning in `backend/src/testDesign/enhanceTestModel.ts`, ensuring inferred information never receives RULE or specification provenance
- [x] T023 [US2] Enforce the documented confidence range, required rationale, explicit assumptions, and safe diagnostic message rules in `backend/src/testDesign/validateAICandidate.ts` and `backend/src/testDesign/parseAIScenarioResponse.ts`
- [x] T024 [US2] Document the AP-005 structured response and provenance guarantees in `specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md` and align response field names with the shared-domain contracts

**Checkpoint**: Users can distinguish executable AI-derived scenarios from deterministic scenarios and understand why unsafe candidates were withheld.

## Phase 5: User Story 3 - Preserve a Clean, Non-Duplicative Test Model (Priority: P3)

**Goal**: Merge validated AI scenarios with deterministic scenarios without duplicate executable requests or lost provenance.

**Independent Test**: Supply an AI candidate equivalent to a deterministic scenario and another equivalent to a prior AI candidate; verify one executable scenario remains for each equivalence group and all origins are traceable.

### Tests for User Story 3

- [x] T025 [P] [US3] Extend deduplication unit coverage for mixed RULE and AI provenance, deterministic-first retention, AI duplicate candidate tracking, and stable nested request/assertion equivalence in `backend/tests/unit/testDesign/deduplicate.test.ts`
- [x] T026 [P] [US3] Add enhancement orchestration tests for added, deterministic-duplicate, AI-duplicate, and stable-order outcome partitions in `backend/tests/unit/testDesign/enhanceTestModel.test.ts`
- [x] T027 [US3] Add integration coverage for duplicate AI candidates and verify the enhanced response contains one executable scenario with preserved contributing origins in `backend/tests/integration/enhancedTestModels.test.ts`

### Implementation for User Story 3

- [x] T028 [US3] Update `backend/src/testDesign/deduplicate.ts` to merge AI provenance separately from existing `duplicateOfRules` while retaining deterministic-first ordering and the existing canonical request/assertion key
- [x] T029 [US3] Implement added-versus-deduplicated candidate classification and stable outcome ordering in `backend/src/testDesign/enhanceTestModel.ts`
- [x] T030 [US3] Ensure AI scenario identity and duplicate reporting use stable candidate-derived values without rewriting supplied deterministic scenario IDs in `backend/src/testDesign/aiScenarioCandidate.ts`

**Checkpoint**: The enhanced TestModel is clean, deterministic for equivalent inputs, and fully traceable across RULE and AI origins.

## Phase 6: User Story 4 - Continue Using the Feature When AI Is Unavailable (Priority: P4)

**Goal**: Preserve the deterministic baseline and clearly report provider, timeout, malformed-response, and semantic-validation failures.

**Independent Test**: Exercise enhancement with an unavailable provider, timeout, malformed response, and invalid candidate; verify the baseline is unchanged and each failure is distinguishable.

### Tests for User Story 4

- [x] T031 [P] [US4] Add unit tests for provider unavailable, timeout, invalid-response, and partial-response handling in `backend/tests/unit/testDesign/enhanceTestModel.test.ts`
- [x] T032 [P] [US4] Add integration tests for explicit degradation responses, unchanged deterministic scenarios, invalid request `400`, and non-POST `405` behavior in `backend/tests/integration/enhancedTestModels.test.ts`

### Implementation for User Story 4

- [x] T033 [US4] Map `AIErrorCategory` values to explicit AP-005 provider outcomes and safe actionable messages in `backend/src/testDesign/enhanceTestModel.ts`
- [x] T034 [US4] Ensure provider failures and malformed/partial responses bypass candidate assembly and return the original deterministic TestModel in `backend/src/testDesign/enhanceTestModel.ts`
- [x] T035 [US4] Complete request validation and method handling for the enhancement contract in `backend/src/api/enhancedTestModels.ts`, including the documented `invalid_test_model_enhancement_request` error shape
- [x] T036 [US4] Align the enhancement API contract examples and degradation rules with the implemented status/outcome behavior in `specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md`

**Checkpoint**: AI failure never hides or replaces deterministic coverage and users receive an explicit recoverable outcome.

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete AP-005 boundary, documentation, security, and regression behavior.

- [x] T037 [P] Add contract-focused assertions for request/response shapes and safety rules described in `specs/005-ai-test-scenario-designer/contracts/enhanced-test-models-api.md` to `backend/tests/integration/enhancedTestModels.test.ts`
- [x] T038 [P] Review AP-005 prompt construction and diagnostics for unnecessary raw specification, credential, prompt, or provider-response logging in `backend/src/testDesign/aiScenarioPrompt.ts`, `backend/src/testDesign/enhanceTestModel.ts`, and `backend/src/api/enhancedTestModels.ts`
- [x] T039 Run the AP-005 quickstart validation from `specs/005-ai-test-scenario-designer/quickstart.md` and update the guide if command paths or expected outcomes differ
- [x] T040 Run the repository-wide `npm test`, `npm run lint`, and `npm run build`; resolve only AP-005 regressions and record unrelated pre-existing failures in the implementation report
- [x] T041 Review the final AP-005 implementation against `spec.md`, `plan.md`, `data-model.md`, `research.md`, and the constitution, then document any remaining limitation in `specs/005-ai-test-scenario-designer/quickstart.md`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001-T002 can start immediately; T001 informs the implementation surface and T002 prepares fixtures.
- **Foundational (Phase 2)**: T003-T009 depend on the setup review where relevant and block all user stories. T003-T008 can be split by file after the design review; T009 runs after shared type/export edits.
- **User Story 1 (Phase 3)**: Depends on Phase 2 and delivers the MVP enhancement path.
- **User Story 2 (Phase 4)**: Depends on US1's candidate conversion and enhancement result, especially T014-T016; its validation coverage can be developed alongside late US1 integration work when files do not overlap.
- **User Story 3 (Phase 5)**: Depends on US1's conversion/orchestration and US2's provenance fields; it extends the existing deduplication boundary.
- **User Story 4 (Phase 6)**: Depends on US1's route/orchestration and AP-004 provider error contracts; it hardens failure behavior without changing the baseline generator.
- **Polish (Phase 7)**: Depends on all desired user stories.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational; this is the recommended MVP scope.
- **US2 (P2)**: Depends on US1's enhancement result and candidate conversion; independently validates provenance and safety once that boundary exists.
- **US3 (P3)**: Depends on US1's scenario conversion and US2's AI provenance extension; uses the existing deterministic deduplication contract.
- **US4 (P4)**: Depends on US1's route and provider invocation; can be implemented independently of US3's duplicate reporting after the shared result shape is stable.

### Parallel Opportunities

- T002, T005, and T008 can proceed in parallel after T001 because they touch separate fixture, shared-test, and backend-validation files.
- T010-T012 can proceed in parallel because they cover separate focused test files.
- T019-T020 can proceed in parallel; T021 follows the shared provenance behavior.
- T025-T026 can proceed in parallel because they target separate unit-test surfaces.
- T031-T032 can proceed in parallel because they target separate unit/integration test surfaces.
- T037-T038 can proceed in parallel during final review.
- Different user stories can be assigned to separate developers after foundational contracts stabilize, but shared files such as `enhanceTestModel.ts` require coordinated ownership.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup and Phase 2 shared contracts/validation.
2. Implement US1 structural and semantic candidate validation, conversion, orchestration, and endpoint.
3. Run US1 unit and integration tests.
4. Stop at the US1 checkpoint to demonstrate deterministic coverage enhanced by validated AI candidates.

### Incremental Delivery

1. Add US2 provenance and confidence visibility without changing the executable baseline contract.
2. Add US3 deterministic mixed-origin deduplication and traceability.
3. Add US4 provider degradation and baseline-preservation behavior.
4. Complete Phase 7 repository-wide validation and specification traceability review.

## Notes

- Every task uses the required checklist format with a sequential ID and exact file path.
- `[P]` marks only tasks that can proceed in parallel without depending on incomplete work in the same file.
- Tests use the existing deterministic mock provider; real-model tests remain opt-in.
- No task authorizes execution, approval, artifact generation, cloud fallback, persistence, or direct inference-runtime imports.

## Phase 8: Convergence

- [ ] T042 Complete ApiModel semantic validation for request-body field paths, request parameter/body keys and values, response fields and schemas, authentication references, and supported assertion content per FR-007 and FR-009 (partial)
- [ ] T043 Enforce unique non-empty candidate IDs and the documented low-confidence/non-executable policy, with findings for missing, duplicate, malformed, and out-of-range metadata per FR-014 and US2/AC3 (partial)
- [ ] T044 Make partial or mixed-invalid provider responses all-or-nothing at model assembly and add explicit unavailable, timeout, malformed, partial, and semantically invalid degradation coverage per FR-015 and US4/AC1-AC2 (partial)
- [x] T045 Preserve and report every contributing AI candidate identity for deterministic and AI duplicate groups, then verify deterministic-first retention and stable nested request/assertion equivalence per FR-010 and US3/AC1-AC2 (partial)
- [x] T046 Add a controlled provider seam for the enhancement route and integration assertions for valid structured responses, candidate partitions, AI provenance, and unchanged baseline responses per FR-016 and the enhanced-test-models API contract (missing)
- [x] T047 Verify repeated enhancement produces stable request identity, scenario identity, ordering, and outcome partitions for equivalent provider output per FR-013 and SC-006 (missing)
- [x] T048 Review the unreferenced `packages/shared-domain/src/index-types.ts` compatibility indirection and remove it or document its architectural justification per plan: project structure (unrequested)
