# Research: AI Enhancement Batch Retry

**Feature**: `015-ai-batch-retry` | **Input**: [spec.md](./spec.md)

No `NEEDS CLARIFICATION` markers remain in the Technical Context (all resolved during
`/speckit-clarify` or by the reasonable defaults already recorded in spec.md's Assumptions). This
document instead records the nine design decisions the feature's architecture rests on, each
grounded in the existing codebase so the feature adds no new pattern where an established one
already fits.

## Decision 1 — Persist per-batch outcomes past settle, on `WorkflowStageState`

**Decision**: Add a new `batchOutcomes?: BatchOutcomeRecord[]` field to `WorkflowStageState`,
populated for `aiEnhancement` whenever a run produces batch-level results, and **not** cleared
when the stage reaches a terminal status.

**Rationale**: `AiEnhancementProgress` (`packages/shared-domain/src/testGenerationWorkflow.ts:80-112`)
is explicitly transient — `stages.aiEnhancement.progress` is documented as "present only ... while
a run is actively in progress" and `setAiEnhancementProgress(undefined)` is called the moment a run
settles (`backend/src/testGenerationWorkflow/aiEnhancementStage.ts:297`, right before
`updateStage(...)` records the terminal status). This is by design (specs/012-ai-enhancement-progress
data-model.md: "no new server-side persistence of an in-progress run's status is required beyond
what already exists for the final outcome"), but that design predates a feature that needs
per-batch data *after* settling. FR-001 requires exactly this, so a new persisted field is added
alongside — the transient `progress` field is untouched and keeps its existing lifecycle for the
in-flight case (specs/012).

**Alternatives considered**:
- *Stop clearing `progress` on settle.* Rejected — `progress`'s absence is the load-bearing signal
  `AiEnhancementAlreadyRunningError` uses to detect a run in flight
  (`aiEnhancementStage.ts:171-173`); repurposing it would break FR-007's concurrency guard for
  every other caller.
- *Derive batch outcomes from `EnhancementResult.aiCandidates` after the fact.* Rejected —
  `aiCandidates` (added/deduplicated/rejected/nonExecutable) is a candidate-level ledger with no
  batch index attached (confirmed in `enhanceTestModel.ts:520-537`); reconstructing "which batch
  produced this" from it is not possible without adding the same batch identifier this decision
  already adds at the source.

## Decision 2 — Pin each batch's operations at run time, not recomputed

**Decision**: `BatchOutcomeRecord` stores `operationKeys: string[]` (each `"METHOD /path"`,
matching the existing `operationKey()` helper in `enhanceTestModel.ts:41-43`) — the exact set of
operations that batch contained when the run first split them. A retry looks these operations up
from `workflow.apiModel.operations` by key rather than re-running
`splitOperationsIntoBatches(...)`.

**Rationale**: FR-008 requires a retry to use "exactly the same set of operations," even if
configuration affecting batch composition (`enhancementOperationsPerUnit`, budget) changed since
the original run. Batching is deterministic *for a fixed configuration*
(specs/011-ai-prompt-batching FR-009, specs/014-ai-batching-policy FR-005), but nothing pins the
configuration a given run used — recomputing batches at retry time would silently use whatever
configuration happens to be active then, which the research phase confirmed is not tracked
anywhere on the workflow. Storing the resolved key list once, at the moment a batch first exists,
removes the dependency on recomputation entirely.

**Alternatives considered**:
- *Store the full `ApiOperation` objects instead of keys.* Rejected as unnecessary duplication —
  `workflow.apiModel.operations` is already the authoritative, unchanging copy for the life of one
  workflow (a new upload replaces the whole workflow, per `workflowStore.ts:55-86`), so a key is
  sufficient to look the same object back up.
- *Re-run `splitOperationsIntoBatches` and match by index.* Rejected — this is exactly the failure
  mode FR-008 and the edge case in spec.md call out: an index is meaningless once the batch
  boundaries it was measured against can shift.

## Decision 3 — Reuse the existing state machine unchanged for the aggregate recompute

**Decision**: A batch retry transitions the stage `skipped`/`partial` → `active` (identical to
today's whole-stage retry, `aiEnhancementStage.ts:163`), then on settling transitions `active` →
`complete` if every `BatchOutcomeRecord` is now `succeeded`, else `active` → `partial`. No new
`StageStatus` member and no new transition is added.

**Rationale**: `workflowStore.ts:89-113` already permits `skipped->active`, `partial->active`,
`active->complete`, and `active->partial`. FR-012 (from `/speckit-clarify`) only requires that the
aggregate status be recomputed from all batches' current statuses after a retry — it does not
require a direct `partial->complete` edge, because the retry path already passes back through
`active` on its way. Reusing the exact transition set that whole-stage retry already exercises
means the new capability introduces zero new state-machine surface to test or reason about.

**Alternatives considered**:
- *Add a direct `partial->complete` transition* for a hypothetical "instant" recompute without
  visiting `active`. Rejected as solving a problem that doesn't exist — a retry is never
  instantaneous (it calls the AI provider), so passing through `active` for its duration is both
  correct (it genuinely is active while retrying) and free.

## Decision 4 — Reuse `explainFailure` unchanged, per batch

**Decision**: `BatchOutcomeRecord`'s failure reason is produced by calling the existing
`explainFailure(cause, context)` (`backend/src/testGenerationWorkflow/failureExplanation.ts`) with
that batch's own category — `explainFailure(batch.errorCategory)` for a `failed` batch, or
`explainFailure(wasCancelled ? "cancelled" : "run-budget-exhausted")` for a `not-attempted` one
(the run-level flag already computed in `aiEnhancementStage.ts:291,319` tells you which). The
resulting `FailureExplanation.retryable` is used directly to gate whether a retry action is offered
for that batch (FR-002/FR-003), and its `summary`/`nextStep` are shown as the batch's reason
(FR-001, FR-010, User Story 2).

**Rationale**: `explainFailure` already encodes exactly the retryable/non-retryable distinction
FR-002/FR-003 require — `retryable: false` for `TIMEOUT`, `not-viable`, `run-budget-exhausted`,
`INVALID_REQUEST`, and `true` for `NOT_READY`, `LOAD_FAILED`, `PROVIDER_UNAVAILABLE`,
`INVALID_RESPONSE`, `cancelled` (`failureExplanation.ts:56-180`) — and this is exactly the same
rule specs/013-ai-enhancement-viability FR-019/FR-025 established for whole-run retry. Calling the
same pure function per batch means the two retry surfaces can never disagree about what's worth
retrying, with no new rule written anywhere.

**Alternatives considered**:
- *Invent a separate per-batch retryability table.* Rejected — this is precisely the "introducing
  new [failure] conventions" the original feature request said to avoid, and it would risk drifting
  from the whole-run table over time.

## Decision 5 — Extract the single-batch pipeline out of `enhanceTestModel`

**Decision**: Factor the operations of `runOneBatch` (`enhanceTestModel.ts:133-215`) plus the
deduplicate-against-baseline step (`enhanceTestModel.ts:516-537`) into a small function,
`retryOneBatch(operations, apiModel, testModel, provider, options)`, callable independently of a
full `enhanceTestModel` run. `enhanceTestModel` itself is refactored to call it internally so there
is exactly one implementation of "run one batch and merge its results," not two.

**Rationale**: constitution IX (Separation of Concerns) and XXVII (Prefer Simple Architecture)
disfavor a second, parallel implementation of request-building, response parsing, semantic
validation, and dedupe. `runOneBatch` already exists as a self-contained per-batch unit; the only
new work is exposing a version of it that also performs the same-baseline dedupe
`enhanceTestModel` does today for a full run, scoped to one batch's candidates.

**Alternatives considered**:
- *Call `enhanceTestModel` itself with `operationsPerUnit` set to include only the target
  operations.* Rejected — `enhanceTestModel` always re-derives batches from
  `apiModel.operations` (the *whole* operation set), reruns the pre-flight viability estimate
  across all of them, and reseeds/discards workspace state assumptions that only hold for a full
  run. Bending it to behave like a single-batch function would make it harder to read for its
  primary, unchanged use.

## Decision 6 — Merge into the review workspace via the existing incremental path

**Decision**: A successful batch retry's newly-produced scenarios are merged into
`reviewWorkspace.scenarios` using the exact same `newlyAddedReviewScenarios(...)` /
exact-scenario-ID-dedup logic already used for incremental reveal during a normal run
(`aiEnhancementStage.ts:61-76, 268-283`). No new merge path is introduced.

**Rationale**: This is what makes FR-004 ("add only the scenarios newly produced for that batch's
own operations ... MUST NOT modify ... any other batch['s] scenario or review decision") true for
free — the existing merge only ever appends scenarios whose ID isn't already present, never touches
existing entries. Per the spec's documented Assumption, this feature does not add a new
cross-batch content-similarity dedupe pass; it inherits the same exact-ID-only limitation
whole-stage retry already has.

**Alternatives considered**: *Re-run full dedupe across every batch's historical output on every
retry.* Rejected per the spec's Assumptions — out of scope for this feature, and a materially larger
change to `enhanceTestModel`'s dedupe boundary (research finding during `/speckit-specify`: today's
`deduplicate()` pass runs once per whole run, never against scenarios already sitting in the
workspace from a previous run/attempt).

## Decision 7 — Append to, not replace, the run's cumulative candidate tallies

**Decision**: `workflow.aiEnhancement.aiCandidates` (added/deduplicated/rejected/nonExecutable,
read by `AiEnhancementOutcomeSummary.tsx:16`) is updated by **appending** the retried batch's own
outcome entries, not by replacing the whole `EnhancementResult` the way `patchWorkflow({
aiEnhancement: result })` does for a whole-stage run today (`aiEnhancementStage.ts:296`).

**Rationale**: A whole-stage retry reprocesses every operation and so naturally produces a complete,
self-consistent `EnhancementResult` to replace the old one. A batch retry processes only one
batch's operations — replacing the whole `EnhancementResult` with a result covering only that one
batch would make `AiEnhancementOutcomeSummary` under-report every other batch's already-retained
scenarios the moment any one batch is retried. Appending keeps the displayed counts accurate
without any change to that component.

**Alternatives considered**: *Leave `aiCandidates` untouched by batch retry.* Rejected — a
successful batch retry does add genuinely new scenarios (FR-004), and silently not reflecting that
in the one place the UI already shows candidate counts would contradict FR-010's provenance intent
in spirit, even though the field itself is not named in any FR.

## Decision 8 — One concurrency guard, reused

**Decision**: Batch retry sets `stages.aiEnhancement.progress` for its own duration (reusing
`setAiEnhancementProgress`/`AiEnhancementAlreadyRunningError` exactly as `runAiEnhancement` does)
and clears it on settling. No new "is something in progress" flag is introduced.

**Rationale**: FR-007 requires that a batch retry cannot start while any other AI Enhancement
operation is in progress, and vice versa. `progress` presence is already the single signal both
`runAiEnhancement` (`aiEnhancementStage.ts:171-173`) and `cancelAiEnhancement`
(`aiEnhancementStage.ts:50-51`) check. Reusing it for batch retry means the three operations
(whole-stage run, cancel, batch retry) can never disagree about whether the workflow is busy.

**Alternatives considered**: *A separate `batchRetryInProgress` flag.* Rejected — two independent
flags for "is AI Enhancement busy" is exactly the kind of duplicated state constitution IX warns
against; it would need its own synchronization story for no behavioral benefit.

## Decision 9 — New endpoint, same thin-route convention

**Decision**: `POST /api/test-generation-workflow/ai-enhancement/retry-batch` with body
`{ "batchIndex": number }`, following the identical validate → delegate-to-stage-module → map-to-HTTP
shape as `.../ai-enhancement/cancel` (`backend/src/api/testGenerationWorkflow.ts:256-277`,
`contracts/ai-enhancement-cancel.md`). Full contract in
[contracts/ai-enhancement-retry-batch.md](./contracts/ai-enhancement-retry-batch.md).

**Rationale**: Every existing AI Enhancement action is its own route on the same resource path
family; a batch-scoped retry is a new action on the same family, not a new resource. `batchIndex`
identifies the record within `stages.aiEnhancement.batchOutcomes` (Decision 1), which is stable
for the life of one workflow (it is set once, per batch, at first-run time — Decision 2 — and never
resized).

**Alternatives considered**: *A generic `PATCH .../ai-enhancement/batches/:index` REST-ish route.*
Rejected as inconsistent with every other route on this resource, which are all action-shaped
POSTs (`/continue`, `/cancel`, the bare enhancement POST itself), not resource-shaped.
