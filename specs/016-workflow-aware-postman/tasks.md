---
description: "Implementation tasks for workflow-aware Postman generation"
---

# Tasks: Workflow-Aware Postman Generation

**Input**: Design documents from `specs/016-workflow-aware-postman/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Organization**: Tasks are grouped by user story so each story has a clear implementation and
validation boundary. Tests are included because the feature contract defines executable acceptance
scenarios and the repository requires regression coverage at domain, API, and workflow boundaries.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish reusable AP-016 fixtures and confirm the existing export test seam.

- [X] T001 [P] Add reusable two-step, multi-step, rejected, missing-scenario, and mixed workflow fixtures in `backend/tests/fixtures/postman/workflowFixtures.ts`
- [X] T002 [P] Add shared test helpers for flattening workflow folders, locating request items, and inspecting generated scripts in `backend/tests/fixtures/postman/workflowAssertions.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend the shared artifact contract and input validation before implementing any user story.

**Checkpoint**: The shared-domain build and existing AP-007 tests must remain valid before story work begins.

- [X] T003 Extend `GenerationLimitationKind`, `GenerationLimitation`, `ExportSummary`, `ExportFailureCode`, and related artifact types with workflow context, workflow provenance, and workflow count fields in `packages/shared-domain/src/postmanArtifact.ts`
- [X] T004 Add the optional `WorkflowExportContext` contract and export it from `packages/shared-domain/src/postmanArtifact.ts` and `packages/shared-domain/src/index.ts`
- [X] T005 Update export request validation and failure-status mapping for optional workflow context in `backend/src/api/postmanCollections.ts`
- [X] T006 Update the guided workflow export contract and stage response typing to carry `dependencyAnalysis.workflows` and `approvedWorkflowIds` without exposing unapproved workflow data as approved in `backend/src/testGenerationWorkflow/postmanGenerationStage.ts` and `backend/src/api/testGenerationWorkflow.ts`
- [X] T007 [P] Add shared-domain type coverage for valid, malformed, duplicate-ID, and unknown-approved-ID workflow contexts in `packages/shared-domain/tests/unit/postmanArtifact.test.ts`

---

## Phase 3: User Story 1 - Export Approved Workflows as Executable Sequences (Priority: P1) 🎯 MVP

**Goal**: Render explicitly approved, supported integration workflows as ordered Postman request sequences with deterministic response-value handoffs, while preserving standalone scenario export.

**Independent Test**: Submit an approved TestModel and an approved two-step IntegrationWorkflow; verify ordered workflow requests, producer extraction, consumer variable reference, rejection of unapproved workflows, and no duplicate standalone request for a rendered scenario.

### Tests for User Story 1

- [X] T008 [P] [US1] Add unit tests for deterministic scenario selection, contiguous step validation, operation matching, approved-workflow filtering, and atomic unsupported-workflow planning in `backend/tests/unit/postman/workflowRendering.test.ts`
- [X] T009 [P] [US1] Add integration tests for approved workflow folders, ordered requests, response extraction, consumer substitution, rejected workflows, mixed standalone scenarios, and duplicate prevention in `backend/tests/integration/postmanWorkflowCollection.test.ts`
- [X] T010 [P] [US1] Extend guided workflow integration coverage to verify approved workflow IDs reach Postman generation and affect the returned artifact in `backend/tests/integration/testGenerationWorkflow.test.ts`

### Implementation for User Story 1

- [X] T011 [US1] Implement deterministic workflow planning and supportability validation using `IntegrationWorkflow`, `WorkflowStep`, `WorkflowVariable`, `ApiModel`, and approved `TestScenario` inputs in `backend/src/postman/workflowRendering.ts`
- [X] T012 [US1] Implement stable workflow-scoped variable naming, response-field path handling, and consumer request value substitution for path, query, header, and body locations in `backend/src/postman/workflowVariables.ts`
- [X] T013 [US1] Extend assertion-script generation to append safe response extraction statements without removing existing assertion checks in `backend/src/postman/assertionScripts.ts`
- [X] T014 [US1] Extend request-item construction to accept workflow step metadata, apply workflow variable substitutions, preserve approved request data and assertions, and retain existing secret handling in `backend/src/postman/requestItem.ts`
- [X] T015 [US1] Integrate workflow planning, workflow folders, workflow request generation, standalone-scenario exclusion, deterministic ordering, and workflow summary counts into `backend/src/postman/generateCollection.ts` and `backend/src/postman/folders.ts`
- [X] T016 [US1] Pass the current workflow's dependency analysis and approved workflow IDs into artifact generation while preserving direct AP-007 calls without workflow context in `backend/src/testGenerationWorkflow/postmanGenerationStage.ts`
- [X] T017 [US1] Update the Postman export route and shared request contract handling so direct HTTP exports can provide optional workflow context in `backend/src/api/postmanCollections.ts` and `packages/shared-domain/src/postmanArtifact.ts`

