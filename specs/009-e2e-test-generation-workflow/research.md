# Phase 0 Research: End-to-End Test Generation Workflow

No `[NEEDS CLARIFICATION]` markers remain in `spec.md` — the three scope-level ambiguities that
existed were resolved in `/speckit-clarify` (see `## Clarifications` in spec.md) and are binding on
this plan (FR-008a, FR-017, FR-018). This document records the remaining engineering decisions
needed to turn the specification into a concrete design, given what AP-002–AP-008 already built.

## D1. What AP-002–AP-008 already give this feature

Reading the current codebase (not just the specs) before designing the orchestration layer:

- Every existing generation/review/export endpoint (`POST /api/test-models`,
  `/api/test-models/enhance`, `/api/test-models/reviews*`, `/api/api-models/dependencies`,
  `/api/test-models/postman-collection`) is **stateless**: the caller resends the full `apiModel` /
  `testModel` / review snapshot on every request, and the backend persists nothing
  (`backend/src/api/*.ts`). There is currently **no server-side state of any kind** in ApiPilot.
- The frontend currently composes three of the nine stages by nesting React components with
  component-local state and prop drilling: `App` → `SpecificationUploadPage` (upload, analysis
  display, "Generate Baseline Test Suite" button) → `TestScenarioReviewPage` (scenario review) →
  `PostmanExportPanel` (export). This state is lost on refresh and is not reachable from a second
  browser tab. AI enhancement and dependency/workflow review have **no frontend client or UI at
  all** yet (`frontend/src/services/`, `frontend/src/pages/` — no `enhancedTestModelsClient.ts`,
  `dependenciesClient.ts`, or workflow-review components exist).
- AP-008's own spec explicitly defers "review/approval of generated workflows as executable test
  intent" to "the existing/extended review capability" and lists it as this feature's job. AP-008
  produces `IntegrationWorkflow`/`ManualConfirmationCandidate`/`DependencyCycleFinding` candidates
  but defines no accept/reject decision shape for them — none exists anywhere in the codebase.
- AP-007's Postman generator exports **single-operation scenarios only** (FR-028) and explicitly
  refuses (`workflow_intent_unsupported`) a `TestModel` carrying multi-step workflow intent,
  because "implementing that rendering is deferred until AP-008 supplies the workflow contract"
  (AP-007 FR-029/FR-030) — and AP-008, now that it exists, explicitly places "Generating Postman...
  from a workflow" outside its own scope too, leaving that rendering work unclaimed by any shipped
  feature.

**Decision**: AP-009 is the first feature to introduce genuine server-side state (a single
in-memory orchestration record), and the first to define a review/approval decision for
`IntegrationWorkflow`. Both are squarely inside this feature's stated scope ("sequencing, progress
visibility, staleness handling" and "review/approve workflows" is one of its own named stages).

## D2. Does AP-009 render approved integration workflows into the Postman collection?

**Decision**: No. The Postman-generation stage calls the existing `generateCollection` exactly as
AP-007 built it, using only the approved `TestModel` from scenario review. Approved
`IntegrationWorkflow`s are retained on the `TestGenerationWorkflow` record for traceability and
satisfy FR-003's "explicit human review/approval... at workflow-review", but are never attached as
`testModel`'s workflow-intent key, so `workflow_intent_unsupported` is never triggered by this
orchestration.

**Rationale**: Rendering multi-step workflows into an executable Postman sequence is explicitly out
of scope for AP-007 (deferred), AP-008 (out of scope), and this spec's own Out of Scope ("Any new...
Postman generation logic beyond what AP-002 through AP-008 already specify"). Implementing it here
would be new Postman-generation logic under a different name — exactly what the spec forbids.
Treating workflow review as a parallel human sign-off (required before the workflow is "complete",
FR-003) without feeding it into artifact generation is the smallest design that satisfies every
existing constraint. A future feature can extend `generateCollection` to consume approved
`IntegrationWorkflow`s once that rendering is actually built; nothing here blocks that.

**Alternatives considered**: Passing workflow intent into `generateCollection` and letting it fail
with `workflow_intent_unsupported` was rejected — it would make the "review/approve workflows"
stage always end in an unusable, self-defeating dead end (the user approves work the pipeline then
guarantees will be rejected downstream), which fails FR-009/FR-011's spirit of a coherent, working
guided path.

## D3. What does the "API review" stage actually gate?

**Decision**: A confirmation gate over the existing analysis display (`AnalysisSummary` +
`OperationList` + `OperationDetail`), not a new operation-selection feature. The stage becomes
`complete` when the user takes an explicit "Continue" action (FR-009); no new exclude/include
capability is added.

