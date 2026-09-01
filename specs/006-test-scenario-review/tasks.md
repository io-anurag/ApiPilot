---
description: "Task list for Test Scenario Review"
---

# Tasks: Test Scenario Review

**Input**: Design documents from `/specs/006-test-scenario-review/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), and [quickstart.md](quickstart.md)

**Tests**: Test tasks are included because AP-006 explicitly defines automated validation in its quickstart and requires unit, integration, and component coverage.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment after the shared foundation.

## Path Conventions

- Backend source: `backend/src/`
- Backend tests: `backend/tests/`
- Frontend source: `frontend/src/`
- Frontend tests: `frontend/tests/`
- Shared domain source: `packages/shared-domain/src/`
- Shared domain tests: `packages/shared-domain/tests/`

## Phase 1: Setup

**Purpose**: Confirm the existing AP-005 integration points and prepare AP-006 test fixtures without introducing persistence or new dependencies.

- [x] T001 Review existing TestModel, AI provenance, API route, frontend scenario, and test conventions in `packages/shared-domain/src/testModel.ts`, `backend/src/api/enhancedTestModels.ts`, `frontend/src/components/TestScenarioDetail.tsx`, and related tests
- [x] T002 Create representative deterministic, AI-derived, user-edited, duplicate, and sensitive-value review fixtures in `backend/tests/fixtures/testDesign/reviewScenarioFixtures.ts`
- [x] T003 Create shared-domain review fixture data for pending, accepted, rejected, stale, and policy-required scenarios in `packages/shared-domain/tests/fixtures/testScenarioReviewFixtures.ts`

## Phase 2: Foundational

**Purpose**: Establish the framework-independent review contracts and pure review-state behavior required by every user story.

- [x] T004 [P] Define ReviewState, ReviewDecision, ReviewEdit, ReviewScenario, ReviewPolicy, ReviewSummary, ReviewWorkspace, and approved TestModel contracts in `packages/shared-domain/src/testScenarioReview.ts`
- [x] T005 [P] Export the AP-006 review contracts from `packages/shared-domain/src/index.ts`
- [x] T006 [P] Add shared-domain tests for review-state discriminated unions, decision invariants, history shape, and summary count contracts in `packages/shared-domain/tests/unit/test-scenario-review.test.ts`
- [x] T007 Implement deterministic review summary calculation, policy evaluation, approved-model projection, and scenario equivalence checks in `backend/src/testDesign/reviewTestModel.ts`
- [x] T008 Implement revision-aware accept/reject transition validation with required rejection reasons and explicit stale-update findings in `backend/src/testDesign/reviewTestModel.ts`
- [x] T009 [P] Add backend unit tests for review summaries, policy-required states, accepted-model projection, rejection validation, stale revisions, and duplicate approved scenarios in `backend/tests/unit/testDesign/reviewTestModel.test.ts`
- [x] T010 Add redaction helpers for credential-like headers, bearer tokens, and sensitive request values at the review presentation boundary in `backend/src/testDesign/reviewSensitiveValues.ts`
- [x] T011 [P] Add unit tests for review-value redaction and preservation of non-sensitive test intent in `backend/tests/unit/testDesign/reviewSensitiveValues.test.ts`

**Checkpoint**: Shared review types, deterministic state transitions, approved-model rules, stale-update behavior, and redaction are independently tested before user-story work begins.

## Phase 3: User Story 1 - Inspect Generated Scenarios (Priority: P1)

**Goal**: Let a reviewer find and understand every generated scenario, its current state, operation, intent, provenance, and sensitive-value-safe details.

**Independent Test**: Load a TestModel containing multiple operations and both deterministic and AI scenarios, then verify the review view supports operation/category filtering, scenario selection, complete details, visible origin/state, and safe request display.

### Tests for User Story 1

- [x] T012 [P] [US1] Add component tests for scenario listing, operation/category filters, selection, empty state, and pending/accepted/rejected labels in `frontend/tests/unit/TestScenarioReviewPage.test.tsx`
- [x] T013 [P] [US1] Add component tests for request, assertions, rule/AI/user provenance, rationale, confidence, assumptions, and redacted sensitive values in `frontend/tests/unit/TestScenarioReviewDetail.test.tsx`
- [x] T014 [P] [US1] Add frontend service tests for review workspace loading, successful responses, and safe error responses in `frontend/tests/unit/reviewsClient.test.ts`

### Implementation for User Story 1

- [x] T015 [US1] Implement the review workspace response mapping and review API client in `frontend/src/services/reviewsClient.ts`
- [x] T016 [US1] Implement the scenario review list with operation/category search and filtering, semantic state labels, and accessible selection controls in `frontend/src/components/TestScenarioReviewList.tsx`
- [x] T017 [US1] Implement review summary and state-count presentation in `frontend/src/components/TestScenarioReviewSummary.tsx`
- [x] T018 [US1] Implement scenario review detail presentation for request, assertions, provenance, rationale, confidence, assumptions, and redacted values in `frontend/src/components/TestScenarioReviewDetail.tsx`
- [x] T019 [US1] Implement the review page loading, empty, error, success, selection, filtering, and recovery states in `frontend/src/pages/TestScenarioReviewPage.tsx`
- [x] T020 [US1] Add the AP-006 review entry point and route/state wiring after TestModel generation in `frontend/src/App.tsx`
- [x] T021 [US1] Add responsive and keyboard-accessible review layout styling using the existing frontend styling conventions in `frontend/src/pages/TestScenarioReviewPage.tsx`

**Checkpoint**: A reviewer can inspect a 50-scenario mixed-origin TestModel, locate scenarios by operation/category, understand the full intent, and see safe redacted details.

## Phase 4: User Story 2 - Decide Scenario Eligibility (Priority: P1)

**Goal**: Let reviewers accept or reject scenarios with explicit feedback and produce an approved TestModel containing only eligible scenarios.

**Independent Test**: Initialize a review workspace, accept one scenario, reject another with a reason, inspect summary counts, and verify pending/rejected scenarios are excluded from approved output.

### Tests for User Story 2

- [x] T022 [P] [US2] Add contract-focused integration tests for workspace initialization, accept/reject updates, summary counts, approved-model projection, invalid rejection reasons, and method handling in `backend/tests/integration/testScenarioReview.test.ts`
- [x] T023 [P] [US2] Add component tests for accept/reject controls, rejection-reason input, review summary updates, pending-state visibility, and action failure recovery in `frontend/tests/unit/TestScenarioReviewDecision.test.tsx`

### Implementation for User Story 2

- [x] T024 [US2] Implement review workspace initialization, ordered decision application, summary calculation, and approved TestModel projection in `backend/src/testDesign/reviewTestModel.ts`
- [x] T025 [US2] Implement request validation and response mapping for `POST /api/test-models/reviews` in `backend/src/api/testScenarioReviews.ts`
- [x] T026 [US2] Register the test-scenario review route under `/api` without moving review logic into the Express adapter in `backend/src/app.ts`
- [x] T027 [US2] Implement accept/reject controls, rejection feedback capture, pending-state guards, and action recovery in `frontend/src/components/TestScenarioReviewDecision.tsx`
- [x] T028 [US2] Connect review decisions and summary refreshes to the review service from `frontend/src/pages/TestScenarioReviewPage.tsx`
- [x] T029 [US2] Ensure approved-model consumers receive only accepted, policy-eligible, non-duplicate scenarios through `backend/src/testDesign/reviewTestModel.ts`

**Checkpoint**: Review decisions are explicit, deterministic, summarized, provenance-preserving, and cannot authorize pending or rejected scenarios for downstream artifact generation.

## Phase 5: User Story 3 - Refine AI Suggestions (Priority: P2)

**Goal**: Support validated edits and explicit AI regeneration while preserving original provenance, review history, and pending status.

**Independent Test**: Edit an AI scenario using supported intent, verify user-modified history and pending state, regenerate another scenario, and verify invalid edits or provider failures leave the last valid state unchanged.

### Tests for User Story 3

- [x] T030 [P] [US3] Add backend unit tests for supported edits, user-modified provenance, history retention, revision increments, invalid edits, and unchanged-state failures in `backend/tests/unit/testDesign/reviewTestModel.edit.test.ts`
- [x] T031 [P] [US3] Add backend integration tests for edit and regeneration requests, successful pending replacements, provider degradation, and unchanged current state on failure in `backend/tests/integration/testScenarioReviewRefinement.test.ts`
- [x] T032 [P] [US3] Add frontend component tests for edit controls, validation errors, regenerate action, pending replacement state, and recovery messaging in `frontend/tests/unit/TestScenarioReviewRefinement.test.tsx`

### Implementation for User Story 3

- [x] T033 [US3] Implement supported scenario edit validation against ApiModel and AP-005 test intent in `backend/src/testDesign/reviewTestModel.ts`
- [x] T034 [US3] Implement user-modified provenance and review-history recording without erasing the original AI or RULE origin in `packages/shared-domain/src/testScenarioReview.ts`
- [x] T035 [US3] Implement `POST /api/test-models/reviews/edit` request validation, edit application, and safe failure mapping in `backend/src/api/testScenarioReviews.ts`
- [x] T036 [US3] Implement explicit AI regeneration orchestration through `AIProvider`, preserving the current scenario on timeout, malformed output, unavailable provider, or semantic validation failure in `backend/src/testDesign/regenerateReviewScenario.ts`
- [x] T037 [US3] Implement `POST /api/test-models/reviews/regenerate` request validation and response mapping in `backend/src/api/testScenarioReviews.ts`
- [x] T038 [US3] Implement review edit and regeneration controls with pending-state reset and provenance/history display in `frontend/src/components/TestScenarioReviewRefinement.tsx`
- [x] T039 [US3] Connect edit and regeneration workflows to the review page while preserving confirmed state after failed actions in `frontend/src/pages/TestScenarioReviewPage.tsx`
- [x] T040 [US3] Add stable duplicate detection after edits and regenerated candidates so equivalent approved scenarios are not emitted twice in `backend/src/testDesign/reviewTestModel.ts`

**Checkpoint**: AI suggestions can be refined without hiding their origins, failed refinement is non-destructive, replacements require review, and approved output remains deduplicated.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete review boundary, accessibility, safety, determinism, and documentation.

- [x] T041 [P] Add API contract assertions for request/response shapes, `400` validation, `405` method handling, stale `409` conflicts, and approved-model safety in `backend/tests/integration/testScenarioReview.test.ts`
- [x] T042 [P] Add regression tests proving review actions never execute API requests, authorize execution, or generate artifacts in `backend/tests/integration/testScenarioReviewSafety.test.ts`
- [x] T043 [P] Add accessibility assertions for semantic controls, keyboard navigation, visible focus, non-color state indicators, and responsive overflow in `frontend/tests/unit/TestScenarioReviewAccessibility.test.tsx`
- [x] T044 Add review-specific API error and loading recovery handling to `frontend/src/services/reviewsClient.ts`
- [x] T045 Review frontend copy, redaction behavior, provenance labels, and empty/error states against FR-002, FR-004, FR-017, and FR-018 in `frontend/src/pages/TestScenarioReviewPage.tsx`
- [x] T046 Run the AP-006 quickstart validation from `specs/006-test-scenario-review/quickstart.md` and update expected commands or outcomes if they differ
- [x] T047 Run repository-wide `npm test`, `npm run lint`, and `npm run build`; resolve AP-006 regressions only and record unrelated failures in `specs/006-test-scenario-review/quickstart.md`
- [x] T048 Review the final implementation against `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/test-scenario-review-api.md`, and the constitution in `specs/006-test-scenario-review/quickstart.md`

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1) has no prerequisites and establishes fixtures and repository understanding.
- Foundational (Phase 2) depends on Setup and blocks all user stories.
- User Story 1 (Phase 3) depends on Foundational and delivers the inspection MVP.
- User Story 2 (Phase 4) depends on Foundational and the review workspace from User Story 1.
- User Story 3 (Phase 5) depends on Foundational and the review state/decision boundary from User Story 2.
- Polish (Phase 6) depends on all required user-story phases.

### User Story Completion Order

```text
Foundational
    ↓
