---

description: "Task list for AP-008 API Dependency & Integration Workflow Engine"
---

# Tasks: API Dependency & Integration Workflow Engine

**Input**: Design documents from `/specs/008-dependency-workflow-engine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-dependency-workflow-api.md, quickstart.md

**Tests**: Test tasks ARE included. plan.md names the test surfaces explicitly (Vitest in the backend and shared-domain workspaces, Supertest for the endpoint, dedicated determinism and performance tests), and contracts/api-dependency-workflow-api.md lists guarantees to be asserted by contract tests.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently. Per plan.md and research.md, this feature adds no frontend code — relationship/workflow review UI is out of scope (delegated to AP-006's extension).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Web application in an npm-workspaces monorepo, per plan.md: `backend/src/`, `packages/shared-domain/src/`, with tests under each workspace's `tests/` directory. `vitest.workspace.ts` already includes `tests/**/*.test.ts` in every workspace, so no test-runner configuration is needed for the new folders.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the dependency/workflow domain contracts and shared test fixtures. No dependencies are added — plan.md's Technical Context specifies zero new packages.

- [X] T001 Create the dependency/workflow contract module in `packages/shared-domain/src/apiDependency.ts` with the types from data-model.md: `FieldRef`, `DeterministicDependencyEvidence`, `AIDependencyCorroboration`, `DependencyConfidence`, `ApiDependencyRelationship`, `ApiDependencyGraph`, `WorkflowVariable`, `WorkflowStep`, `IntegrationWorkflow`, `ManualConfirmationCandidate`, `DependencyCycleFinding`, `DependencyAnalysisResult`, and the failure-outcome codes; keep the module framework-agnostic and do not modify `ApiModel`, `TestModel`, `TestScenario`, or `Provenance`
- [X] T002 Re-export the new contracts from `packages/shared-domain/src/index.ts` alongside the existing `export * from "./postmanArtifact"` line
- [X] T003 [P] Add dependency-analysis test fixtures in `backend/tests/fixtures/dependencies/dependencyFixtures.ts`: a CRUD-chain `ApiModel` (`POST /users` returning `id`, `GET/PUT/DELETE /users/{userId}` consuming `userId`, shared tag `users`), an unrelated-name-collision `ApiModel` (`name` on both a `User` and a `Product` schema with no other supporting evidence), a nested-identifier `ApiModel` (a response shaped `{ user: { id } }` consumed by a later path parameter), a cyclic `ApiModel` (two operations whose relationships point back at each other), a dissimilar-name `ApiModel` for AI detection (`POST /accounts` returning `accountId`, `POST /transfers` consuming `accountRef` with no deterministic name/type overlap), and a 200-operation `ApiModel` for the performance test

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The content-derived identifier and field-discovery primitives every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Unit test for content-derived identifiers in `backend/tests/unit/dependencies/identifiers.test.ts`: the same producer/consumer field-ref tuple always yields the same relationship id, a different tuple yields a different id, a workflow id is a pure function of its ordered relationship-id list, and no identifier changes between two calls in the same process
- [X] T005 [P] Unit test for field extraction in `backend/tests/unit/dependencies/fieldExtraction.test.ts`: producer candidate fields come only from 2xx response schemas (never 4xx/5xx), consumer candidate fields come from path/query/header parameters and the request-body schema via `walkFields`, a parameter that is part of a declared security requirement for that operation is excluded from consumer candidates, and the nested-identifier fixture's `user.id`-shaped field is discovered as a dotted path
- [X] T006 [P] Contract shape test for the new shared-domain types in `packages/shared-domain/tests/unit/api-dependency.test.ts`, following the pattern of `packages/shared-domain/tests/unit/postman-artifact.test.ts`
- [X] T007 [P] Implement content-derived identifiers in `backend/src/dependencies/identifiers.ts` using Node's built-in `crypto` SHA-256 over the tuples research.md specifies; never call `randomUUID`, `Math.random`, or any time-based source
- [X] T008 [P] Implement field extraction in `backend/src/dependencies/fieldExtraction.ts`: 2xx-only response field discovery and request-side field discovery, both reusing `walkFields` from `backend/src/testDesign/requestHelpers.ts`, and parameter exclusion for fields covered by a declared security requirement

**Checkpoint**: Identifier and field-discovery primitives are in place — user story implementation can begin.

---

## Phase 3: User Story 1 - Discover How My APIs Relate (Priority: P1) 🎯 MVP

**Goal**: Analyze an `ApiModel` and report deterministically classified, explained candidate relationships between operations — CONFIRMED, LIKELY, or POSSIBLE, never CONFIRMED/LIKELY from a name match alone.

**Independent Test**: Post the CRUD-chain fixture `ApiModel` to `POST /api/api-models/dependencies` and confirm the response reports a relationship between `POST /users` and `GET /users/{userId}` naming the producing field, the consuming field, and a confidence classification; post the unrelated-name-collision fixture and confirm its relationship is never above POSSIBLE; post an `ApiModel` with no candidate relationships and confirm an explicit empty result.

### Tests for User Story 1

> **NOTE: Write these tests FIRST and confirm they fail before implementing.**

- [X] T009 [P] [US1] Unit test for deterministic matching and classification in `backend/tests/unit/dependencies/deterministicMatching.test.ts`: each of the five evidence signals (name, type, format, resource/path relationship, tag alignment) is computed correctly against the fixtures; the classification table from data-model.md is applied exactly and exhaustively (CONFIRMED requires name + resource relationship + type-or-format; LIKELY and POSSIBLE combinations as tabulated, including the two-or-more-non-resource-signals case); the unrelated-name-collision fixture never classifies above POSSIBLE (FR-003, SC-002); every relationship's `explanation` names the specific evidence signals used (FR-007)
- [X] T010 [P] [US1] Unit test for deterministic-only orchestration in `backend/tests/unit/dependencies/analyzeDependencies.test.ts`: the CRUD-chain fixture produces the expected CONFIRMED relationship(s) with `source: "deterministic"`; an `ApiModel` with no candidate relationships returns an explicit empty `graph.relationships` (FR-009); `aiOutcome` is `"skipped"` when no `AIProvider` is supplied
- [X] T011 [P] [US1] Determinism test in `backend/tests/unit/dependencies/determinism.test.ts`: analyzing the CRUD-chain fixture twice in one process yields an identical serialized `graph`, and analyzing it again with the `ApiModel.operations` array shuffled yields the same relationships (FR-010, SC-003)
- [X] T012 [P] [US1] Integration test in `backend/tests/integration/apiDependencies.test.ts` using Supertest, following `backend/tests/integration/enhancedTestModels.test.ts`: `200` with the contract's response shape for the CRUD-chain fixture, `400 invalid_request` for a body missing `apiModel` or with the wrong shape, `405` for non-POST, and an identical response body for a repeated identical request

### Implementation for User Story 1

- [X] T013 [P] [US1] Implement deterministic matching, the five-signal evidence computation, the classification table, and the deterministic explanation text in `backend/src/dependencies/deterministicMatching.ts` (depends on T008)
- [X] T014 [US1] Implement `backend/src/dependencies/analyzeDependencies.ts`: orchestrate field extraction and deterministic matching into a `DependencyAnalysisResult` with `graph.relationships` populated, `workflows`/`manualConfirmationCandidates`/`cycles` empty (populated in User Story 2), a content-derived `requestId`, and `aiOutcome: "skipped"` (depends on T007, T013)
- [X] T015 [US1] Implement the thin route adapter in `backend/src/api/apiDependencies.ts` for `POST /api/api-models/dependencies`, following the request-shape guard and `405` handling in `backend/src/api/specifications.ts`/`backend/src/api/enhancedTestModels.ts`; keep all analysis logic out of the route (depends on T014)
- [X] T016 [US1] Register the router in `backend/src/app.ts` alongside the existing `/api` routers (depends on T015)

**Checkpoint**: An `ApiModel` can be analyzed end to end through the API and returns classified, explained deterministic relationships. MVP is complete and independently testable.

---

## Phase 4: User Story 2 - Turn Related APIs into a Runnable Sequence (Priority: P1)

**Goal**: Assemble CONFIRMED/LIKELY relationships into ordered, multi-step workflows with explicit variable hand-offs; resolve multiple candidate producers deterministically (FR-013a); detect and report cycles rather than producing contradictory ordering (FR-014); surface POSSIBLE relationships and disambiguation-excluded relationships as candidates requiring manual confirmation (FR-012) instead of assembling or discarding them; fail explicitly rather than hang or return a partial result when the analysis cannot complete within its performance budget (SC-008).

**Independent Test**: Supply the CRUD-chain fixture's relationships to workflow assembly and confirm the four steps are ordered so no step consumes a value before the step that produces it, with a named variable stating the hand-off; supply the cyclic fixture and confirm the cycle is reported explicitly with no workflow produced across it.

### Tests for User Story 2

- [X] T017 [P] [US2] Unit test for producer disambiguation in `backend/tests/unit/dependencies/mergeRelationships.test.ts`: when two CONFIRMED/LIKELY relationships could supply the same consuming field, the tie-break in research.md (confidence rank, then evidence-signal count, then producer path/method/field) resolves to exactly one producer deterministically and repeatably, and the excluded candidate is returned for reporting rather than discarded
- [X] T018 [P] [US2] Unit test for cycle detection in `backend/tests/unit/dependencies/buildDependencyGraph.test.ts`: Kahn's algorithm correctly identifies the cyclic fixture's relationships as a cycle, an acyclic relationship set reports no cycles, and the operations/relationships involved in a detected cycle are excluded from the graph passed to workflow assembly
- [X] T019 [P] [US2] Unit test for workflow assembly in `backend/tests/unit/dependencies/assembleWorkflows.test.ts`: the CRUD-chain fixture assembles into one ordered `IntegrationWorkflow` whose `variables` correctly name each producer/consumer hand-off and whose `relationshipIds` trace back to the originating relationships; a POSSIBLE relationship never appears inside an assembled workflow and instead appears in `manualConfirmationCandidates` with reason `"possible-confidence"`; a relationship excluded by producer disambiguation appears in `manualConfirmationCandidates` with reason `"excluded-by-disambiguation"`; an operation that is a valid next step for two divergent chains produces two separate workflows; a chain exceeding `MAX_WORKFLOW_STEPS` is reported explicitly rather than silently truncated
- [X] T020 [US2] Extend `backend/tests/unit/dependencies/determinism.test.ts` (T011) with workflow-level assertions: assembling the same relationship set twice yields identical `workflows`, `variables`, and `relationshipIds`, including under shuffled relationship input order (FR-016, SC-003)
- [X] T021 [US2] Extend `backend/tests/integration/apiDependencies.test.ts` (T012): the CRUD-chain fixture's response includes the assembled workflow with correctly ordered steps and variables, and the cyclic fixture's response reports the cycle under `cycles` with no workflow spanning it

### Implementation for User Story 2

- [X] T022 [P] [US2] Implement `resolveProducerDisambiguation` (FR-013a) in `backend/src/dependencies/mergeRelationships.ts` per the tie-break rule in research.md
- [X] T023 [US2] Implement `backend/src/dependencies/buildDependencyGraph.ts`: build the operation-level directed graph from disambiguated CONFIRMED/LIKELY relationships and run Kahn's-algorithm cycle detection, returning the acyclic edge set plus `DependencyCycleFinding[]` (depends on T022)
- [X] T024 [US2] Implement `backend/src/dependencies/assembleWorkflows.ts`: bounded maximal-path depth-first enumeration (default `MAX_WORKFLOW_STEPS = 10`) over the acyclic graph, producing `IntegrationWorkflow[]` with `WorkflowStep`/`WorkflowVariable` entries and content-derived ids from `identifiers.ts`, plus `ManualConfirmationCandidate[]` for POSSIBLE relationships and disambiguation exclusions (depends on T007, T023)
- [X] T025 [US2] Extend `backend/src/dependencies/analyzeDependencies.ts` to call disambiguation, graph building, and workflow assembly, populating `workflows`, `manualConfirmationCandidates`, and `cycles` on the result (depends on T014, T024)
- [X] T026 [US2] Unit test for the analysis timeout guard in `backend/tests/unit/dependencies/analyzeDependencies.timeout.test.ts`: a pathological/oversized fixture that cannot complete deterministic analysis and workflow assembly within the performance budget causes `analyzeDependencies` to reject with a distinguishable `analysis_timeout` outcome rather than hanging or returning a partial result (SC-008)
- [X] T027 [US2] Implement an explicit timeout guard around the deterministic analysis and workflow assembly pipeline in `backend/src/dependencies/analyzeDependencies.ts`, and map it to a `500 analysis_timeout` response in `backend/src/api/apiDependencies.ts` per contracts/api-dependency-workflow-api.md (depends on T025, T015)

**Checkpoint**: Confident relationships become ordered, explainable, deterministic workflows; cycles and low-confidence candidates are surfaced rather than hidden or guessed; a pipeline that cannot finish in budget fails explicitly. User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Understand Why a Relationship or Workflow Was Suggested (Priority: P2)

**Goal**: Extend detection with one batched AI-assisted semantic pass for relationships deterministic matching cannot find, merge any AI-found duplicate of a deterministic relationship into one relationship rather than reporting both (FR-006a), reject AI suggestions that reference a nonexistent field or operation (FR-008), and ensure every relationship's explanation clearly distinguishes deterministic evidence from AI inference.

**Independent Test**: Run analysis over the dissimilar-name fixture (`accountRef` / `accountId`) with a fake `AIProvider` returning a matching candidate, and confirm the relationship appears with `source: "ai"`, a confidence no higher than LIKELY, and an explanation naming the AI model, confidence, and rationale; run the same analysis with a fake provider returning a candidate that references a nonexistent field, and confirm it never appears in the result; run with a provider that throws/times out and confirm deterministic relationships are still returned with `aiOutcome` reporting the failure.

### Tests for User Story 3

- [X] T028 [P] [US3] Unit test for AI prompt construction in `backend/tests/unit/dependencies/aiDependencyPrompt.test.ts`: exactly one `InferenceRequest` is built per analysis from the `ApiModel`'s operations and candidate fields, `contractVersion` and `expectedOutputFormat` match the `AIProvider` contract, and `timeoutMs` is set to the feature-specific 8000ms override rather than left unset (research.md)
- [X] T029 [P] [US3] Unit test for AI response parsing in `backend/tests/unit/dependencies/parseAIDependencyResponse.test.ts`: a valid JSON candidate list parses into `AIDependencyCandidate[]`; malformed JSON or a non-list payload produces a distinguishable parse failure rather than throwing
- [X] T030 [P] [US3] Unit test for AI candidate validation in `backend/tests/unit/dependencies/validateAIDependencyCandidate.test.ts`: shape validation rejects a candidate missing required fields or with `aiConfidence` outside `[0, 1]`; semantic validation rejects a candidate referencing an operation or field absent from the `ApiModel` (FR-008); a duplicate `candidateId` within one response is rejected
- [X] T031 [US3] Extend `backend/tests/unit/dependencies/mergeRelationships.test.ts` (T017) with `mergeDeterministicAndAI` cases: the same field pair found by both passes merges into one relationship with `source: "deterministic+ai"`, the deterministic classification unchanged and `aiCorroboration` attached; the dissimilar-name fixture's AI-only relationship is classified LIKELY when `aiConfidence >= 0.85` and POSSIBLE otherwise, and never CONFIRMED from AI alone
- [X] T032 [US3] Extend `backend/tests/unit/dependencies/deterministicMatching.test.ts` (T009) and `mergeRelationships.test.ts` (T017) with explanation-content assertions: every relationship's `explanation` names its specific deterministic evidence or its AI model/confidence/rationale, and an AI-derived explanation is worded as an inference, never as confirmed specification fact (FR-007, constitution III)
- [X] T033 [US3] Extend `backend/tests/integration/apiDependencies.test.ts` (T012, T021), using a local fake `AIProvider` test double following the pattern in `backend/tests/unit/testDesign/enhanceTestModel.test.ts` (not the generic `MockProvider`, whose canned output is not shaped like an `AIDependencyCandidate`): a provider returning a valid dissimilar-name candidate yields `aiOutcome: "success"` and the merged/AI relationship in the response; a provider that throws or exceeds the 8-second timeout yields `200` with deterministic relationships intact and `aiOutcome` of `"unavailable"`/`"timeout"`/`"invalid-response"` as appropriate (FR-018); a provider returning a candidate referencing a nonexistent field never surfaces it in the response (FR-008)
- [X] T034 [P] [US3] Performance test in `backend/tests/unit/dependencies/performance.test.ts`, following `backend/tests/unit/testDesign/generateTestModel.performance.test.ts`: the 200-operation fixture completes full analysis (deterministic matching plus one mock AI call) in under 15 seconds (SC-008), asserting the target rather than assuming it

### Implementation for User Story 3

- [X] T035 [P] [US3] Implement `backend/src/dependencies/aiDependencyPrompt.ts`: build the single batched `InferenceRequest` from the `ApiModel`'s operations and candidate fields, with `timeoutMs: 8000` (depends on T008)
- [X] T036 [P] [US3] Implement `backend/src/dependencies/parseAIDependencyResponse.ts`: parse raw AI JSON content into `AIDependencyCandidate[]`, distinguishing a parse failure from an empty candidate list
- [X] T037 [US3] Implement `backend/src/dependencies/validateAIDependencyCandidate.ts`: shape validation and semantic validation against the `ApiModel` (operation exists, field exists, confidence in range, no duplicate candidate id within the response), mirroring `backend/src/testDesign/validateAICandidate.ts`'s two-stage pattern (depends on T036)
- [X] T038 [US3] Implement `mergeDeterministicAndAI` (FR-006a) and the AI/merged explanation text in `backend/src/dependencies/mergeRelationships.ts`: key relationships by resolved field pair, merge same-key deterministic and AI candidates keeping the deterministic classification primary, and classify AI-only candidates per the confidence-cap rule in data-model.md (depends on T022, T037)
- [X] T039 [US3] Extend `backend/src/dependencies/analyzeDependencies.ts` to accept an optional `AIProvider`, issue the AI call with its request-scoped timeout, categorize failures the same way `backend/src/testDesign/enhanceTestModel.ts` does (`success` / `unavailable` / `timeout` / `invalid-response`), and merge AI candidates via `mergeDeterministicAndAI` before workflow assembly (depends on T027, T038)
- [X] T040 [US3] Extend `backend/src/api/apiDependencies.ts` with an injectable `AIProvider`, following `createEnhancedTestModelsRouter`'s pattern (`createApiDependenciesRouter(provider = getAIProvider())` plus a default `apiDependenciesRouter` export) (depends on T015, T039)
- [X] T041 [US3] Update the router wiring in `backend/src/app.ts` to use `createApiDependenciesRouter(provider)` when a provider override is supplied, mirroring the existing `enhancedTestModelsRouter` wiring (depends on T016, T040)

**Checkpoint**: Dependency analysis now includes AI-assisted semantic detection, merged and explained alongside deterministic evidence, with explicit graceful degradation. All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T042 [P] No-network test in `backend/tests/unit/dependencies/noNetwork.test.ts`, following `backend/tests/unit/postman/noNetwork.test.ts`: analysis issues no request — stub `globalThis.fetch` and `node:http`/`node:https` request entry points to fail the test if called (FR-019, SC-009)
- [X] T043 [P] Diagnostics safety test in `backend/tests/integration/apiDependenciesDiagnostics.test.ts`: no response body and no logged message produced during analysis (success, AI failure, or `400`) contains specification content, an AI prompt, or an AI response body — only request id, operation counts, duration, and `aiOutcome`-style categories (FR-020)
- [X] T044 [P] Document the capability in `README.md` alongside the existing AP-00x sections: the endpoint, the confidence model, the module boundaries under `backend/src/dependencies/`, and the explicit statement that this feature never executes a discovered relationship or workflow
- [X] T045 Run the quickstart validation in `specs/008-dependency-workflow-engine/quickstart.md`, including the AI-degradation and no-network manual checks
- [X] T046 Run `npm test`, `npm run lint`, and `npm run build` from the repository root and resolve every failure without weakening TypeScript or ESLint configuration and without disabling tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — no dependency on other stories
- **User Story 2 (Phase 4)**: Depends on Foundational; extends `analyzeDependencies.ts` created in US1, so run after US1 when worked sequentially
- **User Story 3 (Phase 5)**: Depends on Foundational; extends `analyzeDependencies.ts`, `mergeRelationships.ts`, `apiDependencies.ts`, and `app.ts` touched in US1/US2
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### Within Each User Story

- Tests are written first and must fail before implementation
- Field/id primitives before matching; matching before orchestration; orchestration before the route; the route before router registration
- `identifiers.ts` and `fieldExtraction.ts` (T007, T008) precede every module that emits an id or reads candidate fields

### Story Independence Notes

US1 is fully independent and is the MVP. US2 and US3 each extend `analyzeDependencies.ts` rather than replacing it (and US3 further extends `mergeRelationships.ts`, `apiDependencies.ts`, and `app.ts` from US1/US2), so they remain independently testable but touch shared files — do not run US2 and US3 implementation tasks concurrently against `analyzeDependencies.ts`.

### Parallel Opportunities

- All Phase 1 and Phase 2 test tasks (T004–T006) run in parallel; T007 and T008 run in parallel
- Within each story, every test task marked [P] runs in parallel
- T013 (US1), T022 (US2), and T035/T036 (US3) are each new, self-contained modules and run in parallel with other in-progress work within their story
- With multiple developers: after Phase 2, US1 can start immediately; US2's `buildDependencyGraph.ts` groundwork and US3's `aiDependencyPrompt.ts`/`parseAIDependencyResponse.ts` can be drafted in parallel with US1 since they do not depend on US1's orchestration code, though final wiring into `analyzeDependencies.ts` must happen in story order

---

## Parallel Example: User Story 1

```bash
# Write all User Story 1 tests together, then confirm they fail:
Task: "Unit test for deterministic matching and classification in backend/tests/unit/dependencies/deterministicMatching.test.ts"
Task: "Unit test for deterministic-only orchestration in backend/tests/unit/dependencies/analyzeDependencies.test.ts"
Task: "Determinism test in backend/tests/unit/dependencies/determinism.test.ts"
Task: "Integration test in backend/tests/integration/apiDependencies.test.ts"

