# Contract: Enhancement Run Budget and Pre-Flight Refusal

**Feature**: `014-ai-batching-policy` | **Status**: Draft

Covers the wall-clock ceiling for a whole enhancement run and the pre-flight viability refusal.
Neither changes an HTTP request shape; both change what
`POST /api/test-generation-workflow/ai-enhancement` returns in its `workflow` body.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_ENHANCEMENT_RUN_BUDGET_MS` | `300000` | Wall-clock ceiling for one whole run |

Validated at startup with existing AI configuration (FR-011) and documented in `.env.example`.
Distinct from `AI_INFERENCE_TIMEOUT_MS`, which bounds a *single* request.

Default rationale: at ~21s per single-operation unit, 5 minutes covers roughly 14 operations
(research.md Decision 5).

## Run budget behaviour

- Elapsed time is measured from **`generatingSince`**, not from the HTTP request, so a one-time model
  load is not charged to the budget — the distinction `012-ai-enhancement-progress` established.
- Checked at unit boundaries only, alongside the existing cancellation check.
- On exhaustion: no further units are started; remaining units are recorded `not-attempted`; the run
  settles `partial`; everything already generated is retained (FR-010).
- A unit in flight when the ceiling elapses **runs to completion and its result is kept**. The ceiling
  governs what is started, never what is discarded.
- A run whose work fits inside the ceiling is unaffected in every observable way (FR-010, SC-006).

### Outcome mapping

| Situation | Stage status | `failureExplanation.category` |
| --- | --- | --- |
| All units succeeded | `complete` | — |
| Some succeeded, ceiling reached | `partial` | `too-slow` |
| Some succeeded, some failed | `partial` | per existing aggregation |
| No unit succeeded | `skipped` | per existing aggregation |
| Cancelled by user | `partial` or `skipped`, `cancelled: true` | `cancelled` |
| Refused pre-flight | `skipped` | `not-viable` |

No new `StageStatus` member is introduced, preserving `011`'s outcome semantics.

## Pre-flight refusal

Evaluated once per run, after the provider is ready and before the first unit is attempted, against
**one unit's** projected cost — uniform unit sizing is what makes a single estimate representative
(research.md Decision 8).

- Not viable → refuse without attempting generation; settle `skipped` with the existing `not-viable`
  explanation; report in seconds, not minutes (FR-013, SC-007).
- The explanation states projected versus allowed time in human-readable durations and that no time
  was spent (FR-014). `formatDuration` already provides this.
- Viable → proceed. The estimate never alters generated output (FR-013).

A refusal is `retryable: false` — under unchanged configuration the projection is unchanged.

## Progress reporting

`AiEnhancementProgress` gains the remaining run allowance so the UI can convey how much of the
planned work the ceiling permits (FR-012). All existing fields are unchanged.

`totalBatches` now reflects the planned unit count, fixed at run start and immutable thereafter — a
run's denominator must not move while the user watches it.

## Test expectations

- A run exceeding the ceiling settles `partial`, retains every scenario from completed units, and
  records the remainder `not-attempted`.
- A run inside the ceiling is byte-identical in outcome to one with the ceiling disabled.
- A unit in flight at the moment of exhaustion has its result retained.
- A not-viable configuration is refused with no call to `provider.infer`.
- A refusal message contains no internal category literal, constant name, or raw millisecond value
  (FR-021, SC-009).
- Deterministic scenarios survive every outcome above (FR-022, SC-005).
