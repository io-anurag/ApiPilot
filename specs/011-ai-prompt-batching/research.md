# Phase 0 Research: Bounded AI Prompt Batching for Large Specifications

## Decision 1: Reuse (do not replace) the existing oversized-request guard as the safety net

**Decision**: The `LocalProvider` context-window guard added in a prior fix (checks
`tokenizer.encode(input).length + maxNewTokens + CONTEXT_SAFETY_MARGIN_TOKENS` against
`tokenizer.model_max_length`, throwing a typed `AIProviderError("INVALID_REQUEST", ...)`)
remains the single authoritative source of truth for "does this exact request fit." This
feature's batch-planning heuristic (Decision 2) only needs to be _conservative enough that it
usually avoids hitting that guard_, not perfectly precise — because FR-011 already requires
a batch that still doesn't fit to fail through that existing, already-tested path and be
skipped without aborting the rest of the run.

**Rationale**: Avoids maintaining two independent, potentially-inconsistent definitions of
"fits the context window." The guard is exact (real tokenizer count); the planner is a cheap
estimate used only to decide _how_ to split before sending anything.

**Alternatives considered**: Make the planner call into the same exact tokenizer count via a
new provider method — rejected because it would require loading/serializing the full
candidate prompt through the tokenizer for every candidate split during planning (redundant
work already duplicated by the real inference call), and because it would leak a
token-counting concept across the `AIProvider` boundary (see Decision 2).

## Decision 2: Capacity signal is a plain character budget, not a token count

**Decision**: Add one new method to the `AIProvider` interface:
`getInputBudget(maxOutputTokens?: number): Promise<number | undefined>`, returning the
maximum number of _characters_ of serialized prompt input the provider can safely accept, or
`undefined` if the provider has no meaningful limit. `MockProvider` returns `undefined` by
default (tests that need to exercise real splitting can construct it with a test-only
override). `LocalProvider` derives its budget from `tokenizer.model_max_length` using a
fixed, documented, conservative characters-per-token constant, after loading the engine (the
same lazy-load path `infer()` already triggers).

**Rationale**: Constitution VI (AI Provider Independence) requires the domain layer
(`analyzeDependencies.ts`, `enhanceTestModel.ts`) to never depend on tokenizer internals or
any specific inference runtime type. A character count is a provider-agnostic unit any caller
can compute with `.length` on a string it already has to build anyway. Because Decision 1
keeps the real tokenizer check as the final authority, the conservative ratio does not need
to be exact — only safely biased toward _smaller_ batches than strictly necessary.

**Alternatives considered**:

- Expose the raw token limit and a `tokenizer.encode()`-equivalent method on `AIProvider` —
  rejected: leaks a tokenizer-shaped concept across the provider boundary and would need a
  real implementation in `MockProvider` too, for no benefit over a character estimate given
  Decision 1's safety net.
- Hard-code a fixed "operations per batch" number in `analyzeDependencies.ts`/
  `enhanceTestModel.ts` — rejected: violates FR-012 (must re-derive from the actual
  configured provider) and would silently stop adapting if the configured model changes.

## Decision 3: Deterministic recursive-halving split, not general bin-packing

**Decision**: Given an ordered list of operations and a character budget, batching works as
follows: build the full prompt for all operations; if its length fits the budget (or the
budget is `undefined`), return one batch (identical to today's single-request behavior,
satisfying FR-006). Otherwise, split the operations array in half at its midpoint (stable,
index-based — no reordering, no randomness) and recurse independently on each half, down to
a floor of one operation per batch (FR-011). The same input array and budget always produce
the same split (FR-009, SC-004).

**Rationale**: Constitution XXVII (Prefer Simple Architecture) — a general bin-packing
algorithm (e.g., greedy first-fit-decreasing) would handle wildly uneven operation sizes more
byte-efficiently, but adds materially more complexity and non-obvious determinism edge cases
(e.g., stable tie-breaking when sizes are equal) for a problem where "many roughly similar
API operations" is the realistic shape of the input. Recursive halving is trivial to reason
about, trivially deterministic, and already sufficient to satisfy every functional
requirement in the spec.

**Alternatives considered**: Greedy bin-packing (rejected: added complexity not justified by
a proven need — XXVII); fixed N-operations-per-batch (rejected: doesn't adapt to actual
per-operation prompt size or actual provider capacity — FR-012).

## Decision 4: AI-assisted cross-batch relationship detection is an accepted, documented gap

**Decision**: When dependency detection splits operations across multiple batches, the
AI-assisted pass can only propose relationships between operations that land in the _same_
batch — it cannot see operations placed in a different batch's request. This is accepted as
an explicit trade-off, not silently hidden.

