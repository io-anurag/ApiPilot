# Contract: Bulk Review Actions

This feature introduces **no new HTTP endpoint, request/response shape, or shared-domain type**
(research.md D2, D4). Both bulk review actions are the frontend calling the two array-accepting
endpoints AP-009 already exposes, one or more times per bulk action (research.md D5). This document
is the usage contract the new UI code must follow — a consumer contract, not a new server contract.

## Scenario Review bulk decisions

**Endpoint** (unchanged): `POST /api/test-generation-workflow/scenario-review/decisions`
**Body** (unchanged): `{ "updates": ReviewUpdateRequest[] }`
**Response** (unchanged): `{ "workflow": TestGenerationWorkflow, "outcomes": ReviewUpdateOutcome[] }`

### How the new UI builds `updates`

| Trigger | `updates` contents |
|---|---|
| "Accept/Reject all filtered" (FR-004) | One `{ scenarioId, revision, action }` per scenario currently in the operation/category-filtered list, in list order. |
| "Accept/Reject selected" (FR-005) | One `{ scenarioId, revision, action }` per scenario in the manual selection, in selection order. |
| Bulk **reject** only (FR-007) | Every entry additionally carries the one shared `reason` collected at confirmation. |

`revision` MUST be the value the client currently holds for that scenario (the same field the
existing single-item reject already sends) — the endpoint's existing `stale-revision` finding is
what surfaces a concurrent edit to the QA engineer; this feature does not add a new staleness check.

### Batching (research.md D5)

Above a fixed batch-size threshold (an implementation constant, not a spec-mandated number), the
`updates` array is split into ordered, contiguous chunks, each sent as a separate call to the same
endpoint; the UI updates its progress state between calls. Below the threshold, one call is made.
Chunking MUST NOT reorder items or split a chunk across an already-decided/not-yet-decided boundary
— it is purely a transport-size concern, invisible to the domain.

### Reading the result (FR-012, research.md D3)

For each response, match each request item to its outcome by `scenarioId`:
- `outcome.applied === true` → counts toward "succeeded".
- `outcome.applied === false` → counts toward "failed"; `outcome.finding.message` is the reason
  shown to the QA engineer for that specific scenario.

The final summary shown to the QA engineer is the sum of succeeded/failed across every chunk sent
for that bulk action.

## Workflow Review bulk decisions

**Endpoint** (unchanged): `POST /api/test-generation-workflow/workflow-review/decisions`
**Body** (unchanged): `{ "decisions": WorkflowDecisionInput[] }` where
`WorkflowDecisionInput = { workflowId: string; state: "approved" | "rejected"; reason?: string }`
**Response** (unchanged): `{ "workflow": TestGenerationWorkflow }` on success, or a `400
unknown_workflow_id` error body (no partial application — research.md D4).

### How the new UI builds `decisions`

One `{ workflowId, state }` per workflow in the manual selection (Workflow Review has no filters —
research.md D7).

### Batching

Same chunking rule as scenarios (research.md D5), sent to the same endpoint.

### Reading the result (FR-012, research.md D4)

Because this endpoint is atomic per call, each chunk is either wholly successful (every id in that
chunk counts as succeeded) or wholly failed (every id in that chunk counts as failed, with the
response's `message` shown once for the chunk). This is the intentionally simpler, honest behavior
research.md D4 settled on — it is not a regression from the scenario case, since the scenario case's
finer-grained reporting exists only because `ReviewUpdateOutcome[]` already exists for that endpoint.

## What callers must not do

- MUST NOT introduce a new endpoint path for "bulk" variants of either action — the existing paths
  already accept arrays.
- MUST NOT change `ReviewUpdateRequest`, `ReviewUpdateOutcome`, `WorkflowDecisionInput`, or any other
  shared-domain type to support this feature (FR-018).
- MUST NOT skip the confirmation step (FR-011) before sending the first chunk of any bulk action.