**Rationale**: AP-002's spec and `ApiModel` contract define no per-operation inclusion/exclusion
concept (confirmed by inspection — no such field exists on `ApiModel` or `ApiOperation`). Inventing
one here would be new OpenAPI-engine scope, which this spec's Assumptions explicitly rule out
("this feature's requirements are scoped to sequencing, progress visibility, staleness handling").
Spec.md's User Story 3 names "excluding an API operation" only as an illustrative example of a
revisable decision, not a required capability; the concrete, spec-required revisable decisions are
scenario accept/reject/edit (already exists, AP-006) and workflow approve/reject (new, D5). Because
the API-review stage carries no selectable data, revisiting it never produces a meaningful staleness
cascade — reopening it is a no-op beyond re-displaying the same analysis.

## D4. Are "upload" and "analysis" one stage or two?

**Decision**: Modeled as two distinct `WorkflowStageId` values (matching spec.md's FR-001 and Key
Entities enumeration exactly), but they always complete together in one backend call. `buildApiModel`
already embeds analysis issues into `ApiModel.summary` as one atomic, synchronous operation
(`backend/src/openapi/buildApiModel.ts`) — there is no separate "run analysis" action to perform
after upload succeeds.

**Rationale**: Preserves literal fidelity to the spec's named stage list for FR-004's progress
display, without inventing a second round-trip for something AP-002 already does atomically.

## D5. Workflow-review approval model

**Decision**: A new shared-domain shape, `WorkflowReviewDecision` (`pending | approved | rejected`
per `IntegrationWorkflow.id`), mirroring the existing `ReviewState`/`ReviewDecision` shape from
`testScenarioReview.ts` for consistency. The `workflowReview` stage completes once every
`IntegrationWorkflow` returned by dependency analysis has a decision, or immediately (auto-complete,
no blocking) when `workflows` is empty and there are no `manualConfirmationCandidates` requiring
attention (edge case: "no relationships at all"). Rejecting a workflow excludes it from the set
retained as "approved" on the `TestGenerationWorkflow` record; it does not block progression to
Postman generation (only an empty *scenario* set blocks progression, per FR-011 — an empty approved
*workflow* set is valid, since Postman generation never depends on it, D2).

**Rationale**: Mirrors an established, already-reviewed pattern (AP-006) instead of inventing new
review semantics; keeps the decision model minimal (accept/reject only — no edit/regenerate, which
AP-008 workflows have no equivalent concept for).

## D6. Scenario-review "finalize" and the staleness cascade (FR-006, FR-007, FR-008a)

**Decision**: Scenario review already has a live, continuously-recomputed `approvedTestModel`
projection (`projectApprovedTestModel`, existing AP-006 behavior) that changes with every
accept/reject/edit/regenerate action. AP-009 adds one new explicit action on top of the existing
ones: **finalize**, which snapshots the current `approvedTestModel` as the stage's committed output
and moves `scenarioReview` from `active` to `complete`. Downstream stages (`dependencyAnalysis`,
`workflowReview`, `postmanGeneration`) only ever read that committed snapshot, never the live
workspace.

If the user returns to a `complete` scenario-review stage and applies another accept/reject/edit
action, the stage moves back to `active` (being revised) and every downstream stage that was
`complete` moves to `stale` (FR-006) — implemented as one pure function,
`computeDownstreamStaleness(fromStageId)`, applied uniformly by every stage-mutating endpoint rather
than re-implemented per stage.

**Rationale**: Without an explicit finalize action, "has scenario review been finalized" (the gate
FR-008a needs for AI-enhancement retry, and the gate FR-006/FR-007 need for staleness) would have no
unambiguous answer, since AP-006's workspace is designed to be continuously editable. Introducing one
new, explicit, user-driven transition is the smallest change that gives every downstream requirement
a well-defined signal, and it is exactly the kind of explicit action FR-009 already requires
("every such decision MUST result from explicit user action").

## D7. Single global in-memory workflow instance (FR-018)

**Decision**: `backend/src/testGenerationWorkflow/workflowStore.ts` holds one module-level mutable
variable — `TestGenerationWorkflow | null` — read and written only through a small set of exported
functions (`getCurrentWorkflow`, `startWorkflow`, `updateStage`, ...). No database, no session
store, no cookie/token identity.

