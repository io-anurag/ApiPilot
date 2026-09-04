# API Contract: End-to-End Test Generation Workflow

AP-009 adds a stateful orchestration boundary over the existing stateless engine endpoints
(`/api/test-models*`, `/api/api-models/dependencies`, `/api/test-models/postman-collection`), which
are unchanged and remain independently usable (research.md D9). Every endpoint below operates on
**the single global `TestGenerationWorkflow` instance** (FR-018) — there is at most one at a time,
and none of these endpoints take an id. All error bodies use the existing
`{ "error": "<code>", "message": "<text>" }` shape used throughout the backend.

## `GET /api/test-generation-workflow`

Fetches the current workflow, or reports that none is in progress (resume behavior, User Story 2 /
FR-014).

### Success Response: `200 OK`

```json
{ "workflow": { "id": "wf-...", "activeStageId": "scenarioReview", "stages": { "...": "..." } } }
```

### Success Response: `204 No Content`

No workflow is currently in progress.

## `POST /api/test-generation-workflow`

Starts a new workflow from an uploaded specification (`upload` + `analysis` stages, atomically —
research.md D4). Multipart form body, mirroring `POST /api/specifications`: a single `file` field.

If a workflow is already in progress, the request is refused with `409 Conflict` unless the caller
explicitly confirms discarding it (FR-010).

```text
POST /api/test-generation-workflow?discardExisting=true
```

### Success Response: `200 OK`

```json
{ "workflow": { "id": "wf-...", "activeStageId": "apiReview", "stages": { "...": "..." } } }
```

### Error Response: `409 Conflict`

```json
{
  "error": "workflow_in_progress",
  "message": "A workflow is already in progress. Retry with discardExisting=true to replace it."
}
```

### Error Responses inherited from upload/analysis

`invalid_yaml`, `unsupported_version` (`400`), `file_too_large` (`413`) — identical semantics to
`POST /api/specifications` (AP-002 contract), since this endpoint calls the same parse/validate/build
pipeline.

## `POST /api/test-generation-workflow/api-review/continue`

Completes the `apiReview` stage (research.md D3 — a confirmation gate, no request body beyond the
implicit current workflow). Requires `apiReview` to be `active`.

### Success Response: `200 OK`

Returns the updated `{ "workflow": {...} }`, with `activeStageId` advanced to
`deterministicGeneration`.

### Error Response: `409 Conflict`

```json
{ "error": "stage_not_active", "message": "apiReview is not the active stage." }
```

This `stage_not_active` shape and status is reused by every stage-transition endpoint below when the
targeted stage is not currently enterable (FR-002).

## `POST /api/test-generation-workflow/deterministic-generation`

Runs `generateTestModel(apiModel)` (unchanged AP-003 function) and stores the result as
`deterministicTestModel`. Requires `deterministicGeneration` to be `active`.

### Success Response: `200 OK`

Returns the updated workflow; `activeStageId` advances to `aiEnhancement`.

## `POST /api/test-generation-workflow/ai-enhancement`

Runs `enhanceTestModel(apiModel, deterministicTestModel, provider)` (unchanged AP-005 function) and
stores the result as `aiEnhancement`. Also used to **retry** after a prior `skipped` outcome
(FR-008a) — same endpoint, same body (none); calling it again while the stage is `skipped` and
`scenarioReview` has not reached `complete` re-attempts inference.

Requires `aiEnhancement` to be `active` or `skipped` (with `scenarioReview` not yet `complete`);
otherwise `409 stage_not_active`, with a distinguishing message when the reason is that scenario
review was already finalized (`"AI enhancement can no longer be retried: scenario review is already
finalized."`).

### Success Response: `200 OK`, `aiProviderOutcome: "success"`

Stage becomes `complete`; `activeStageId` advances to `scenarioReview`, seeded from
`aiEnhancement.enhancedTestModel`.

### Success Response: `200 OK`, `aiProviderOutcome` other than `"success"`

Stage becomes `skipped`, with `aiErrorCategory`/`aiErrorMessage` recorded on the stage state
(data-model.md `WorkflowStageState`). `activeStageId` still advances to `scenarioReview`, seeded from
the unchanged deterministic `TestModel` (FR-008) — this is not an HTTP error; AI unavailability never
fails the request, matching AP-005's own contract.

## `POST /api/test-generation-workflow/scenario-review/decisions`

Applies one or more accept/reject decisions. Body: `{ "updates": ReviewUpdateRequest[] }` — same
shape as `POST /api/test-models/reviews`'s `review.updates`, but no `apiModel`/`testModel`/`review`
snapshot is sent; the server reads/writes `reviewWorkspace` on the stored workflow (research.md D9).

### Success Response: `200 OK`

```json
{ "workflow": { "...": "..." }, "outcomes": [ { "scenarioId": "...", "applied": true, "revision": 2, "state": "accepted" } ] }
```

`409 stale-revision` per-outcome semantics are unchanged from AP-006's existing contract
(`specs/006-test-scenario-review/contracts/`).

## `POST /api/test-generation-workflow/scenario-review/edit`

