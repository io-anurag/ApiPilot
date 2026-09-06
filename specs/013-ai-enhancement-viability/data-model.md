# Phase 1 Data Model: AI Enhancement Viability on Local CPU Inference

**Feature**: `013-ai-enhancement-viability`
**Date**: 2026-09-06

Entities are grouped by ownership. Only the shared-domain group crosses the backend/frontend
boundary; everything else is backend-internal and must not leak into a shared contract
(constitution VI, IX).

---

## Shared Domain (`packages/shared-domain/src/`)

### `AiEnhancementProgress` (extended)

Extends the type introduced by `012-ai-enhancement-progress`. Present only while a run is active;
absent the moment the stage reaches a terminal status.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `totalBatches` | `number` | yes | Unchanged. `0` until the first batch is planned. |
| `batches` | `BatchProgress[]` | yes | Unchanged. |
| `startedAt` | `string` (ISO 8601) | yes | Unchanged. When the run was accepted. |
| `phase` | `"preparing" \| "generating"` | **new**, yes | `"preparing"` while the engine loads; `"generating"` once the first batch's inference has begun. |
| `generatingSince` | `string` (ISO 8601) | **new**, no | Set when `phase` first becomes `"generating"`. Absent while preparing. |
| `cancelRequested` | `boolean` | **new**, yes | `true` once a cancel has been accepted; the run may still be settling. |

**Validation rules**

- `phase` is `"preparing"` if and only if `generatingSince` is absent.
- `phase` transitions one way only: `"preparing"` → `"generating"`. It never returns.
- `generatingSince` is never earlier than `startedAt`.
- `cancelRequested` transitions `false` → `true` only. A cancel cannot be withdrawn.
- `totalBatches` is `0` while `phase` is `"preparing"`, because batch planning requires the loaded
  engine's capacity (research.md Decision 2).

**Why elapsed time is not a field**: the client derives it from `generatingSince` and the current
clock (research.md Decision 8). Storing a ticking value would make every poll response differ and
tie display smoothness to poll frequency.

**Supersedes**: `012` FR-005 hid all progress when `totalBatches <= 1`. The batch *list* remains
hidden in that case, but `phase` and elapsed time are rendered for every run.

---

### `FailureExplanation` (new)

The user-facing account of a non-success outcome. Deliberately separate from `aiErrorMessage`,
which retains internal diagnostic text for logs only (constitution XX).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `category` | `FailureExplanationCategory` | yes | See below. Not the same as `AIErrorCategory`. |
| `summary` | `string` | yes | One plain-language sentence. No internal identifiers (FR-024). |
| `nextStep` | `string` | yes | A concrete action. Never "retry" when retry cannot help (FR-025). |
| `retryable` | `boolean` | yes | Whether the UI should offer a retry control at all. |

```ts
type FailureExplanationCategory =
  | "too-slow"        // TIMEOUT — model too slow for this workload on this machine
  | "not-viable"      // pre-flight refusal — projected duration exceeds the budget
  | "unavailable"     // NOT_READY | LOAD_FAILED | PROVIDER_UNAVAILABLE
  | "unusable-output" // INVALID_RESPONSE
  | "too-large"       // INVALID_REQUEST — a single operation exceeds capacity
  | "cancelled";      // user-initiated
```

**Validation rules**

- `summary` and `nextStep` are non-empty and must not contain: an error-class name, an environment
  variable name, a file path, or a raw diagnostic string (FR-024). Enforced by unit test against a
  deny-list of known internal tokens.
- `retryable` is `false` for `"too-slow"` and `"not-viable"` under unchanged conditions — the
  defining case the current UI gets wrong by offering an identical retry for every category.
- `retryable` is `true` for `"unusable-output"` and `"cancelled"`.

**Mapping is a pure function**: `(AIErrorCategory | "cancelled" | "not-viable", context) → FailureExplanation`,
so it is directly unit-testable without a provider (constitution XXI).

---

### `WorkflowStageState` (extended)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `aiErrorCategory` | `AIErrorCategory` | no | Unchanged. Retained for logs and existing consumers. |
| `aiErrorMessage` | `string` | no | Unchanged shape, **changed audience**: internal diagnostics only; no longer rendered by the frontend. |
| `failureExplanation` | `FailureExplanation` | **new**, no | Present for `aiEnhancement` when status is `skipped` or `partial`. What the user reads. |
| `cancelled` | `boolean` | **new**, no | `true` when the terminal status resulted from user cancellation (research.md Decision 10). |

**State transitions** — unchanged from `011`/`012`. No `StageStatus` member is added:

```text
active ──── all batches succeed ─────────────► complete
       ├─── some succeed, some fail/refuse ──► partial   (+ failureExplanation)
       ├─── none succeed ────────────────────► skipped   (+ failureExplanation)
       ├─── pre-flight refuses everything ───► skipped   (+ failureExplanation: not-viable)
       └─── cancelled, none retained ────────► skipped   (+ cancelled: true)
            cancelled, some retained ────────► partial   (+ cancelled: true)
```

`cancelled: true` may accompany only `skipped` or `partial`, never `complete`.

---

## Backend Internal (`backend/src/ai/`)

### `ModelCapacity` (new, provider-internal)

Resolved once at engine load and shared by batch planning and the oversized-input guard, so the
two cannot disagree (FR-008).

| Field | Type | Notes |
| --- | --- | --- |
| `contextWindowTokens` | `number` | `min(max_position_embeddings, model_max_length)` (research.md Decision 2). |
| `source` | `"model-config" \| "tokenizer" \| "conservative-floor"` | How it was determined; logged, never surfaced to users. |
| `isFallback` | `boolean` | `true` when the 2,048-token conservative floor was applied (Decision 3). |

