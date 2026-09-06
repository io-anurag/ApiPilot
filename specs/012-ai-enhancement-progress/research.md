# Phase 0 Research: AI Enhancement Progress Visibility

## Decision 1: Reuse the existing `GET /api/test-generation-workflow` poll target — no new endpoint, no SSE/WebSocket

**Decision**: Progress is surfaced as an additive field on the existing `TestGenerationWorkflow`
response (`stages.aiEnhancement.progress`, see data-model.md), returned by the `GET
/api/test-generation-workflow` route that already exists
(`backend/src/api/testGenerationWorkflow.ts:159`) and is already consumed by the frontend via
`fetchCurrentWorkflow()`. The frontend polls this same endpoint on a short interval while a run
is active. No new HTTP endpoint, no Server-Sent Events, no WebSocket.

**Rationale**: Constitution XXVII (Prefer Simple Architecture) disallows introducing
infrastructure without a proven need. This app has no streaming transport anywhere in its
codebase today — every interaction is plain request/response JSON over Express. A verified,
empirical fact from live debugging of this exact stage confirms polling is viable: `GET
/api/health` returned instantly while a real, in-flight AI-enhancement request was running
(onnxruntime-node's native inference calls do not block Node's event loop), so a concurrent poll
of workflow state during an active run is already known to work today, with zero new
infrastructure. Reusing the existing endpoint also means the existing `toWorkflowResponse()`
redaction/shaping logic (`testGenerationWorkflow.ts:97`) applies to the new field for free.

**Alternatives considered**:
- Server-Sent Events on a new endpoint — rejected: adds a new transport pattern to a codebase
  that has none, for a case where batches take tens of seconds to low minutes (SC-004 only
  requires an update within one batch's processing time), which plain polling satisfies
  trivially.
- WebSocket — rejected: bidirectional infrastructure for a strictly one-directional,
  read-mostly status signal; would require a new dependency (`ws` or similar) with no proven
  need (XXVII).
- A new dedicated `GET .../ai-enhancement/progress` endpoint — rejected: the existing workflow
  GET already returns the whole `TestGenerationWorkflow`, which the frontend already fetches and
  polls in other flows; a second endpoint would duplicate that pattern for no benefit, and would
  need its own redaction/shape decisions that `toWorkflowResponse()` already handles for the
  existing endpoint.

## Decision 2: Progress lives on the existing in-memory workflow singleton — no new persistence

**Decision**: Progress is tracked as a field on the same single, in-process, non-persisted
`TestGenerationWorkflow` object `workflowStore.ts` already holds (`backend/src/testGenerationWorkflow/workflowStore.ts:14`,
"No database, no session identity"). No new storage layer, no per-session/per-tab tracking.

**Rationale**: The user's own resolution to the FR-007 clarification (ephemeral progress scoped
to the originating tab; only the final outcome must always be recoverable) is satisfied — and
slightly exceeded, at no extra cost — by this app's existing architecture: because there is only
one global workflow with no session identity, *any* reconnect while the process is still running
sees the same live progress, and progress naturally disappears (along with all other in-memory
workflow state) if the process restarts, exactly like every other piece of workflow state today.
Building a genuinely tab-scoped or persisted-across-restarts progress store would be new
infrastructure this feature does not need.

**Alternatives considered**: A dedicated, separately keyed "run progress" store (e.g. keyed by a
client-generated session token) — rejected: over-engineered relative to the actual requirement,
and inconsistent with the rest of the workflow model, which has never had per-session identity.

## Decision 3: `runBatchedInference` gains two optional, additive callbacks — dependency detection is unaffected

