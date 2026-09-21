# Phase 1 Data Model: Frontend Design System & Application Shell

This feature introduces no backend data, no persistence, and no change to
`packages/shared-domain` types. It introduces exactly one **presentation-level view-model**,
derived entirely client-side from data the frontend already receives.

## Workflow Stage (view-model)

Derived from the existing `TestGenerationWorkflow` domain object
(`packages/shared-domain/src/testGenerationWorkflow.ts`) — not a new wire type, not persisted,
recomputed on every render from `workflow.stages` and `WORKFLOW_STAGE_ORDER`.

| Field | Type | Derivation |
|-------|------|------------|
| `stageId` | `WorkflowStageId` (existing) | One entry per `WORKFLOW_STAGE_ORDER` member. |
| `label` | `string` | Existing `WorkflowStageTracker.STAGE_LABELS[stageId]`. |
| `displayStatus` | `"completed" \| "active" \| "pending" \| "locked"` | Mapped from the existing `StageStatus` (`not-yet-reached` → `locked` if a prior stage in order is incomplete, else `pending`* ; `active` → `active`; `complete` → `completed`; `stale`/`partial`/`skipped` retain their existing `StatusBadge` tone/label unchanged — this mapping only affects the shell's summary view, not `WorkflowStageTracker`'s own per-stage badge, which is unchanged). |
| `lockReason` | `string \| undefined` | Present only when `displayStatus === "locked"`: `"Complete {label of the nearest incomplete predecessor in WORKFLOW_STAGE_ORDER} first"`. |

\* In the current strictly-sequential workflow, every `not-yet-reached` stage is in fact always
locked (its predecessor can't be incomplete while it is itself reachable), so `pending` without a
predecessor gap should not occur today; the distinction is kept in the type only so the shell
component doesn't have to assume strict sequencing forever (FR-004 is about explaining locks that
exist, not about guaranteeing every future workflow shape is strictly linear).

**Validation rules**: None beyond what the existing domain type already guarantees — this
view-model is a pure, side-effect-free function of already-validated data
(`stage → displayStatus/lockReason`). It performs no independent validation and must not be
treated as a second source of truth for stage status; `WorkflowStageTracker`'s existing
`StatusBadge`-driven rendering remains authoritative for per-stage status text.

**State transitions**: None — this is a derived read model recomputed on every render; it has no
transitions of its own. It changes only when the underlying `TestGenerationWorkflow` changes.

## Why no `contracts/`

This feature has no HTTP endpoint, request/response shape, or other externally-facing interface
change (spec FR-012). The one new concept above is an internal frontend view-model, not an
interface contract, so there is nothing appropriate to place under `contracts/`.
