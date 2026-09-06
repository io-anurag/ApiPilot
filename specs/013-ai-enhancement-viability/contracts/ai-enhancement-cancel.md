# Contract: Cancel AI Enhancement

**Feature**: `013-ai-enhancement-viability`
**Requirements**: FR-017, FR-020, FR-021
**Research**: [Decision 7](../research.md), [Decision 10](../research.md)

New endpoint. Follows the thin-route convention of every other stage endpoint: validate, delegate
to the stage module, map the domain result to HTTP.

## `POST /api/test-generation-workflow/ai-enhancement/cancel`

Requests cancellation of the AI enhancement run currently in progress.

### Request

No body. The workflow is the single current in-process workflow, as with every other stage route.

### Responses

#### `202 Accepted` — cancellation accepted

Returned as soon as the request is recorded, **without waiting for the run to settle**. This is
what returns interactive control to the user within 5 s (SC-008).

```json
{
  "workflow": {
    "stages": {
      "aiEnhancement": {
        "status": "active",
        "progress": {
          "totalBatches": 3,
          "batches": [
            { "index": 0, "status": "succeeded" },
            { "index": 1, "status": "in-progress" },
            { "index": 2, "status": "pending" }
          ],
          "startedAt": "2026-09-06T09:35:58.521Z",
          "phase": "generating",
          "generatingSince": "2026-09-06T09:36:11.204Z",
          "cancelRequested": true
        }
      }
    }
  }
}
```

`202` rather than `200` is deliberate: cancellation is accepted, not completed. An in-flight
generation cannot be interrupted (research.md Decision 7), so the run settles shortly afterwards.
Clients observe the terminal state through the existing poll rather than from this response.

#### `409 no_run_in_progress` — nothing to cancel

```json
{
  "error": "no_run_in_progress",
  "message": "No AI enhancement run is currently in progress."
}
```

Returned when `stages.aiEnhancement.progress` is absent — the same "is a run active?" signal the
`409 ai_enhancement_already_running` guard from `012` uses, read in the opposite direction, so the
two cannot disagree.

#### `409 stage_not_active` — wrong stage

Matches the existing refusal shared by every stage-transition route.

### Idempotency

Cancelling an already-cancelled run returns `202` again with `cancelRequested` still `true`. The
flag transitions `false` → `true` only and cannot be withdrawn.

---

## Resulting terminal state

Cancellation resolves to an **existing** status; no `StageStatus` member is added
(research.md Decision 10).

| Scenario | Status | `cancelled` | Retained |
| --- | --- | --- | --- |
| Cancelled, no batch had succeeded | `skipped` | `true` | Deterministic baseline only |
| Cancelled, at least one batch had succeeded | `partial` | `true` | Baseline + scenarios from succeeded batches |

```json
{
  "stages": {
    "aiEnhancement": {
      "status": "partial",
      "cancelled": true,
      "failureExplanation": {
        "category": "cancelled",
        "summary": "AI enhancement was cancelled before it finished.",
        "nextStep": "The scenarios generated before you cancelled have been kept. You can continue, or run enhancement again.",
        "retryable": true
      }
    }
  }
}
```

Scenarios already merged into `reviewWorkspace` by `012`'s incremental population are **kept**
(FR-021), and any review decision already recorded against them survives, exactly as for a
`partial` outcome from batch failure.

## Behavioural guarantees

- **Between batches** cancellation is precise: remaining batches become `not-attempted`, reusing
  the check point where `runBatchedInference` already evaluates `isTimedOut`.
- **Within a batch** it is not: the in-flight computation runs to completion and its result is
  discarded. The user is released immediately regardless.
- **No orphan contention** (FR-017): the request queue will not start a new task while a previous
  abandoned computation is still settling, so a retry can no longer compete with work already
  given up on — the CPU-contention defect behind the original report.
- **The deterministic baseline is never touched** by cancellation, in any ordering (FR-031,
  SC-010).

## Known limitation

Cancellation cannot interrupt native inference mid-call; Transformers.js exposes no abort signal.
True cancellation would require worker-thread isolation, evaluated and deliberately rejected as
disproportionate under constitution XXVII (research.md Decision 7). Because early stopping and the
prompt projection reduce a typical generation to seconds, the residual orphan window is small — as
opposed to the ~34 minutes it would have been before this feature.
