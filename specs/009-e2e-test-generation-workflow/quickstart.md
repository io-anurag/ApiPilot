# AP-009 Quickstart Validation

This guide validates the guided end-to-end workflow: one continuous path from an uploaded OpenAPI
specification to a downloadable Postman collection, built entirely by orchestrating AP-002–AP-008's
existing, unmodified capabilities (research.md D1, D9). Nothing in it executes a generated request
or contacts an API described by the specification.

## Prerequisites

- Node.js 20 LTS or newer
- npm dependencies installed from the repository root
- No AI provider is required for the deterministic-only path; `AI_PROVIDER_MODE=mock` (the test
  default) exercises the AI-enhancement stage without a model download.
- A representative specification fixture: `backend/tests/fixtures/openapi/valid.yaml`

## Automated Validation

From the repository root:

```powershell
npm test --workspace @apipilot/shared-domain -- --run tests/unit/test-generation-workflow.test.ts
npm test --workspace @apipilot/backend -- --run tests/unit/testGenerationWorkflow tests/integration/testGenerationWorkflow.test.ts
npx vitest run --project frontend
npm run build
npm run lint
```

Expected outcomes (see `contracts/test-generation-workflow-api.md` for the full guarantee list):

- Every stage becomes reachable only after the stage before it is `complete` or `skipped`
  (FR-002/SC per stage-dependency table in data-model.md).
- The full happy path — upload → analysis → apiReview → deterministicGeneration → aiEnhancement →
  scenarioReview → dependencyAnalysis → workflowReview → postmanGeneration — produces a downloadable
  collection whose scenarios trace back to approved review decisions (SC-002).
- Forcing the mock AI provider into an unavailable state advances `aiEnhancement` to `skipped`
  without an HTTP error, and the workflow still reaches `postmanGeneration` (SC-004); retrying while
  `scenarioReview` is not yet `complete` succeeds once the provider becomes available again (FR-008a).
- Revising an already-`complete` `scenarioReview` after `workflowReview` has completed marks
  `dependencyAnalysis`, `workflowReview`, and `postmanGeneration` `stale` (SC-003), and
  `postman-generation` is refused until the stale stages are redone (FR-007).
- Rejecting every generated scenario refuses `scenario-review/finalize` with
  `empty_approved_scenarios` rather than allowing an empty artifact downstream (FR-011).
- Starting a second workflow while one is in progress is refused with `409 workflow_in_progress`
  unless `discardExisting=true` is supplied (FR-010).
- No request in the test suite reaches any host other than the local test server (FR-013, SC-007).

## Manual Validation

### 1. Walk the full guided path

Start the application:

```powershell
npm run dev
```

In the browser (`http://localhost:5173` by default):

1. Upload `backend/tests/fixtures/openapi/valid.yaml`. Confirm the stage tracker shows `upload` and
   `analysis` complete and `apiReview` active (User Story 1, User Story 2).
2. Click "Continue" on the API review stage. Confirm `deterministicGeneration` becomes active.
3. Click "Generate Baseline Test Suite". Confirm `aiEnhancement` becomes active.
4. Click "Enhance with AI" (mock provider). Confirm the stage completes and scenario review shows
   both rule-derived and AI-derived scenarios distinguishable by provenance (constitution XIII).
5. Accept a representative subset of scenarios, then click "Finalize Review". Confirm
   `dependencyAnalysis` runs automatically and `workflowReview` becomes active.
6. Approve or reject each discovered `IntegrationWorkflow` (or confirm workflowReview auto-completes
   if the fixture yields none), then continue.
7. Click "Generate Postman Collection". Confirm `collection.json`, `environment.json`, and
   `README.md` become downloadable, and every request traces to an approved scenario (User Story 1,
   Acceptance Scenario 4).

At every step, confirm the stage tracker correctly shows complete/active/not-yet-reached stages
(User Story 2, SC-005).

### 2. Confirm resume across a browser reload

Mid-workflow (after finalizing scenario review, say), reload the page. Confirm the workflow resumes
at the same stage with all prior decisions intact (User Story 2, Acceptance Scenario 3; FR-014).
Confirm the same happens when reopening the app in a second browser tab, since workflow state is a
single backend-wide instance, not per-tab (FR-018).

### 3. Confirm the staleness cascade

After completing `workflowReview`, return to scenario review and reject a scenario that was
previously accepted. Confirm `dependencyAnalysis` and `workflowReview` are now shown `stale`, and
that attempting to download a previously generated Postman collection is refused or clearly marked
outdated until the stale stages are redone (User Story 3; FR-006, FR-007, SC-003).

### 4. Confirm the AI-unavailable path

Restart the backend with `AI_PROVIDER_MODE=mock` configured to simulate unavailability (or use the
existing mock provider's forced-failure test hook), reach the `aiEnhancement` stage, and confirm:

- The workflow proceeds to scenario review using only deterministic scenarios, with the
  AI-unavailable condition visibly recorded (User Story 4, Acceptance Scenario 1–2; FR-008).
- Before finalizing scenario review, retry AI enhancement; confirm the retry is offered and, once
  the provider is available, succeeds and folds AI-derived scenarios into review (Acceptance
  Scenario 3; FR-008a).
- After finalizing scenario review, confirm no retry option is offered (Acceptance Scenario 4).

### 5. Confirm the exclusive entry point

With no workflow in progress, confirm there is no reachable UI route or link to open scenario
review, dependency review, or Postman export directly — the only way in is starting a new workflow
from upload (FR-017).

### 6. Confirm the new-workflow confirmation gate

With a workflow in progress, attempt to upload a different specification. Confirm the system
requires explicit confirmation before discarding the in-progress workflow (Edge Cases; FR-010).

## Determinism check

```powershell
npm test --workspace @apipilot/backend -- --run tests/unit/testGenerationWorkflow/staleness.test.ts
```

The staleness test asserts `computeDownstreamStaleness` returns the same, order-independent result
for a fixed set of `complete` stages, and that no stage earlier than the revised one is ever marked
stale.
