# Contract Delta: AI Enhancement Progress

This feature makes an **additive** change to two existing, already-documented HTTP contracts.
It does **not** add a new endpoint. Full request/response shapes remain defined in their owning
specs:

- Workflow endpoints: [specs/009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md](../../009-e2e-test-generation-workflow/contracts/test-generation-workflow-api.md)
- Batching outcome semantics (unchanged by this feature): [specs/011-ai-prompt-batching/contracts/ai-batching-outcome.md](../../011-ai-prompt-batching/contracts/ai-batching-outcome.md)

## What changes

### 1. `GET /api/test-generation-workflow` — new optional `progress` field

`stages.aiEnhancement` gains one new optional field, `progress`. Present only while an AI
enhancement run is actively in flight for the current workflow; absent (`undefined`, omitted
from JSON) at every other time, including before the first run and once any run reaches a
terminal outcome (`complete`/`partial`/`skipped`).

```json
{
  "workflow": {
    "...": "...unchanged...",
    "stages": {
      "aiEnhancement": {
        "stageId": "aiEnhancement",
        "status": "active",
        "enteredAt": "2026-09-05T13:00:00.000Z",
        "progress": {
          "totalBatches": 5,
          "startedAt": "2026-09-05T13:00:00.100Z",
          "batches": [
            { "index": 0, "status": "succeeded" },
            { "index": 1, "status": "succeeded" },
            { "index": 2, "status": "in-progress" },
            { "index": 3, "status": "pending" },
            { "index": 4, "status": "pending" }
          ]
        }
      }
    }
  }
}
```

Once the run finishes, `progress` is absent again and `status`/`aiErrorCategory`/
`aiErrorMessage` report the final outcome exactly as documented today (no change to that
existing contract) — e.g.:

```json
{
  "stages": {
    "aiEnhancement": {
      "stageId": "aiEnhancement",
      "status": "partial",
      "aiErrorCategory": "TIMEOUT",
      "aiErrorMessage": "AI provider timed out for 1 of 5 batches; deterministic scenarios and partial AI results were preserved"
    }
  }
}
```

While a run is active and batches are succeeding, `reviewWorkspace.scenarios` also grows
incrementally between polls — each succeeded batch's newly-retained scenarios (research.md
Decision 4) appear as new `pending` `ReviewScenario` entries as soon as that batch completes,
not only once the whole run finishes. `reviewWorkspace.summary`'s counts update accordingly on
each poll. No existing field of `ReviewScenario`/`ReviewWorkspaceSnapshot` changes shape.

### 2. `POST /api/test-generation-workflow/ai-enhancement` — new `409` case

A new rejection case, additive to the existing `409 stage_not_active` case already documented
for this endpoint:

**Request**: (unchanged — no body)

**Response**: `409`, when a run is already in progress for the current workflow (a second call
arrives while `stages.aiEnhancement.progress` is still present):

```json
{
  "error": "ai_enhancement_already_running",
  "message": "AI enhancement is already in progress; wait for it to finish before retrying."
}
```

The existing success/partial/skipped response shapes for this endpoint (once a run *does*
complete) are unchanged — this feature does not alter what the endpoint returns when it
resolves, only what happens if it is called again while already running, and what can be
observed via `GET /api/test-generation-workflow` while it is running.

## Consumer impact

- Frontend: `AiEnhancementStage.tsx` and its client (`testGenerationWorkflowClient.ts`) start
  polling `fetchCurrentWorkflow()` once a run begins, reading `stages.aiEnhancement.progress`
  to render batch-level status, and stop polling once `progress` is absent and `status` is a
  terminal value. No existing consumer of `TestGenerationWorkflow` breaks — `progress` is a new
  optional field, and every other field keeps its existing meaning.
- Any code that already reads `stages.aiEnhancement.status`/`aiErrorCategory`/`aiErrorMessage`
  for the terminal outcome (per specs/011) is unaffected — those fields behave exactly as
  before once a run finishes.
