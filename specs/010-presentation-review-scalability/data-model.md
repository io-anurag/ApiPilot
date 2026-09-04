# Data Model: Presentation System & Review Scalability

**Input**: [spec.md](./spec.md) Key Entities · [research.md](./research.md) D2–D5, D7

This feature adds no field to any persisted or transmitted domain type
(`TestGenerationWorkflow`, `ReviewScenario`, `ReviewDecision`, `IntegrationWorkflow`,
`WorkflowReviewDecision`, `DependencyAnalysisResult` — all unchanged, per spec FR-018 and
research.md D2/D4). The entities below are UI-local concepts introduced to satisfy the spec's Key
Entities; none of them cross the network as their own payload — they exist only to produce calls to
the two existing bulk decision endpoints.

## Bulk Review Selection (spec Key Entity)

Transient, component-local state representing what a QA engineer has chosen to decide on together.
Two independent shapes, one per review screen, since Scenario Review has filters and Workflow
Review does not (research.md D7):

### Scenario Review selection (`TestScenarioReviewList`)

| Field | Type | Notes |
|---|---|---|
| `operationFilter` | `string` (`"all"` or an operation key) | Already exists today. |
| `categoryFilter` | `string` (`"all"` or a category) | Already exists today. |
| `manualSelectionIds` | `Set<string>` (scenario ids) | New. Populated by per-row checkboxes. |

**Derived sets** (computed, never stored):
- *Filtered set* = scenarios matching `operationFilter` and `categoryFilter` (existing `filtered`
  array) — the target of the "accept/reject all filtered" actions (FR-004).
- *Manual set* = scenarios whose id is in `manualSelectionIds` — the target of the "accept/reject
  selected" actions (FR-005).

**Lifecycle rule** (FR-019): whenever `operationFilter` or `categoryFilter` changes,
`manualSelectionIds` is cleared to the empty set. The filtered set has no independent lifecycle — it
is always a pure function of the current filters and the current scenario list.

### Workflow Review selection (`WorkflowReviewStage`)

| Field | Type | Notes |
|---|---|---|
| `manualSelectionIds` | `Set<string>` (workflow ids) | New. Workflow Review has no filters (research.md D7), so there is only one selection mechanism. |

## Bulk Action Confirmation (new, transient)

The state backing the confirmation step required by FR-011/SC-007, held by whichever stage
component triggered it:

| Field | Type | Notes |
|---|---|---|
| `pendingAction` | `{ kind: "accept" \| "reject" \| "approve" \| "reject-workflow"; targetIds: string[] }` \| `null` | Set when a bulk trigger is clicked, before the endpoint is called. |
| `reason` | `string` \| `undefined` | Collected inline in the confirmation step for a bulk **reject**, mirroring the existing single-scenario reject requirement (FR-007); one shared value applied to every targeted scenario (spec Assumptions). |

Confirming clears `pendingAction` and starts the batched submission (below); cancelling clears it
with no request sent.

## Bulk Decision Run (new, transient — `useBulkDecision`)

Tracks one in-flight batched submission against an already-existing endpoint (research.md D5):

| Field | Type | Notes |
|---|---|---|
| `total` | `number` | `targetIds.length` at the moment the run started. |
| `processed` | `number` | Items included in batches already sent (successful or not). |
| `succeeded` | `number` | Sum of `applied === true` outcomes so far (scenarios), or items from all-successful batches (workflows, research.md D4). |
| `failed` | `ReadonlyArray<{ id: string; message: string }>` | One entry per item that came back `applied: false` (scenarios), or every id in a failed batch (workflows). |
| `status` | `"running" \| "done" \| "cancelled"` | Drives the progress UI; `"done"` triggers the final succeeded/failed summary (FR-012). |

This state is discarded once its summary has been shown and the underlying workflow/review data has
refreshed from the server response — it is never part of `TestGenerationWorkflow`.

## Unchanged entities (referenced, not modified)

| Entity | Source | Role in this feature |
|---|---|---|
| `ReviewScenario` / `ReviewDecision` / `ReviewUpdateRequest` / `ReviewUpdateOutcome` | `packages/shared-domain/src/testScenarioReview.ts` | A bulk scenario action is just `ReviewUpdateRequest[]` built from the selection above; results read from the existing `ReviewUpdateOutcome[]` (research.md D3). |
| `IntegrationWorkflow` / `WorkflowReviewDecision` | `packages/shared-domain/src/{apiDependency,testGenerationWorkflow}.ts` | A bulk workflow action is `WorkflowDecisionInput[]` built from the selection above (research.md D4). |
| `TestGenerationWorkflow`, `WorkflowStageId`, `StageStatus` | `packages/shared-domain/src/testGenerationWorkflow.ts` | Read-only; drives which stage screen is shown and its styling, per FR-001–FR-003. |