**Rationale**: Directly implements the clarified answer (single backend-wide instance) with the
simplest possible mechanism, per constitution XXVII (Prefer Simple Architecture — "Distributed...
complex orchestration... MUST NOT be introduced unless a later specification establishes a concrete
need") and matches every existing backend engine module's stateless-by-default posture, adding
exactly the one piece of state the clarified spec requires and nothing more. It is explicitly *not*
persisted to disk (Assumptions: lost on backend restart, matching ApiPilot's non-persistent
processing model).

## D8. Frontend: no client-side router is introduced

**Decision**: A single new `TestGenerationWorkflowPage` replaces the current ad hoc nesting in
`App.tsx`. It fetches `GET /api/test-generation-workflow` on mount (resume behavior, User Story 2)
and renders exactly one stage's view based on the returned `activeStageId`, plus a stage-tracker
strip showing every stage's status. There is no route per stage and no `react-router` dependency
added.

**Rationale**: FR-017 requires the guided workflow to be the *exclusive* way to reach a stage
screen — the simplest way to guarantee that is to have no URL ever address an individual stage in
the first place, rather than adding routing and then remembering to gate every route. This also
keeps the "no new dependency" posture consistent with every prior frontend-touching feature in this
codebase (none has added a router).

## D9. Reusing existing endpoints vs. new workflow-scoped endpoints

**Decision**: The existing stateless endpoints (`/api/test-models`, `/api/test-models/enhance`,
`/api/test-models/reviews*`, `/api/api-models/dependencies`, `/api/test-models/postman-collection`)
are left completely unchanged and keep their own tests — they remain valid, independently usable
HTTP boundaries per constitution IX/XXI. The guided workflow's frontend does not call them directly;
instead, new endpoints under `/api/test-generation-workflow/*` internally import and call the exact
same underlying pure functions (`generateTestModel`, `enhanceTestModel`,
`hydrateReviewWorkspace`/`applyReviewUpdates`/`applyReviewEdit`/`regenerateReviewScenario`,
`analyzeDependencies`, `generateCollection`) and additionally read/write the current stage's state
from `workflowStore` instead of the request body.

**Rationale**: Avoids duplicating any business logic (constitution IX, XXVII) while still satisfying
FR-014 (state survives across browser connections) for every stage, not only the final artifact —
proxying every micro-action through the workflow layer, sourced from the same functions the existing
routers already call, is the only way an in-progress *edit* (not just a finalized result) survives a
reload without inventing a second, divergent implementation of scenario review or dependency
analysis.

## D10. Fate of the existing orchestrating page components

`SpecificationUploadPage.tsx` and `TestScenarioReviewPage.tsx` are not pure presentational
components — each owns React state and self-fetches from a stateless endpoint
(`uploadSpecification`/`generateBaselineTestSuite`, and `loadReviewWorkspace`/`applyReviewDecisions`/
`submitReviewEdit`/`requestReviewRegeneration`, respectively), and each nests the next stage's page
directly (`SpecificationUploadPage` renders `TestScenarioReviewPage`, which renders
`PostmanExportPanel`). This is precisely the ad hoc, component-local orchestration FR-017 requires
the guided workflow to replace.

**Decision**: `App.tsx` is changed to render the new `TestGenerationWorkflowPage` instead of
`SpecificationUploadPage`. `SpecificationUploadPage.tsx`, `TestScenarioReviewPage.tsx`, and their
dedicated tests (`frontend/tests/unit/App.test.tsx`,
`frontend/tests/unit/TestScenarioReviewPage.test.tsx`) are removed, since nothing in the app renders
them once `App.tsx` changes — keeping them would leave dead, untriggerable code exactly like the one
this codebase's own conventions forbid. `PostmanExportPanel.tsx` is *not* reused as-is inside the new
workflow, because it self-fetches from the old stateless export endpoint rather than the new
stage-gated one (D9); its presentational structure (variable inputs, limitations list, download
links) is the reference for a new `PostmanGenerationStage.tsx`, but `PostmanExportPanel.tsx` itself,
and its own dedicated tests, are left untouched, since it is still a valid, independently reusable
component wherever the underlying stateless endpoint is used directly (e.g., possible future
non-workflow tooling, and its own existing test coverage).

The purely presentational leaf components each page composed —
`AnalysisSummary`/`OperationList`/`OperationDetail` and
`TestScenarioReviewList`/`TestScenarioReviewSummary`/`TestScenarioReviewDetail`/
`TestScenarioReviewDecision`/`TestScenarioReviewRefinement` — take no service-client dependency
themselves (props in, callback out) and are reused unmodified inside the new stage components.

**Rationale**: This is the smallest change that satisfies FR-017 without inventing a parallel
orchestration path alongside the new one; removing genuinely superseded, unreferenced code follows
this codebase's own established discipline rather than being unrelated cleanup.

## D11. Performance

**Decision**: No new numeric performance target is introduced. Each stage's own budget (e.g.
AP-008's 200-operation/15s dependency-analysis budget, AP-005's AI-enhancement timeout) is unchanged
by this feature, since AP-009 calls the same functions without modification. SC-005 ("identify
current stage within 5 seconds") is a UI clarity property, not a system latency budget, and is
validated by inspection/usability check in quickstart.md rather than an automated timer.
