# Phase 1 Data Model: End-to-End Test Generation Workflow

New shared-domain types live in `packages/shared-domain/src/testGenerationWorkflow.ts` and are
exported from `packages/shared-domain/src/index.ts` alongside the existing `apiModel`, `testModel`,
`testScenarioReview`, `apiDependency`, and `postmanArtifact` modules. Nothing here modifies an
existing shared-domain type.

## WorkflowStageId

```ts
export type WorkflowStageId =
  | "upload"
  | "analysis"
  | "apiReview"
  | "deterministicGeneration"
  | "aiEnhancement"
  | "scenarioReview"
  | "dependencyAnalysis"
  | "workflowReview"
  | "postmanGeneration";
```

Fixed order, matching spec.md FR-001 and the Key Entities "Workflow Stage" list verbatim.
`WORKFLOW_STAGE_ORDER: readonly WorkflowStageId[]` is exported as the single source of truth other
modules iterate over (staleness computation, progress display).

## StageStatus

```ts
export type StageStatus =
  | "not-yet-reached"
  | "active"
  | "complete"
  | "stale"
  | "skipped";
```

- `not-yet-reached`: prior stage(s) not yet `complete`/`skipped`; cannot be entered (FR-002).
- `active`: reachable and currently being worked on; no committed output yet, or being redone after
  a revision (research.md D6).
- `complete`: has a committed output later stages may depend on.
- `stale`: was `complete`, but an earlier stage it depended on was revised (FR-006); its previous
  output is retained but not trusted for downstream use until redone.
- `skipped`: `aiEnhancement` only — the AI provider was unavailable/failed and the user proceeded
  without it (FR-008). Not terminal: returns to `active` on retry (FR-008a, research.md D6).

Valid transitions (enforced by `workflowStore.updateStage`, not left to callers):

```text
not-yet-reached → active
active → complete
active → skipped                (aiEnhancement only)
skipped → active                (aiEnhancement retry, only while scenarioReview ≠ complete)
complete → stale                (an upstream dependency was revised)
complete → active               (the stage itself is being redone, e.g. scenarioReview re-edited)
stale → active                  (user begins redoing the stale stage)
```

## WorkflowStageState

```ts
export interface WorkflowStageState {
  stageId: WorkflowStageId;
  status: StageStatus;
  enteredAt?: string;
  completedAt?: string;
  /** Present only for aiEnhancement when status is "skipped". */
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
}
```

## TestGenerationWorkflow

The single record `workflowStore` holds (at most one at a time, per FR-018/D7).

```ts
export interface TestGenerationWorkflow {
  id: string;
  createdAt: string;
  updatedAt: string;
  activeStageId: WorkflowStageId;
  stages: Record<WorkflowStageId, WorkflowStageState>;

  specificationFilename: string;
  apiModel?: ApiModel;                       // set once "analysis" completes

  deterministicTestModel?: TestModel;        // set once "deterministicGeneration" completes
  aiEnhancement?: EnhancementResult;         // set once "aiEnhancement" completes or is skipped

  reviewWorkspace?: ReviewWorkspace;         // live workspace while "scenarioReview" is active
  approvedTestModel?: TestModel;             // committed snapshot once "scenarioReview" is complete

  dependencyAnalysis?: DependencyAnalysisResult;   // set once "dependencyAnalysis" completes
  workflowDecisions?: Record<string, WorkflowReviewDecision>;  // keyed by IntegrationWorkflow.id
  approvedWorkflowIds?: string[];            // committed snapshot once "workflowReview" is complete

  postmanArtifact?: PostmanExportResult;     // set once "postmanGeneration" completes
}
```

`id` is a content-independent, freshly generated identifier (mirrors `backend/src/postman/identifiers.ts`'s
pattern) minted once per `startWorkflow` call; it exists for diagnostics/log correlation only — there
is never more than one workflow to disambiguate between (D7), so it is not used for routing or
lookup.

## WorkflowReviewDecision (new)

```ts
export type WorkflowReviewState = "pending" | "approved" | "rejected";

export interface WorkflowReviewDecision {
  workflowId: string;
  state: WorkflowReviewState;
  reason?: string;
  recordedAt: string;
}
```

Deliberately mirrors `ReviewState`/`ReviewDecision` from `testScenarioReview.ts` (research.md D5) —
same three-state shape, same optional `reason` for a rejection, no edit/regenerate concept (AP-008
workflows have nothing analogous to hand-edit).

## Stage → data dependency table

| Stage | Requires (input) | Produces (output) | Explicit user action to complete |
|---|---|---|---|
| `upload` | uploaded `.yaml`/`.yml` file | validated raw document | file selection + submit |
| `analysis` | `upload` complete | `apiModel` (with `summary.issues`) | none — atomic with upload (D4) |
| `apiReview` | `analysis` complete | — (no new data) | "Continue" click (D3) |
| `deterministicGeneration` | `apiReview` complete | `deterministicTestModel` | "Generate Baseline Test Suite" click |
| `aiEnhancement` | `deterministicGeneration` complete | `aiEnhancement` (`EnhancementResult`) | "Enhance with AI" click; retry while `skipped` and `scenarioReview` ≠ `complete` |
| `scenarioReview` | `aiEnhancement` `complete` or `skipped` | `reviewWorkspace` (live), `approvedTestModel` (on finalize) | per-scenario accept/reject/edit/regenerate, then "Finalize Review" (D6) |
| `dependencyAnalysis` | `scenarioReview` complete | `dependencyAnalysis` (`DependencyAnalysisResult`) — computed from `apiModel`, independent of which scenarios were approved (AP-008 operates at ApiModel granularity) | automatic on stage entry (no separate trigger button; matches AP-008's single stateless call) |
| `workflowReview` | `dependencyAnalysis` complete | `workflowDecisions`, `approvedWorkflowIds` | per-workflow approve/reject (auto-complete if `workflows` and `manualConfirmationCandidates` are both empty, D5), then "Continue" |
| `postmanGeneration` | `workflowReview` complete, `approvedTestModel` has ≥1 scenario (FR-011) | `postmanArtifact` | "Generate Postman Collection" click |

## Staleness propagation

`computeDownstreamStaleness(workflow, revisedStageId): WorkflowStageId[]` — a pure function over
`WORKFLOW_STAGE_ORDER` — returns every stage after `revisedStageId` currently in `complete`, so the
caller can mark each `stale` in one pass (research.md D6, FR-006). Only `scenarioReview` and
`workflowReview` are realistically revisable after completion in this feature's scope (`apiReview`
carries no data to revise, D3); the function is written generically over stage order rather than
hard-coded to those two, so it stays correct if a future feature adds a revisable decision to another
stage.

## Validation rules carried over unchanged

This feature adds no new validation for `ApiModel`, `TestModel`, `ReviewWorkspace`, or
`ApiDependencyGraph`/`IntegrationWorkflow` — the existing per-feature validators
(`buildApiModel`, `generateTestModel`, `hydrateReviewWorkspace`/`applyReviewUpdates`,
`analyzeDependencies`) are reused unmodified, so their existing constraints and tests are the
authority on their inputs.
