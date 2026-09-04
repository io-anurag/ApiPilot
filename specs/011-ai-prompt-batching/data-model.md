# Phase 1 Data Model: Bounded AI Prompt Batching for Large Specifications

## Contract Changes to Existing Entities

### `AIProvider` (packages/shared-domain/src/aiProvider.ts)

Adds one new method to the existing interface:

```ts
export interface AIProvider {
  mode: AIProviderMode;
  getReadiness(): ReadinessState;
  infer(request: InferenceRequest): Promise<InferenceResponse>;
  /**
   * Maximum number of characters of serialized InferenceRequest.input this provider can
   * safely accept for the given output budget, or undefined if it has no meaningful limit
   * (e.g. MockProvider). A conservative estimate, not an exact count — see research.md
   * Decision 1/2. Callers use this only to plan batches; LocalProvider's existing
   * exact-token guard inside infer() remains the authoritative fits/doesn't-fit check.
   */
  getInputBudget(maxOutputTokens?: number): Promise<number | undefined>;
}
```

- **`LocalProvider.getInputBudget()`**: loads the engine (same lazy path as `infer()`), reads
  `tokenizer.model_max_length`, and returns
  `(model_max_length - maxOutputTokens - CONTEXT_SAFETY_MARGIN_TOKENS) * CHARS_PER_TOKEN_ESTIMATE`
  (a new exported constant alongside the existing `CONTEXT_SAFETY_MARGIN_TOKENS`), or
  `undefined` if `model_max_length` is not a finite number (mirrors the existing guard's own
  fallback behavior).
- **`MockProvider.getInputBudget()`**: returns `undefined` by default (no limit). Gains a new
  test-only constructor option (mirroring the existing `MockProviderConfig` pattern) to return
  a fixed, small budget instead, so unit tests can exercise real multi-batch splitting without
  a real model (constitution XXI).

### `AIProviderOutcome` (packages/shared-domain/src/aiScenarioDesign.ts)

```ts
export type AIProviderOutcome =
  "success" | "unavailable" | "timeout" | "invalid-response" | "partial";
```

`EnhancementResult` is otherwise unchanged in shape; `aiErrorCategory`/`aiErrorMessage` remain
optional and, when `aiProviderOutcome === "partial"`, describe the _last_ failing batch
encountered (see Batch Outcome below) — good enough for the explicit, human-readable status
message required by FR-007's acceptance scenario; per-batch detail is not part of this
contract (kept out of scope per the spec's Key Entities, which describe aggregate-level
outcomes only).

### `DependencyAIOutcome` (packages/shared-domain/src/apiDependency.ts)

```ts
export type DependencyAIOutcome =
  "success" | "unavailable" | "timeout" | "invalid-response" | "skipped" | "partial";
```

`DependencyAnalysisResult` shape is otherwise unchanged.

### `StageStatus` (packages/shared-domain/src/testGenerationWorkflow.ts)

```ts
export type StageStatus =
  "not-yet-reached" | "active" | "complete" | "stale" | "skipped" | "partial";
```

`"partial"` applies only to the `aiEnhancement` stage, exactly like `"skipped"` does today
(research.md Decision 7). `runAiEnhancement()`
(`backend/src/testGenerationWorkflow/aiEnhancementStage.ts`) maps
`EnhancementResult.aiProviderOutcome` to this stage status with a three-way branch:
`"success"` → `"complete"`, `"partial"` → `"partial"`, anything else → `"skipped"` (replacing
the current binary `=== "success"` check). `aiErrorCategory`/`aiErrorMessage` continue to be
recorded for both `"skipped"` and `"partial"`.

## New Internal Entities (backend/src/ai/requestBatching.ts)

These are internal implementation types, not shared-domain contracts (they never cross the
`AIProvider` boundary or an HTTP response).

### `Batch<TOperation>`

```ts
interface Batch<TOperation> {
  operations: TOperation[];
}
```

A subset of a specification's operations that together form one AI request. Produced by
`splitOperationsIntoBatches()` (Decision 3 — deterministic recursive halving). Every operation
from the input array appears in exactly one batch (FR-004); order of batches matches the
order operations first appear in the input array (FR-009).

### `BatchOutcome`

```ts
type BatchOutcome =
  | { status: "success" }
  | { status: "failed"; errorCategory: AIErrorCategory; errorMessage: string }
  | { status: "not-attempted" };
```

The per-batch result of one AI request attempt. `"not-attempted"` is used only when the
overall time budget (FR-010, dependency detection only — see research.md Decision 5) was
already exhausted before this batch could be tried; it is reported the same way as `"failed"`
for aggregation purposes (FR-010: "reported per FR-007/FR-008").

### Aggregate outcome derivation (shared by both callers via `runBatchedInference()`)

Given the list of `BatchOutcome`s for a run:

| Successes   | Failures/not-attempted                                                                     | Aggregate outcome    |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------- |
| all batches | none                                                                                       | `"success"`          |
| ≥1 batch    | ≥1 batch                                                                                   | `"partial"`          |
| none        | all batches, all `"failed"` with category `TIMEOUT`                                        | `"timeout"`          |
| none        | all batches, all `"failed"` with category `PROVIDER_UNAVAILABLE`/`NOT_READY`/`LOAD_FAILED` | `"unavailable"`      |
| none        | all batches, any other/mixed category (including any `"not-attempted"`)                    | `"invalid-response"` |

This table is a direct generalization of each caller's existing single-batch
`providerErrorMessage()`/category-mapping logic (`analyzeDependencies.ts`,
`enhanceTestModel.ts`), extended with the new `"partial"` row; the single-batch case (today's
behavior) is the `all batches / none` or the all-failed rows with exactly one batch, so FR-006
holds automatically without a special case.

## State / Flow Summary

```text
ApiModel.operations (+ TestModel, for enhancement)
        │
        ▼
provider.getInputBudget(maxOutputTokens)  ──▶ undefined  ──▶ single batch (today's path)
        │
        ▼ (a number)
splitOperationsIntoBatches(operations, buildPrompt, budget)
        │
        ▼
[Batch 1, Batch 2, ..., Batch N]   (deterministic, every operation in exactly one batch)
        │
        ▼ (sequential — one at a time, existing RequestQueue semantics preserved)
runBatchedInference(): for each batch, buildRequest → provider.infer() → parse/validate →
                        merge into running result; record BatchOutcome; check overall
                        budget (dependency detection only) before starting next batch
        │
        ▼
aggregate BatchOutcome[] → AIProviderOutcome / DependencyAIOutcome ("success" | "partial" |
                            "timeout" | "unavailable" | "invalid-response" | "skipped")
        │
        ▼
merged relationships/scenarios (from all successful batches) + deterministic baseline,
same validation/deduplication/provenance pipeline as today
        │
        ▼ (aiEnhancement pass only)
runAiEnhancement() maps aiProviderOutcome → StageStatus ("success"→"complete",
                    "partial"→"partial", else→"skipped") → rendered distinctly by
                    AiEnhancementStage.tsx / TestGenerationWorkflowPage.tsx / WorkflowStageTracker.tsx
```