**Rationale**: Constitution XXX (Explicit Trade-offs) requires this to be documented rather
than glossed over. Deterministic field-name-based matching (`computeDeterministicMatching`)
already runs once over the _entire_ `ApiModel` regardless of batching — it is unaffected and
remains the primary, always-complete signal. The AI-assisted pass has only ever been a
supplementary layer on top of that deterministic baseline (constitution II: Deterministic
Before AI), so a batching-induced reduction in the AI pass's cross-operation reach does not
reduce the deterministic guarantee, and still strictly improves on today's "AI pass skipped
entirely for large specs" baseline (spec User Story 1). Scenario enhancement
(`enhanceTestModel.ts`) is not affected by this gap in practice, since AI-suggested scenarios
are already scoped to one operation at a time.

**Alternatives considered**: Send a lightweight "index" of all operations (e.g., just
path+method+field names, without full schemas) in every batch so the AI can still reference
operations outside its batch by name — rejected for this iteration as unproven-need added
complexity (XXVII); noted here as a possible future refinement if evaluation
(constitution XXII) shows the batched pass misses relationships that matter in practice.

## Decision 5: No new overall wall-clock budget for scenario enhancement

**Decision**: Dependency detection already has an existing 15-second, wall-clock,
whole-analysis budget (`ANALYSIS_TIMEOUT_MS`) that batching must respect (FR-010, SC-005) —
after each batch, if elapsed time has exceeded the budget, remaining batches are treated as
not attempted. Scenario enhancement (`enhanceTestModel.ts`) has no equivalent pre-existing
overall budget today (only a per-request timeout), and this feature does not introduce one.

**Rationale**: FR-010 is scoped to "the overall performance budget that already applies" —
there is none for enhancement today, and constitution XXVII disallows adding infrastructure
(here, a new cross-cutting timeout policy) without a proven need. Per-batch requests still
each respect the existing per-request `inferenceTimeoutMs`/`timeoutMs` override behavior
unchanged.

**Alternatives considered**: Introduce a new overall enhancement budget mirroring
`ANALYSIS_TIMEOUT_MS` — deferred; can be proposed as a small follow-up specification if real
usage shows unacceptably long total enhancement latency for very large specifications.

## Decision 6: New `"partial"` outcome value is additive, not a redefinition

**Decision**: `AIProviderOutcome` (`aiScenarioDesign.ts`) and `DependencyAIOutcome`
(`apiDependency.ts`) each gain one new closed-set member, `"partial"`, reported when at least
one batch succeeded and at least one batch did not (FR-007). All existing values
(`"success"`, `"unavailable"`, `"timeout"`, `"invalid-response"`, and — for dependency
detection only — `"skipped"`) keep their existing meaning unchanged; `"partial"` is only
reachable when a specification required more than one batch.

**Rationale**: An additive change to a closed union is backward compatible for consumers
using exhaustive `switch` (TypeScript will flag any that need updating — a compile-time
reminder, not a runtime break) and preserves FR-006 (small, single-batch specifications never
produce `"partial"`, so their observable outcome set is unchanged).

**Alternatives considered**: Overload an existing value (e.g., report `"success"` whenever
_any_ batch succeeds) — rejected: this is exactly the "misleading success status" SC-003
explicitly forbids.

## Decision 7: The workflow-stage-status consumer must be updated explicitly, not assumed safe

**Decision**: `/speckit-analyze` found that `enhanceTestModel.ts`'s `"partial"` outcome
(Decision 6) is consumed downstream by `runAiEnhancement()`
(`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`), which branches with
`if (result.aiProviderOutcome === "success") { ... } else { /* treat as skipped */ }` — a
plain equality check, not an exhaustive switch. `TestGenerationWorkflow`'s `StageStatus`
(`packages/shared-domain/src/testGenerationWorkflow.ts`) therefore gains a `"partial"` value,
applicable only to the `aiEnhancement` stage (mirroring how `"skipped"` already applies only
there). `runAiEnhancement()` is updated to a three-way branch (`"success"` → `"complete"`,
`"partial"` → `"partial"`, anything else → `"skipped"`), and the frontend components that
render `aiEnhancement.status` (`AiEnhancementStage.tsx`, `TestGenerationWorkflowPage.tsx`,
`WorkflowStageTracker.tsx`) are updated to render this third state distinctly. Dependency
detection's `DependencyAIOutcome` has no equivalent workflow-stage-status consumer today (no
frontend code branches on `dependencyAnalysis.aiOutcome`), so no analogous change is needed on
that side for this feature.

**Rationale**: FR-007/SC-003 require the partial outcome to be "explicitly distinguishable"
to the user, not merely returned correctly from `enhanceTestModel()`. Because
`runAiEnhancement()`'s branch is not exhaustive, the TypeScript compiler will not flag it when
`"partial"` is added to `AIProviderOutcome` — silently collapsing partial results into today's
full-failure (`"skipped"`) status would violate constitution XIV (No Silent Assumptions) and
SC-003 despite `enhanceTestModel.ts` itself behaving correctly.

**Alternatives considered**: Reuse the existing `"skipped"` status for partial results too,
relying only on `aiErrorMessage` text to convey partiality — rejected:
`WorkflowStageTracker.tsx`'s status chip/tone is keyed on `StageStatus`, so a partial run
would render visually identical to a full failure, which is exactly the misleading status
SC-003 forbids.