**Decision**: `backend/src/ai/requestBatching.ts`'s `runBatchedInference()` accepts two new
optional callback options: `onBatchStart?: (index: number, total: number) => void`, invoked
immediately before a batch's `runBatch()` is called, and `onBatchSettled?: (index: number, total:
number, outcome: BatchOutcome) => void`, invoked immediately after a batch's outcome is known
(success, failed, or not-attempted), before the next batch starts. Both are optional and default
to no-ops; the function's existing return shape (`BatchedInferenceSummary`) is unchanged.

**Rationale**: `runBatchedInference` is shared between `enhanceTestModel.ts` (this feature) and
`analyzeDependencies.ts` (specs/011-ai-prompt-batching, explicitly out of scope per FR-011).
Optional, no-op-by-default callbacks are purely additive — `analyzeDependencies.ts`'s existing
call site (`backend/src/dependencies/analyzeDependencies.ts:150-159`) needs no change and its
behavior is provably identical, satisfying FR-004 and FR-011 without forking or duplicating the
batch runner (constitution IX — Separation of Concerns; XXVII — Prefer Simple Architecture over
maintaining two batch runners).

**Alternatives considered**: Fork a separate `runBatchedInferenceWithProgress` for enhancement
only — rejected: duplicates the sequential-execution and time-budget logic that already exists
and is already tested, for no benefit over an optional callback.

## Decision 4: Progressive reveal reuses the existing dedup rules, only recomputed incrementally — proven equivalent, not just assumed

**Decision**: `enhanceTestModel.ts` recomputes the *existing* `deduplicate()` function
(`backend/src/testDesign/deduplicate.ts`) after each batch settles, over the deterministic
baseline plus every AI scenario produced by batches completed so far (not just the newest batch),
and reports only the newly-retained scenarios from that pass to the caller via a new
`onBatchComplete` callback. The final result once every batch finishes is computed exactly as
today (one call to `enhanceTestModel`, one `EnhancementResult`) — this is not a second, different
merge path.

**Rationale**: This is provably safe, not merely convenient. `deduplicate()`'s algorithm
(`deduplicate.ts:38-74`) is a strict left-fold keyed by `dedupeKey()`: the *first* scenario seen
for a given key is retained permanently; every later duplicate for that key is folded into the
retained scenario's provenance (`duplicateOfRules`/`duplicateOfAICandidates`) and never displaces
it. Because batches are always processed in the same fixed, deterministic order (FR-009 of
specs/011-ai-prompt-batching), recomputing `deduplicate()` over the growing prefix
(deterministic-baseline, then batch 0's scenarios, then batch 1's, …) after each batch yields
exactly the same retained identity for every key that has already appeared, at every step, as
computing it once over the full concatenation at the end — an already-retained scenario's
identity can never be revoked by a later batch's duplicate. Scenario IDs are also independently
proven stable regardless of when or how many times they're computed: `candidateScenarioId()`
(`aiScenarioCandidate.ts:9`) is a pure hash of the candidate's own content, not of array position
or batch index. Together these two facts guarantee FR-004 (no change to merge/dedup *rules*) and
FR-012 (a user's decision on an early-revealed scenario is never invalidated by a later batch) are
satisfied by construction, not by a hope that ordering happens to work out.

**Alternatives considered**: Reveal each batch's raw candidates immediately, without cross-batch
dedup, and reconcile duplicates only in a final pass — rejected: this is exactly the
retroactive-disappearance risk to FR-012 that the proof above shows is unnecessary to accept;
incremental dedup over the growing prefix gets the same simplicity with a stronger guarantee.

## Decision 5: Concurrent-run guard reuses the progress field's presence — no new flag

**Decision**: `runAiEnhancement()` (`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`)
rejects a new run with the same `409 stage_not_active`-style error convention already used
elsewhere in this router when `stages.aiEnhancement.progress` is already present (i.e., a run is
currently in flight) for the current workflow, before calling `enhanceTestModel`. The progress
field is cleared when the run reaches any terminal outcome (`complete`/`partial`/`skipped`), as
part of the same `updateStage()` call already made today.

**Rationale**: Today's synchronous, single-request model happens to make a double-submit mostly
harmless because the whole run completes within one request, but nothing actually prevents two
concurrent `POST .../ai-enhancement` calls (e.g. a double-click, or two browser tabs) from calling
`enhanceTestModel` twice in parallel against the same workflow — this is a latent gap FR-008 closes
as a necessary side effect of making runs individually trackable, not scope creep: two concurrently
running enhancement passes would produce two independent, interleaved progress states and two
independent final merges racing to `patchWorkflow`, which is exactly the kind of undefined
concurrent-mutation behavior constitution XIX (Fail Safely) and XXVII rule out. Reusing the
progress field itself as the guard (rather than adding a separate boolean) avoids a second piece
of state that could drift out of sync with it.

**Alternatives considered**: A separate `isRunning` boolean on the workflow — rejected: two
fields that must always agree is worse than one field whose mere presence *is* the signal.

## Decision 6: Fixed-interval client-side polling, no adaptive backoff

**Decision**: The frontend polls `GET /api/test-generation-workflow` every 2 seconds while an AI
enhancement run is active (started once the user clicks "Enhance with AI" or "Retry", stopped once
a terminal stage status is observed), using a plain `setInterval`/`setTimeout` loop — no
exponential backoff, no adaptive interval based on observed batch duration.

**Rationale**: SC-004 only requires a progress update within the time it takes each batch to
complete; real batches observed in this codebase's own diagnostics take tens of seconds to a few
minutes, so a 2-second fixed interval comfortably satisfies that bound with a wide margin, at
negligible server cost (one cheap in-memory read per poll, no AI work triggered). Constitution
XXVII disfavors adding adaptive-polling complexity without a demonstrated need; a fixed interval is
trivially reasoned about and trivially testable.

**Alternatives considered**: Exponential backoff (start fast, slow down for long runs) — rejected
as unproven-need complexity for a status check this cheap; can be revisited if real usage shows
polling overhead matters, which nothing today suggests.