Same request/response contract as `POST /api/test-models/reviews/edit`, minus the
`apiModel`/`testModel`/`review` fields (read from the stored workflow). Body:
`{ "scenarioId": "...", "revision": 2, "edit": { "request": {...}, "assertions": [...] } }`.

## `POST /api/test-generation-workflow/scenario-review/regenerate`

Same contract as `POST /api/test-models/reviews/regenerate`, minus `apiModel`/`testModel`/`review`.
Body: `{ "scenarioId": "...", "revision": 2 }`.

## `POST /api/test-generation-workflow/scenario-review/finalize`

Commits the current `reviewWorkspace`'s projected `approvedTestModel` as the stage's output
(research.md D6). Requires `scenarioReview` to be `active`.

### Success Response: `200 OK`

Stage becomes `complete`; `activeStageId` advances to `dependencyAnalysis`, which runs automatically
(data-model.md: `dependencyAnalysis` has no separate trigger).

### Error Response: `409 Conflict`

```json
{
  "error": "empty_approved_scenarios",
  "message": "At least one scenario must be approved before finalizing scenario review."
}
```

Mirrors FR-011's later Postman-generation gate, applied one stage earlier so the empty case is caught
as soon as it is knowable, not deferred to a later stage.

## `POST /api/test-generation-workflow/workflow-review/decisions`

Applies one or more approve/reject decisions to `IntegrationWorkflow`s discovered by
`dependencyAnalysis`. Body: `{ "decisions": [{ "workflowId": "...", "state": "approved" | "rejected", "reason"?: "..." }] }`.

### Success Response: `200 OK`

```json
{ "workflow": { "...": "..." } }
```

### Error Response: `400 Bad Request`

```json
{ "error": "unknown_workflow_id", "message": "No IntegrationWorkflow with id '...' was found in the current dependency analysis." }
```

## `POST /api/test-generation-workflow/workflow-review/continue`

Completes the `workflowReview` stage. Requires either every discovered `IntegrationWorkflow` to have
a non-`pending` decision, or the discovered set (`workflows` and `manualConfirmationCandidates`) to
be empty (research.md D5, auto-complete case).

### Error Response: `409 Conflict`

```json
{
  "error": "pending_workflow_decisions",
  "message": "2 discovered workflow(s) still need an approve/reject decision."
}
```

## `POST /api/test-generation-workflow/postman-generation`

Runs `generateCollection(apiModel, approvedTestModel, options)` (unchanged AP-007 function; approved
`IntegrationWorkflow`s are never attached, research.md D2) and stores the result as
`postmanArtifact`. Requires `workflowReview` to be `complete`; requires `approvedTestModel.scenarios`
to be non-empty (FR-011 — already guaranteed by the `scenario-review/finalize` gate, re-checked here
defensively in case of a stale-then-redone path that emptied it).

### Success Response: `200 OK`

Stage becomes `complete`; the workflow as a whole is now `complete` and its artifacts are
downloadable (FR-012). Response body is `{ "workflow": {...} }`, consistent with every other
endpoint in this contract — the artifact (`collection`, `environment`, `readme`, `limitations`,
matching AP-007's existing `ExportResult` shape) is available at `workflow.postmanArtifact`.

### Error Responses

Reuses AP-007's existing failure codes/status mapping (`empty_approved_test_model`,
`collection_validation_failed`, ...) unchanged.

## Guarantees asserted by contract tests

- No stage-transition endpoint succeeds while its stage's `WorkflowStageState.status` is anything
  other than the value the stage-dependency table (data-model.md) requires (FR-002).
- Revising a `complete` `scenarioReview` or `workflowReview` stage marks every downstream `complete`
  stage `stale`, verified stage-by-stage (FR-006, SC-003).
- `GET /api/test-generation-workflow/postman-generation`'s success response is unreachable while any
  stage between it and the current `activeStageId` is `stale` (FR-007).
- AI-enhancement `skipped` outcomes never produce an HTTP error and always advance `activeStageId`
  (FR-008); retrying after `skipped` succeeds once the mock provider is switched to "available" in a
  test, and is refused with `stage_not_active` once `scenarioReview` is `complete` (FR-008a).
- No endpoint in this contract ever issues a request to a host described by the workflow's
  `apiModel` (FR-013, inherited from every wrapped feature's own guarantee).
- No endpoint logs the specification content, generated payloads, or AI prompts/responses beyond an
  error category (FR-016).

## Consumers

`frontend/src/pages/TestGenerationWorkflowPage.tsx` (new) is the sole consumer of this contract,
rendered directly by `App.tsx` in place of the removed `SpecificationUploadPage`. New stage
components (`ApiReviewStage`, `AiEnhancementStage`, `ScenarioReviewStage`, `WorkflowReviewStage`,
`PostmanGenerationStage`) call it and reuse the existing presentational leaf components
(`AnalysisSummary`, `OperationList`, `OperationDetail`, `TestScenarioReviewList`, ...) unmodified.
`SpecificationUploadPage.tsx`, `TestScenarioReviewPage.tsx`, and their dedicated tests are removed as
part of this feature; `PostmanExportPanel.tsx` and the pre-existing stateless endpoints it and the
old pages called remain in the codebase, unchanged, as independently valid, independently tested
boundaries — just no longer reachable from the app's own UI (research.md D8, D9, D10).