User Story 1: Inspect Generated Scenarios
    ↓
User Story 2: Decide Scenario Eligibility
    ↓
User Story 3: Refine AI Suggestions
    ↓
Polish & Cross-Cutting Concerns
```

### Parallel Opportunities

- After Setup, T004-T006 and T010-T011 can proceed in parallel because they touch separate shared-domain and backend safety surfaces.
- Within User Story 1, T012-T014 can proceed in parallel; after those tests are established, T015-T018 can proceed across separate frontend service/component files.
- Within User Story 2, T022-T023 can proceed in parallel; T025-T026 can proceed after foundational domain behavior and route tests are agreed.
- Within User Story 3, T030-T032 can proceed in parallel; T035 and T037 can proceed after the route contract is established, while T038 can proceed independently in the frontend.
- In Polish, T041-T043 can proceed in parallel because they cover backend contract, safety, and frontend accessibility files separately.

## Implementation Strategy

### MVP Scope

Deliver Phase 1, Phase 2, User Story 1, and the minimum review-workspace initialization needed to inspect a TestModel. This provides visible scenario review value without enabling approval or regeneration prematurely.

### Incremental Delivery

1. Establish shared review contracts, deterministic summaries, revision checks, and redaction.
2. Deliver scenario inspection with loading, empty, error, filtering, and provenance states.
3. Add explicit accept/reject decisions and approved TestModel projection.
4. Add validated edits and explicit AI regeneration with preserved history.
5. Complete safety, accessibility, repeatability, quickstart, and repository-wide validation.

## Traceability Summary

- User Story 1 maps to FR-001 through FR-005 and FR-017-FR-018.
- User Story 2 maps to FR-006 through FR-010 and FR-019-FR-020.
- User Story 3 maps to FR-011 through FR-016 and FR-018-FR-020.
- Foundational tasks establish the entities and invariants in `data-model.md`.
- Route tasks implement the interfaces in `contracts/test-scenario-review-api.md`.
- Quickstart and polish tasks validate SC-001 through SC-008.
