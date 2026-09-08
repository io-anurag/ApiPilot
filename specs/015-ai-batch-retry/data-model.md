# Phase 1 Data Model: AI Enhancement Batch Retry

**Feature**: `015-ai-batch-retry`
**Date**: 2026-09-08

Entities are grouped by ownership. Only the shared-domain group crosses the backend/frontend
boundary (constitution VI, IX, X).

---

## Shared Domain (`packages/shared-domain/src/`)

### `BatchOutcomeRecord` (new)

The persisted, per-batch result of one AI Enhancement run — survives past the run settling, unlike
`AiEnhancementProgress`/`BatchProgress`, which are cleared the moment the stage reaches a terminal
status (research.md Decision 1). Holds only the latest attempt for its batch (`/speckit-clarify`
2026-09-08); a retry overwrites this record in place.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `index` | `number` | yes | Position within the run's batch plan, `0`-based. Stable identifier used by the retry endpoint. |
| `operationKeys` | `string[]` | yes | `"METHOD /path"` for every operation this batch covered, pinned at the run's first attempt (research.md Decision 2, FR-008). Never recomputed on retry. |
| `status` | `"succeeded" \| "failed" \| "not-attempted"` | yes | This batch's own terminal state, independent of the run's aggregate outcome. |
| `errorCategory` | `AIErrorCategory` | no | Present only when `status` is `"failed"`. Internal diagnostic detail (constitution XX) — not rendered directly. |
| `failureExplanation` | `FailureExplanation` | no | Present when `status` is `"failed"` or `"not-attempted"`. Produced by the existing `explainFailure()` (research.md Decision 4) — identical shape and rules to the run-level field of the same name. |

**Validation rules**

- `operationKeys` is non-empty and immutable across retries of the same batch — a retry may change
  `status`, `errorCategory`, and `failureExplanation`, never `operationKeys` or `index`.
- `failureExplanation` is present if and only if `status` is not `"succeeded"`.
- `errorCategory` is present only when `status` is `"failed"` (a `"not-attempted"` batch was never
  sent to the provider, so it has no provider error category — its `failureExplanation` is derived
  from `"cancelled"` or `"run-budget-exhausted"` instead, per research.md Decision 4).
- A retry of this batch replaces this record wholly (all fields recomputed together); no
  per-attempt history is kept (`/speckit-clarify` 2026-09-08).

---

### `WorkflowStageState` (extended)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `batchOutcomes` | `BatchOutcomeRecord[]` | **new**, no | Present only for `aiEnhancement`, once a run has produced at least one batch result. Populated incrementally as each batch settles (mirroring how `progress` is populated live today) and, unlike `progress`, retained after the stage reaches `complete`/`partial`/`skipped`. Empty/absent for a run that was refused pre-flight (`not-viable`) before any batch was planned. |

**State transitions** — unchanged from `011`/`012`/`013`/`014`. No `StageStatus` member or
transition is added (research.md Decision 3):

```text
skipped ──retry a batch──► active ──── every batch now succeeded ──► complete
partial ──retry a batch──► active ──── at least one batch still failed/not-attempted ──► partial
```

This is the exact `skipped->active`/`partial->active`/`active->complete`/`active->partial` path
`workflowStore.ts` already permits for whole-stage retry — a batch retry is the same transition,
scoped to fewer operations.

---

### `AIProvenance` (extended)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `aiBatchIndex` | `number` | **new**, no | The `BatchOutcomeRecord.index` of the batch that produced this scenario. Present on every AI-derived scenario produced from `015` onward; absent on scenarios produced before this feature shipped (no backfill — the workflow is in-memory and non-persistent across restarts per constitution XVII/research.md Decision 1, so no pre-existing data survives to need it). |

**Validation rules**

- `aiBatchIndex`, when present, matches the `index` of a `BatchOutcomeRecord` in the same run's
  `stages.aiEnhancement.batchOutcomes`.
- Every other `AIProvenance` field and rule (FR-010, specs/011/013) is unchanged — this is a pure
  addition, not a redefinition.

**Why here and not on `ReviewScenario`**: provenance is already the field that answers "where did
this scenario come from" (constitution XIII); adding the batch association there keeps a single
source of truth rather than introducing a second place scenario/batch association could drift.

---

## Backend Internal (`backend/src/testDesign/`)

### `retryOneBatch` (new, exported from `enhanceTestModel.ts`)

Not a data entity but the extracted function research.md Decision 5 introduces. Signature:

```ts
function retryOneBatch(
  operations: ApiOperation[],
  apiModel: ApiModelArg,
  testModel: TestModel, // the deterministic baseline, for dedupe scoping — unchanged semantics
  provider: AIProvider,
  requestId: string,
): Promise<
  | { outcome: "succeeded"; scenarios: TestScenario[] }
  | { outcome: "failed"; errorCategory: AIErrorCategory; errorMessage: string }
>
```

Internally reuses `runOneBatch` (request build, parse, shape/semantic validation) and the same
`deduplicate()`/`scenariosAreEquivalent()` scoping `enhanceTestModel` already applies, run against
`testModel.scenarios` (deterministic baseline) plus this batch's own new candidates only — not
against any other batch's prior output (research.md Decision 6, spec.md Assumptions).

---

## Entity Relationships

```text
AiEnhancementProgress ──per-batch settle──► BatchOutcomeRecord   [new: persists past terminal status]
                                                  │
                                                  ├── errorCategory       (logs only)
                                                  └── failureExplanation  (user-facing, retry gate)

BatchOutcomeRecord.operationKeys ──looked up in──► apiModel.operations ──► retryOneBatch() ──► provider

retryOneBatch() success ──► scenarios ──tagged──► AIProvenance.aiBatchIndex
                                  │
                                  └──merged via existing exact-ID dedup──► reviewWorkspace.scenarios

Every BatchOutcomeRecord now "succeeded" ──► WorkflowStageState.status = "complete"
Otherwise, at least one succeeded ─────────► WorkflowStageState.status = "partial"
```

## Traceability

| Entity | Requirements | Research decision | Clarification |
| --- | --- | --- | --- |
| `BatchOutcomeRecord` | FR-001, FR-002, FR-003, FR-005 | 1, 2, 4 | Latest-attempt-only |
| `WorkflowStageState.batchOutcomes` | FR-001, FR-006, FR-012 | 1, 3 | Aggregate status recompute |
| `AIProvenance.aiBatchIndex` | FR-010 | — | — |
| `retryOneBatch` | FR-002, FR-004, FR-009 | 5, 6 | — |
