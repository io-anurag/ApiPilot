# Contract: AI Enhancement Progress (v2)

**Feature**: `013-ai-enhancement-viability`
**Extends**: [`012-ai-enhancement-progress/contracts/ai-enhancement-progress.md`](../../012-ai-enhancement-progress/contracts/ai-enhancement-progress.md)

Additive extension. Every field defined by `012` keeps its shape and meaning; a client written
against v1 continues to work and simply ignores the new fields.

## `GET /api/test-generation-workflow`

Unchanged endpoint, extended `stages.aiEnhancement` payload.

### While a run is preparing the model

Batch planning requires the loaded engine's capacity, so `totalBatches` is `0` and `batches` is
empty until preparation finishes. This is the state that previously rendered as an unexplained
wait — including the ~500 MB first-run download.

```json
{
  "workflow": {
    "stages": {
      "aiEnhancement": {
        "stageId": "aiEnhancement",
        "status": "active",
        "progress": {
          "totalBatches": 0,
          "batches": [],
          "startedAt": "2026-09-06T09:35:58.521Z",
          "phase": "preparing",
          "cancelRequested": false
        }
      }
    }
  }
}
```

### While a run is generating

```json
{
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
    "cancelRequested": false
  }
}
```

### Field rules

| Field | Rule |
| --- | --- |
| `phase` | `"preparing"` or `"generating"`. Transitions one way only and never returns to `"preparing"`. |
| `generatingSince` | Present if and only if `phase` is `"generating"`. Never earlier than `startedAt`. |
| `cancelRequested` | Transitions `false` → `true` only; a cancel cannot be withdrawn. |
| `totalBatches` | `0` while `phase` is `"preparing"`. |

**Elapsed time is not transmitted.** Clients compute it as `now - generatingSince` (and
`now - startedAt` while preparing). The server never sends a ticking value, so responses stay
stable between real state changes.

**Supersedes `012` FR-005**: `012` hid all progress when `totalBatches <= 1`, on the assumption
that single-batch runs were the fast path. The context-window defect (research.md Decision 2) made
single-batch the *only* path, so that rule suppressed progress for 100% of real runs. The batch
*list* is still hidden for a single batch; `phase` and elapsed time are shown for every run.

---

## Terminal states

Once a run reaches `complete`, `partial`, or `skipped`, `progress` is absent (unchanged from
`012`). Non-success terminal states now carry a user-facing explanation.

```json
{
  "stages": {
    "aiEnhancement": {
      "stageId": "aiEnhancement",
      "status": "skipped",
      "aiErrorCategory": "TIMEOUT",
      "aiErrorMessage": "Inference exceeded the configured timeout of 300000ms",
      "failureExplanation": {
        "category": "too-slow",
        "summary": "The local AI model was too slow to finish this on this machine.",
        "nextStep": "Try a smaller specification, or see the setup notes on making local inference faster.",
        "retryable": false
      }
    }
  }
}
```

| Field | Audience | Rule |
| --- | --- | --- |
| `aiErrorCategory` | internal + clients | Unchanged. |
| `aiErrorMessage` | **logs only** | Shape unchanged, audience narrowed. Clients MUST NOT render it — it is the string that leaked `300000ms` to users. |
| `failureExplanation` | users | Present for `skipped` and `partial`. Absent for `complete`. |
| `cancelled` | users | `true` only when the terminal status came from user cancellation. Never with `complete`. |

`failureExplanation.summary` and `.nextStep` MUST NOT contain an error-class name, environment
variable name, file path, or raw diagnostic string (FR-024). `retryable` is `false` for
`"too-slow"` and `"not-viable"`, because under unchanged conditions a retry repeats the same loss
(FR-025).

---

## Pre-flight refusal

A run refused before inference begins (FR-014) returns quickly — target under 10 s (SC-002) versus
the 300 s it currently takes — and resolves to the existing `skipped` status. No new
`StageStatus` member is introduced.

```json
{
  "stages": {
    "aiEnhancement": {
      "status": "skipped",
      "aiErrorCategory": "TIMEOUT",
      "aiErrorMessage": "Pre-flight estimate 2060s exceeds budget 300s by 6.9x",
      "failureExplanation": {
        "category": "not-viable",
        "summary": "This specification needs about 34 minutes of AI processing, but the current limit is 5 minutes.",
        "nextStep": "Enhance a smaller specification, or raise the inference time limit in your configuration.",
        "retryable": false
      }
    }
  }
}
```

User-facing text states durations in human units; raw milliseconds stay in `aiErrorMessage`.

## Backward compatibility

- No field is removed, renamed, or retyped.
- No new `StageStatus` member (research.md Decision 10), so the workflow store's transition
  validator and every existing consumer are unaffected.
- `POST /api/test-generation-workflow/ai-enhancement` keeps its existing request shape, response
  shape, and `409 ai_enhancement_already_running` guard from `012`.