**Checkpoint**: A supported approved workflow produces a deterministic ordered sequence, workflow decisions affect output, and all existing no-workflow exports still pass.

---

## Phase 4: User Story 2 - Understand Workflow Coverage and Limitations (Priority: P1)

**Goal**: Make rendered, omitted, unsupported, and traceability information visible in the generated summary and README without exposing sensitive data.

**Independent Test**: Export a supported workflow, an approved workflow missing scenario data, an unapproved workflow, and standalone scenarios; verify collection contents, summary counts, limitation details, provenance, and README coverage.

### Tests for User Story 2

- [X] T018 [P] [US2] Add tests for workflow limitation kinds, safe workflow/step/relationship references, rendered/unsupported/standalone summary counts, and README reporting in `backend/tests/unit/postman/workflowRendering.test.ts`
- [X] T019 [P] [US2] Extend export API integration tests for partial-limitation success responses, malformed workflow context, and explicit empty/failure outcomes in `backend/tests/integration/postmanWorkflowCollection.test.ts`
- [X] T020 [P] [US2] Add secret-safety regression coverage for workflow extraction names, request bodies, README content, diagnostics, and environment-only credential values in `backend/tests/integration/postmanWorkflowCollection.test.ts`

### Implementation for User Story 2

- [X] T021 [US2] Add workflow limitation metadata and safe failure messages for missing step scenarios, invalid sequence positions, unresolved handoffs, unsupported extraction paths, and unsupported workflow request representation in `packages/shared-domain/src/postmanArtifact.ts` and `backend/src/postman/workflowRendering.ts`
- [X] T022 [US2] Extend README generation with rendered workflow count, standalone count, handoff count, unsupported workflow count, omitted approval information, and workflow limitations in `backend/src/postman/readme.ts`
- [X] T023 [US2] Ensure workflow and standalone summary counts, limitation ordering, and traceability metadata are produced deterministically in `backend/src/postman/generateCollection.ts`
- [X] T024 [US2] Expose workflow-aware limitation and summary data through the existing export response and guided workflow artifact without adding a separate frontend API path in `backend/src/api/postmanCollections.ts` and `backend/src/api/testGenerationWorkflow.ts`

**Checkpoint**: Engineers can determine what workflow intent was rendered, omitted, or unsupported from the returned artifacts without inspecting sensitive payloads or server internals.

---

## Phase 5: User Story 3 - Reproduce and Safely Re-export Workflow Artifacts (Priority: P2)

**Goal**: Keep workflow artifacts stable across identical exports and restrict changes after review decisions to the affected workflow scope.

**Independent Test**: Export identical workflow input twice, change one workflow decision, export again, and verify identical first outputs plus removal of only the affected workflow content, variables, and documentation.

### Tests for User Story 3

- [X] T025 [P] [US3] Add repeated-export determinism coverage for workflow order, scenario selection, request IDs, variable names, environment values, summary fields, limitations, and README text in `backend/tests/unit/postman/workflowRendering.test.ts`
- [X] T026 [P] [US3] Add workflow decision revision coverage proving Postman generation becomes stale and regenerates from the new approved workflow set in `backend/tests/unit/testGenerationWorkflow/workflowReviewStage.test.ts` and `backend/tests/unit/testGenerationWorkflow/postmanGenerationStage.test.ts`
- [X] T027 [P] [US3] Add performance and no-network regression coverage for representative multi-step workflow exports in existing workflow export and no-network suites

### Implementation for User Story 3