**Validation rules**

- `contextWindowTokens` is a positive finite integer. A non-finite value from either source is
  discarded rather than propagated.
- When both sources are unusable, `contextWindowTokens` is `2048`, `source` is
  `"conservative-floor"`, `isFallback` is `true` — never `undefined` (FR-006).
- The measured discrepancy this exists to fix: `max_position_embeddings` 32,768 against
  `model_max_length` 131,072.

---

### `InferenceRates` (new, provider-internal)

Runtime-calibrated throughput used only by the pre-flight estimate.

| Field | Type | Notes |
| --- | --- | --- |
| `prefillMsPerToken` | `number` | Seeded at 2.0; updated by EWMA from completed inferences. |
| `decodeMsPerToken` | `number` | Seeded at 130; updated by EWMA. |
| `sampleCount` | `number` | Completed inferences folded in so far. |

**Validation rules**

- Both rates stay strictly positive; a non-positive or non-finite observation is discarded.
- Seeds are configuration, not literals in domain code, and are injectable for tests.
- **Reproducibility constraint (constitution XXIV)**: these values gate only *whether* a run is
  attempted. They must never influence prompt content, candidate validation, deduplication order,
  or which scenarios are retained. Asserted by SC-009.

---

### `ViabilityEstimate` (new, pure)

Produced before any inference begins (FR-014).

| Field | Type | Notes |
| --- | --- | --- |
| `promptTokens` | `number` | Estimated from prompt characters and the chars-per-token estimate. |
| `maxOutputTokens` | `number` | The allowance for this request. |
| `projectedMs` | `number` | `promptTokens x prefillMsPerToken + maxOutputTokens x decodeMsPerToken`. |
| `budgetMs` | `number` | The configured inference timeout. |
| `safetyFactor` | `number` | Default 1.5. Refuse only when `projectedMs > budgetMs x safetyFactor`. |
| `viable` | `boolean` | The verdict. |

**Validation rules**

- `viable` is `false` only when `projectedMs > budgetMs * safetyFactor`, so a marginal
  misestimate never blocks a run that would have succeeded (research.md Decision 6).
- A `false` verdict must yield a refusal citing `projectedMs` and `budgetMs` in human units
  (FR-015) — never raw milliseconds in user-facing text.
- Pure and total: same inputs always give the same estimate, with no I/O.

**Worked example from the measured defect**: `promptTokens` 5,845, `maxOutputTokens` 1,024,
q8 rates → `projectedMs` ≈ 2,060,000 against `budgetMs` 300,000. Ratio ≈ 6.9x, far beyond the 1.5x
safety factor, so the run is refused in milliseconds instead of failing after five minutes.

---

## Backend Internal (`backend/src/testDesign/`)

### `OperationContractSummary` (new)

The projection sent to the model in place of the full `ApiModel` (research.md Decision 4). A
**derived view**, never persisted, never returned over HTTP, and never used for validation.

| Field | Type | Notes |
| --- | --- | --- |
| `path` | `string` | |
| `method` | `string` | |
| `operationId` | `string \| undefined` | |
| `parameters` | `ParameterSummary[]` | name, location, required, type, enum, constraints. |
| `requestBodyFields` | `FieldSummary[]` | name, type, required, enum, constraints. |
| `responseStatusCodes` | `string[]` | Documented codes only — never invented (constitution I). |

Dropped relative to today's prompt: descriptions, examples, tags, server blocks, security blocks,
unreferenced component schemas, and the full deterministic scenario objects (replaced by a compact
category-plus-target-field list).

**Critical invariant (FR-010, constitution I)**: this projection is what the model *sees*. It is
**not** what candidates are validated against. `validateAICandidateSemantics` continues to run
against the **full** `ApiModel`, so a candidate referencing a field absent from the projection is
still rejected on the same evidence as today. Narrowing the prompt must never narrow validation.

**Measured target**: ~22,095 chars → ~2,000-4,000 chars on the Pet Store fixture. The realised
factor is to be measured and recorded during implementation, not assumed.

---

## Entity Relationships

```text
ModelCapacity ──── constrains ────► batch planning (splitOperationsIntoBatches)
      │
      └─────────── calibrates ────► oversized-input guard   [one source, FR-008]

InferenceRates ──► ViabilityEstimate ──► refuse before infer()   [gates attempt only]
                                              │
                                              └──► FailureExplanation("not-viable")

ApiModel ──project──► OperationContractSummary ──► prompt ──► model
   │
   └──────────────── validation (unchanged, full fidelity) ◄── candidates

AiEnhancementProgress ──terminal──► WorkflowStageState
                                      ├── failureExplanation  (user-facing)
                                      ├── aiErrorMessage      (logs only)
                                      └── cancelled
```

## Traceability

| Entity | Requirements | Research decision |
| --- | --- | --- |
| `ModelCapacity` | FR-005, FR-006, FR-007, FR-008 | 2, 3 |
| `InferenceRates` | FR-011, FR-014, FR-028 | 6 |
| `ViabilityEstimate` | FR-014, FR-015, FR-016 | 6 |
| `OperationContractSummary` | FR-009, FR-010 | 4 |
| `AiEnhancementProgress` (ext.) | FR-018, FR-019, FR-022 | 8 |
| `FailureExplanation` | FR-023, FR-024, FR-025, FR-026 | 9 |
| `WorkflowStageState` (ext.) | FR-016, FR-021, FR-030 | 9, 10 |
