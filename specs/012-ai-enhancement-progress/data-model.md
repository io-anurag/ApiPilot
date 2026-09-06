# Phase 1 Data Model: AI Enhancement Progress Visibility

## `BatchProgress` (new, `packages/shared-domain`)

The per-batch status of one AI enhancement run, as known at the moment a client polls.

| Field | Type | Notes |
|---|---|---|
| `index` | `number` | 0-based position, matching the deterministic batch order from specs/011-ai-prompt-batching. |
| `status` | `"pending" \| "in-progress" \| "succeeded" \| "failed"` | `"pending"`: not yet started. `"in-progress"`: `onBatchStart` fired, `onBatchSettled` has not. `"succeeded"`/`"failed"`: batch settled (data-model.md's existing `BatchOutcome` "not-attempted" case, from specs/011's time-budget guard, is not applicable here — enhancement has no overall wall-clock budget per specs/011 Decision 5, so every batch is always attempted). |
| `errorCategory` | `AIErrorCategory` (optional) | Present only when `status` is `"failed"`; mirrors the existing `BatchOutcome` failed-case category. |

## `AiEnhancementProgress` (new, `packages/shared-domain`)

The live state of one in-flight AI enhancement run. Present on `WorkflowStageState` only for the
`aiEnhancement` stage, and only while a run is active — absent (`undefined`) at every other time,
including before the first run and after any run reaches a terminal outcome.

| Field | Type | Notes |
|---|---|---|
| `totalBatches` | `number` | Fixed for the lifetime of one run once batch planning completes (specs/011 FR-009: deterministic split). |
| `batches` | `BatchProgress[]` | One entry per batch, index-ordered, length `totalBatches`. |
| `startedAt` | `string` (ISO 8601) | When this run began; informational only, no computed "time remaining" (per spec's Assumptions — no time estimates). |

Its presence is also the concurrency guard (research.md Decision 5): `runAiEnhancement()` refuses
to start a second run while an `AiEnhancementProgress` is already present for the current
workflow.

## `WorkflowStageState` (extended, `packages/shared-domain/src/testGenerationWorkflow.ts`)

One new optional field, following the existing precedent of `aiErrorCategory`/`aiErrorMessage`
already being stage-specific optional fields on this shared shape:

| Field | Type | Notes |
|---|---|---|
| `progress` | `AiEnhancementProgress` (optional) | Meaningful only when `stageId === "aiEnhancement"`. Set when a run starts, updated as batches start/settle, cleared (`undefined`) the moment the stage transitions to `complete`/`partial`/`skipped`. |

No other existing field changes meaning. `TestGenerationWorkflow`'s overall shape, and every other
stage's state, are untouched.

## `runBatchedInference` options (extended, `backend/src/ai/requestBatching.ts`)

Two new optional callbacks on the existing `options` parameter (alongside the existing
`isTimedOut`), both no-ops by default:

| Field | Type | Notes |
|---|---|---|
| `onBatchStart` | `(index: number, total: number) => void` (optional) | Called immediately before `runBatch()` is invoked for batch `index`. |
| `onBatchSettled` | `(index: number, total: number, outcome: BatchOutcome) => void` (optional) | Called immediately after batch `index`'s outcome (`BatchOutcome`, already defined) is known, before the next batch starts. |

`BatchedInferenceSummary`'s return shape is unchanged. `analyzeDependencies.ts`'s existing call
site passes neither callback and is unaffected (research.md Decision 3).

## `enhanceTestModel` options (extended, `backend/src/testDesign/enhanceTestModel.ts`)

One new optional parameter, `onBatchComplete`, called after each batch's incremental dedup pass
(research.md Decision 4) with exactly the scenarios newly retained by that batch (not the whole
accumulated set):

| Field | Type | Notes |
|---|---|---|
| `onBatchComplete` | `(index: number, total: number, outcome: BatchOutcome, newlyRetainedScenarios: TestScenario[]) => void` (optional) | `newlyRetainedScenarios` is empty for a failed/empty batch. Called once per batch, in order. |

`enhanceTestModel`'s existing return type (`EnhancementResult`) and its final computed value are
unchanged — this callback is a side channel for progressive reporting, not a second source of
truth. `runAiEnhancement()` (the workflow orchestration layer, not `enhanceTestModel` itself) is
the only caller that supplies this callback, using it to:
1. Patch `stages.aiEnhancement.progress` (batch status) via a new `workflowStore.ts` helper.
2. Append `newlyRetainedScenarios` to `reviewWorkspace.scenarios` immediately (as
   `ReviewScenario` wrappers, reusing the existing `newlyAddedReviewScenarios()` helper already
   used for the retry path), recomputing `reviewWorkspace.summary` each time.

This keeps `enhanceTestModel.ts` unaware of `workflowStore`/`reviewWorkspace` (constitution IX —
Separation of Concerns): it reports *what changed*, and the workflow layer decides what to do with
that.

## State transitions

No change to `WorkflowStageState.status`'s existing transition table
(`GENERAL_TRANSITIONS`/`AI_ENHANCEMENT_ONLY_TRANSITIONS` in `workflowStore.ts`). `progress` is not
itself a `status` value — it is supplementary data attached to the stage while `status` remains
`"active"`, set/cleared by a new, narrower `workflowStore.ts` helper (e.g.
`setAiEnhancementProgress(progress: AiEnhancementProgress | undefined)`) that does not go through
`updateStage()`'s transition validation, since it never changes `status` itself.