# Then the independent matching module:
Task: "Implement deterministic matching in backend/src/dependencies/deterministicMatching.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — identifier and field-discovery primitives block everything
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: analyze the CRUD-chain and unrelated-name-collision fixtures, confirm classifications match the fixed rule table and repeated analysis is identical
5. Demo the classified, explained relationship graph

### Incremental Delivery

1. Setup + Foundational → identifier and field-discovery primitives ready
2. Add US1 → classified, explained deterministic relationships (MVP)
3. Add US2 → ordered, explainable multi-step workflows with cycle detection and explicit timeout failure
4. Add US3 → AI-assisted semantic detection, merged and explained alongside deterministic evidence

---

## Notes

- [P] tasks = different files, no dependencies
- Every task in Phases 3–5 carries its story label for traceability
- No new dependency is introduced anywhere in this feature (plan.md, Technical Context)
- No frontend changes: relationship/workflow review UI is out of scope, delegated to AP-006's extension (spec.md, Out of Scope)
- AI-dependent tests use a local fake `AIProvider` test double (following `enhanceTestModel.test.ts`), not the generic `MockProvider`, whenever the test needs specific `AIDependencyCandidate` content
- Description-similarity and example-value evidence are deliberately not implemented (research.md): `ApiModel` carries no field-level description or example data to compare
- T026/T027 close the `analysis_timeout` gap identified in `/speckit-analyze`: the deterministic-analysis-plus-workflow-assembly pipeline now has an explicit, tested failure path for SC-008's "or fails explicitly" branch, distinct from the AI-specific timeout handled in US3
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
