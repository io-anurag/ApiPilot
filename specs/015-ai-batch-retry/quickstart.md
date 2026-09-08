# Quickstart: Validating AI Enhancement Batch Retry

**Feature**: `015-ai-batch-retry`

All steps below use `MockProvider` and run without a real model download (constitution XXI). A
real-model pass is optional for this feature — the behavior under test is orchestration logic
(which batch gets retried, what state survives), not inference quality, which `013` already covers.

## Prerequisites

- Repository dependencies installed (`npm install` at repo root).
- No model download required for any step here.

---

## 1. Establish the baseline before changing anything

```bash
npm test
```

Record the pass count. Every existing test from `011`, `012`, `013`, and `014` must still pass —
this feature adds a new retry surface without changing existing run/cancel behavior.

## 2. Batch outcomes survive settling (FR-001)

```bash
npm test -w backend -- tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts
```

Confirm:

- After a run settles `partial` (mix of succeeded/failed batches via `MockProvider`),
  `stages.aiEnhancement.batchOutcomes` is present and populated — one record per batch — while
  `stages.aiEnhancement.progress` is `undefined` (unchanged `012` behavior).
- Each failed batch's record carries a `failureExplanation` identical in shape to the run-level
  one, with the correct `retryable` value for its category.
- A run refused pre-flight (`not-viable`, `013`) produces no batch outcomes at all — nothing was
  ever planned.

## 3. Retry is offered only where eligible (FR-002, FR-003)

```bash
npm test -w backend -- tests/unit/testGenerationWorkflow/retryAiEnhancementBatch.test.ts
```

Confirm, against a settled `partial` run with a mix of batch outcomes:

- Retrying a `"succeeded"` batch's index returns `409 batch_not_retryable`.
- Retrying a `"failed"` batch whose category is `TIMEOUT` (or any category with
  `retryable: false`) returns `409 batch_not_retryable` — identical rule to whole-run retry
  (`failureExplanation.ts`), just evaluated per batch.
- Retrying a `"failed"` batch whose category is `PROVIDER_UNAVAILABLE` (or any `retryable: true`
  category) is accepted and re-invokes the provider for that batch's operations only.
- Retrying a `"not-attempted"` batch (ceiling reached) is accepted.
- An out-of-range `batchIndex` returns `404 batch_not_found`.

## 4. A successful retry is additive, not replacing (FR-004, FR-008)

Using a run with 3+ batches where batch 1 failed and batches 0 and 2 succeeded:

- Record `reviewWorkspace.scenarios` and every batch-0/batch-2 scenario's review `state`/`revision`
  before retrying batch 1.
- Retry batch 1 (mock a success response for it).
- Confirm: batch 0 and batch 2's scenarios and review decisions are byte-for-byte unchanged; only
  new scenarios (tagged `provenance.aiBatchIndex === 1`) are appended.
- Confirm the resent request covers exactly batch 1's original operations — assert on the mock
  provider's captured request, not on a freshly recomputed batch split.

## 5. Aggregate stage status recomputes (FR-012, `/speckit-clarify` 2026-09-08)

Using a run where every batch but one succeeded:

- Confirm the stage starts `"partial"`.
- Retry the one remaining failed/not-attempted batch to success.
- Confirm the stage transitions to `"complete"` — through `"active"` in between, matching the
  existing `partial->active->complete` path already used by whole-stage retry (no new
  `StageStatus` value, research.md Decision 3).
- Confirm `AiEnhancementOutcomeSummary`'s displayed added-scenario count reflects **all**
  batches' contributions, not only the retried one (research.md Decision 7).

## 6. Guardrails (FR-006, FR-007)

- Finalize `scenarioReview` (mark it `"complete"`), then attempt a batch retry on the still-visible
  prior AI Enhancement run. Confirm `409 stage_not_active` and that nothing in `reviewWorkspace`
  changes.
- Start a batch retry, then — before it resolves — attempt a second batch retry (any index) or a
  whole-stage `POST .../ai-enhancement`. Confirm the second call returns
  `409 ai_enhancement_already_running`, using the same guard the existing whole-stage/cancel
  endpoints already share (research.md Decision 8).

## 7. Frontend surfaces one retry action per eligible batch (FR-011)

```bash
npm test -w frontend
```

Confirm `AiEnhancementStage` (or its settled-run view) renders a distinguishable retry control per
batch whose `failureExplanation.retryable` is `true`, and none for a succeeded or non-retryable
batch — mirroring the existing whole-run retry button's accessible-name pattern.

---

## 8. Full validation

```bash
npm test
npm run lint
npm run build
```

All three must be clean, with no test disabled or weakened to accommodate the change
(constitution XXXI).

## Regression checklist

Behaviours from earlier features that this work must not break:

- [ ] `011`/`013` whole-run outcome semantics (`success`/`partial`/`skipped`) and whole-stage retry
      are unchanged and still pass their existing tests.
- [ ] `012` incremental `reviewWorkspace` population during a normal run is unaffected.
- [ ] `013`'s `409 no_run_in_progress`/`409 ai_enhancement_already_running` guards still behave
      identically for the existing run/cancel endpoints.
- [ ] Deterministic scenarios never removed, altered, or reordered — including across every batch
      retry outcome (success, repeat failure, rejection).
- [ ] No specification content, prompt, or model response is written to logs for a batch retry,
      matching the existing per-unit logging discipline in `enhanceTestModel.ts`.
- [ ] Ordinary `npm test` still downloads no model and runs no real inference.