- [X] T028 [US3] Implement canonical workflow sorting, step sorting, scenario selection, variable naming, and workflow folder/request identifiers using existing ordering helpers in `backend/src/postman/ordering.ts` and `backend/src/postman/identifiers.ts`
- [X] T029 [US3] Ensure workflow decision changes continue to reopen workflow review and mark Postman generation stale before regeneration in `backend/src/testGenerationWorkflow/workflowReviewStage.ts` and `backend/src/testGenerationWorkflow/postmanGenerationStage.ts`
- [X] T030 [US3] Preserve credential substitution, environment-only values, and deterministic artifact IDs when workflow requests are mixed with standalone requests in existing Postman artifact generation paths

**Checkpoint**: Identical inputs produce identical artifacts, and changing one workflow approval does not perturb unaffected output.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Align existing contracts and documentation, then run the complete validation gate.

- [X] T031 [P] Update the AP-007 Postman contract to document optional workflow context and replace the old workflow-intent-only limitation with the AP-016 behavior in `specs/007-postman-collection-generator/contracts/postman-collection-api.md`
- [X] T032 [P] Update the AP-009 workflow research documentation to record that approved workflows are now consumed by Postman generation in `specs/009-e2e-test-generation-workflow/research.md`
- [X] T033 [P] Update the repository architecture documentation with the workflow-to-artifact handoff and framework-independent boundary in `docs/architecture.md`
- [X] T034 Run the AP-016 focused quickstart validation scenarios from `specs/016-workflow-aware-postman/quickstart.md`; all focused workflow export scenarios pass
- [X] T035 Run repository validation and resolve AP-016 regressions in the affected source and test files; build and tests pass, while the pre-existing workflowStore lint violation remains outside AP-016

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No implementation dependency; fixture helpers can be created immediately.
- **Foundational (Phase 2)**: Depends on Setup and blocks all story work because shared contracts and workflow-stage handoff must exist first.
- **User Story 1 (Phase 3)**: Depends on Phase 2 and delivers the MVP rendering path.
- **User Story 2 (Phase 4)**: Depends on the workflow planning/output shape from US1, then adds reporting and safe limitation behavior.
- **User Story 3 (Phase 5)**: Depends on US1 output structure and US2 limitation/summary fields; validates re-export and stale-stage behavior.
- **Polish (Phase 6)**: Depends on all desired stories and updates cross-feature documentation before repository-wide validation.

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. MVP candidate.
- **US2 (P1)**: Depends on US1's workflow render plan and generated artifact elements; can then be validated independently with unsupported and mixed inputs.
- **US3 (P2)**: Depends on US1's deterministic output and US2's complete reporting fields; no new runtime feature dependency beyond existing staleness behavior.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T007 can run in parallel with the foundational implementation tasks after the shared contract shape is agreed.
- T008, T009, and T010 can run in parallel before US1 implementation; they target separate test files.
- T018, T019, and T020 can run in parallel before US2 implementation.
- T025, T026, and T027 can run in parallel before US3 implementation.
- T031, T032, and T033 can run in parallel during Polish.
- Different story phases should not be started concurrently until their stated shared output dependencies are complete because the generator and shared artifact contracts are central integration points.

## Parallel Example: User Story 1

```text
Task T008: Unit-test workflow planning and supportability in backend/tests/unit/postman/workflowRendering.test.ts
Task T009: Contract-test workflow collection output in backend/tests/integration/postmanWorkflowCollection.test.ts
Task T010: Test guided workflow handoff in backend/tests/integration/testGenerationWorkflow.test.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational contract work.
2. Implement workflow planning, scenario selection, handoff rendering, and guided-stage wiring.
3. Run the US1 unit, integration, and guided workflow tests.
4. Confirm standalone AP-007 exports remain unchanged.
5. Stop at the US1 checkpoint for a usable MVP.

### Incremental Delivery

1. Add US2 reporting and limitation visibility without changing the workflow approval model.
2. Add US3 deterministic re-export and decision-revision validation.
3. Finish cross-feature documentation and the full repository validation gate.

## Notes

- Every implementation task includes an exact repository path and follows the required checklist format.
- `[P]` marks tasks that can proceed concurrently without editing the same file or depending on incomplete work.
- Workflow rendering must remain deterministic and must never invoke AI or contact an API described by the specification.
- Do not create a new task phase for frontend work unless the existing export UI cannot display the expanded response fields; the current feature contract is satisfied by the existing artifact/download path.
