# Phase 1 Data Model: AI Batching Policy and Run Pacing

**Feature**: `014-ai-batching-policy` | **Date**: 2026-09-06

This feature adds no new persisted state. It reshapes how existing work is divided and paced, and
extends two existing shared-domain types. Entities below are described by intent; field names are
indicative and settle during implementation.

---

## Existing types this feature touches

| Type | Location | Change |
| --- | --- | --- |
| `Batch<TOperation>` | `backend/src/ai/requestBatching.ts` | Unchanged in shape; produced by a new sizing policy |
| `BatchOutcome` | `backend/src/ai/requestBatching.ts` | Unchanged — `success` / `failed` / `not-attempted` already cover this feature's outcomes |
| `AggregateOutcome` | `backend/src/ai/requestBatching.ts` | Unchanged |
| `AiEnhancementProgress` | `packages/shared-domain/src/testGenerationWorkflow.ts` | Extended (below) |
| `BatchProgress` | `packages/shared-domain/src/testGenerationWorkflow.ts` | Unchanged |
| `FailureExplanation` | `packages/shared-domain` | Unchanged shape; `not-viable` category becomes reachable |
| `ViabilityEstimate` | `backend/src/ai/viability.ts` | Unchanged; becomes reachable |

The deliberate absence of new outcome states is a design constraint carried from
`013-ai-enhancement-viability`: cancellation and budget exhaustion resolve to the existing
`skipped` / `partial` stage statuses rather than introducing new members.

---

## Unit of work

**Represents**: The operations sent in one AI request — the atom of progress, cancellation, failure
isolation, and partial retention.

**Derivation**: Deterministic. `splitOperationsIntoBatches` gains a caller-supplied maximum operation
count and produces units by walking operations in specification order, so the same specification
always yields the same units in the same order (FR-005, FR-006, SC-008).

**Sizing** (research.md Decisions 1 and 7):

| Caller | Operations per unit | Source |
| --- | --- | --- |
| Scenario enhancement | 1 | Measured: 2 and 3 both truncate |
| Dependency analysis | To be measured after its prompt projection | Must satisfy SC-013 |

**Invariants**:
- Every operation appears in exactly one unit (FR-006).
- Unit order matches specification order (FR-005).
- The context-capacity check remains an upper bound: a unit that still does not fit is split further,
  and a single operation that cannot fit becomes a named, reported exclusion rather than being
  dropped (FR-002).

---

## Run plan

**Represents**: The ordered units for one run plus the count planned — what "how much is left" means
to the user.

**Attributes**: total unit count; ordered units; the run's start timestamp.

**Lifecycle**: Computed once when a run starts, after the provider is ready (the context budget needs
the loaded engine) and before the first unit is attempted. Immutable thereafter — a run's denominator
must not move under the user while they watch it.

**Relationships**: Drives `AiEnhancementProgress.totalBatches`, which the UI already renders.

---

## Run budget

**Represents**: The wall-clock ceiling for one whole run, distinct from the per-request inference
timeout.

**Attributes**: ceiling in milliseconds; the run's elapsed time measured from the point generation
begins (not from the request, so a one-time model load is not charged to it — the `generatingSince`
distinction `012` already established).

**Configuration**: `AI_ENHANCEMENT_RUN_BUDGET_MS`, default `300000` (research.md Decision 5),
validated at startup alongside existing AI configuration (FR-011).

**Behaviour**: Checked at unit boundaries only, alongside the existing cancellation check. On
exhaustion, remaining units are recorded `not-attempted` and the run settles `partial` (FR-010). A
unit already in flight when the ceiling elapses runs to completion and its result is kept — the
ceiling governs what is *started*, never what is discarded (edge case: "ceiling reached partway
through a unit").

---

## Unit outcome

**Represents**: How one unit settled, and why.

**States**: `success` | `failed` (with an error category) | `not-attempted` (run cancelled, or the
ceiling reached).

**Aggregation**: Unchanged from `deriveAggregateOutcome`. One consequence of this feature is that its
existing rules finally become reachable: with more than one unit per run, `partial` can occur, which
in the single-unit world it structurally could not.

**Relationships**: Each unit outcome maps to one `BatchProgress` entry the UI already renders.

---

## Viability estimate

**Represents**: A pre-flight projection of whether requested work can complete within the available
budget.

**Change**: No shape change. It becomes *reachable* — currently `estimateViability` is called from
nowhere in `backend/src`.

**Evaluation point**: Once per run, against a **single unit's** projected cost (research.md Decision
8). Uniform unit sizing is what makes one estimate representative of the whole run.

**Outcome**: When not viable, the run is refused before any generation, `failureExplanation` is set
from the existing `not-viable` branch, and the stage settles without an inference attempt (FR-013,
FR-014).

---

## Failure explanation

**Represents**: The user-facing account of a non-success outcome.

**Change**: No shape change. `retryable` becomes load-bearing where it currently is not: the UI
already honours it, but the `INVALID_RESPONSE` branch declares `retryable: true` and describes a
deterministic failure as intermittent (FR-019, FR-020).

**Required correction**: A repeatable unusable-output failure must not be described as intermittent
and must not offer retry. A run that produced *some* usable units is `partial` and legitimately
retryable — the distinction is between "no unit succeeded, and none will" and "some units failed,
others may succeed next time".

---

## Progress reporting

**Represents**: What the user sees during a run.

**Extension to `AiEnhancementProgress`**: The existing `totalBatches` / `batches` / `phase` /
`startedAt` / `generatingSince` / `cancelRequested` fields carry over unchanged. This feature adds the
run budget's remaining allowance, so the UI can convey how much of the planned work the ceiling will
permit (FR-012).

**Behavioural change without a shape change**: `BatchProgressList` currently renders nothing when
`totalBatches <= 1`. With one operation per unit that condition essentially stops occurring for real
specifications, so the per-unit list becomes visible as originally intended by
`012-ai-enhancement-progress`. The single-operation specification remains an edge case the UI must
still handle sensibly.

---

## Scenario provenance and validation

**Unchanged, and explicitly preserved** (FR-022 through FR-026):

- AI-derived scenarios keep `AI` provenance and remain distinguishable from deterministic ones.
- Candidates are still validated against the **full** `ApiModel`, not the unit's subset — a suggestion
  referencing anything outside the real contract is still rejected. Narrowing the model's *view* must
  never narrow the *validator's* view.
- Deduplication remains a stable first-seen-wins fold over units in deterministic order, so a scenario
  retained for an earlier unit is never revoked by a later one (FR-026).

---

## Dependency analysis prompt projection

**Represents**: The contract facts the model needs to infer relationships, and nothing else.

**Change**: `buildAIDependencyPrompt` currently serializes the entire raw `ApiModel` (measured 9,410
characters for two operations). It gains a projection mirroring what
`013-ai-enhancement-viability` did for the enhancement prompt: operation identity, parameters,
request-body field names and types, and response field names and types — the material from which a
producer/consumer relationship can be inferred — omitting descriptions, examples, tags, and nested
schema detail.

**Constraint**: As with enhancement, what is dropped is dropped from the model's *view* only.
Candidates remain validated against the full `ApiModel`.

**Contract version**: `AI_DEPENDENCY_RESPONSE_VERSION` increments 1 → 2 (XXIII).
