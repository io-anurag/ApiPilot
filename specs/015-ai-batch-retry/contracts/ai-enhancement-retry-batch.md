# Contract: Retry One AI Enhancement Batch

**Feature**: `015-ai-batch-retry`
**Requirements**: FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-012
**Research**: [Decisions 1, 2, 3, 8, 9](../research.md)

New endpoint. Follows the thin-route convention of every other AI Enhancement route (validate,
delegate to the stage module, map the domain result to HTTP) — same shape as
`specs/013-ai-enhancement-viability/contracts/ai-enhancement-cancel.md`.

## `POST /api/test-generation-workflow/ai-enhancement/retry-batch`

Retries exactly one batch from the most recent AI Enhancement run.

### Request

```json
{ "batchIndex": 3 }
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `batchIndex` | `number` | yes | Must match the `index` of a record in `stages.aiEnhancement.batchOutcomes`. |

### Responses

#### `200 OK` — retry settled (succeeded or failed again)

Returned once the retried batch's inference call has resolved — this endpoint does not poll or
stream; the client's existing `GET /api/test-generation-workflow` remains the way to observe
progress if the caller wants a live indicator while waiting for this response.

```json
{
  "workflow": {
    "stages": {
      "aiEnhancement": {
        "status": "complete",
        "batchOutcomes": [
          { "index": 0, "operationKeys": ["GET /pets"], "status": "succeeded" },
          { "index": 1, "operationKeys": ["POST /pets"], "status": "succeeded" },
          {
            "index": 2,
            "operationKeys": ["GET /pets/{id}"],
            "status": "succeeded"
          }
        ]
      }
    }
  }
}
```

`status` shown above is the stage's recomputed aggregate (FR-012): every batch now `"succeeded"`,
so the stage moved from `"partial"` to `"complete"`. A retry that fails again instead returns:

```json
{
  "workflow": {
    "stages": {
      "aiEnhancement": {
        "status": "partial",
        "batchOutcomes": [
          { "index": 0, "operationKeys": ["GET /pets"], "status": "succeeded" },
          { "index": 1, "operationKeys": ["POST /pets"], "status": "succeeded" },
          {
            "index": 2,
            "operationKeys": ["GET /pets/{id}"],
            "status": "failed",
            "errorCategory": "INVALID_RESPONSE",
            "failureExplanation": {
              "category": "unusable-output",
              "summary": "The AI model replied with output that couldn't be used.",
              "nextStep": "This can happen intermittently — running enhancement again will often succeed.",
              "retryable": true
            }
          }
        ]
      }
    }
  }
}
```

Batch 0 and 1's records are untouched by either outcome (FR-004, FR-005) — the response above
always reflects the *whole current set* of batch records, not only the retried one, the same way
every other endpoint on this resource returns the whole `workflow`.

#### `404 batch_not_found` — no such batch

```json
{
  "error": "batch_not_found",
  "message": "No batch with index 7 exists for this AI enhancement run."
}
```

Returned when `batchIndex` is outside the range of `stages.aiEnhancement.batchOutcomes`, or when
`batchOutcomes` is absent entirely (e.g. a run refused pre-flight before any batch was planned).

#### `409 batch_not_retryable` — batch is not eligible

```json
{
  "error": "batch_not_retryable",
  "message": "Batch 1 already succeeded and cannot be retried."
}
```

Returned when the targeted batch's `status` is `"succeeded"`, or its `failureExplanation.retryable`
is `false` (FR-003) — the identical retryable/non-retryable rule `failureExplanation.ts` already
applies to whole-run retry (research.md Decision 4), evaluated per batch instead of per run.

#### `409 stage_not_active` — wrong stage or review already finalized

Matches the existing refusal shared by every stage-transition route. Returned when AI Enhancement
has not yet produced any batch outcomes (e.g. it is still `"active"` on its first run, or has never
run), or when `scenarioReview` has already reached `"complete"` (FR-006 — identical guard to
whole-stage retry's existing finalization check in `aiEnhancementStage.ts:158-161`).

#### `409 ai_enhancement_already_running` — another operation is in progress

```json
{
  "error": "ai_enhancement_already_running",
  "message": "An AI enhancement operation is already in progress for this workflow."
}
```

Returned when `stages.aiEnhancement.progress` is already present — whether from a whole-stage run,
a cancellation still settling, or a different batch's retry (FR-007, research.md Decision 8). This
is the same signal and the same error `POST .../ai-enhancement` already uses; the two guards cannot
disagree because they check the same field.

### Idempotency

Not idempotent: each call is a genuine new attempt against the AI provider and may produce a
different outcome than the previous attempt (the provider's output is not guaranteed deterministic
— constitution XXIV, "AI outputs MUST be treated as potentially variable"). Calling it twice in
immediate succession is prevented by the `409 ai_enhancement_already_running` guard, not by
response caching.

---

## Behavioural guarantees

- **Scoped strictly to one batch's operations** (FR-008): the request never re-derives batch
  boundaries from live configuration; it looks up `operationKeys` from the pinned
  `BatchOutcomeRecord` and finds the matching `ApiOperation`s in `workflow.apiModel.operations`.
- **Additive only** (FR-004): on success, only scenarios newly produced for this batch's operations
  are added to `reviewWorkspace.scenarios`; every other scenario, and every review decision already
  recorded, is untouched.
- **No new state on failure** (FR-005): a repeat failure overwrites only this batch's own record.
- **Deterministic scenarios never touched** (FR-009), in either outcome — enforced structurally,
  since `retryOneBatch()` never reads or writes `workflow.deterministicTestModel`.
