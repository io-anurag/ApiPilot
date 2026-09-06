# Quickstart: Validating AI Enhancement Progress Visibility

## Prerequisites

- Repository dependencies installed (`npm install` at repo root).
- No real local model download is required — validation below uses the deterministic
  `MockProvider`/test doubles (constitution XXI); a real-model manual check is optional and
  separate (see "Optional: real-model validation").

## 1. Run the automated test suite for this feature

```bash
npm test -w backend
npm test -w frontend
```

Expect the existing suite to keep passing, plus new/extended coverage for:

- `backend/tests/unit/ai/requestBatching.test.ts` — `onBatchStart`/`onBatchSettled` fire in
  order, once per batch, with the correct index/total/outcome; omitting them is still valid
  (backward compatible with `analyzeDependencies.ts`'s existing call site).
- `backend/tests/unit/testDesign/enhanceTestModel.test.ts` — `onBatchComplete` reports exactly
  the newly-retained scenarios per batch (not the whole accumulated set); a scenario revealed
  from an earlier batch is never re-reported or removed by a later batch's dedup pass.
- `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` — a second
  `runAiEnhancement()` call while `stages.aiEnhancement.progress` is present is rejected
  (`ai_enhancement_already_running`); `progress` is populated during a multi-batch run and
  cleared once the stage reaches a terminal status; `reviewWorkspace` grows incrementally as
  batches succeed, and decisions already recorded on early-revealed scenarios survive later
  batches settling (FR-012).
- `backend/tests/integration/testGenerationWorkflow.test.ts` (or equivalent) — `GET
  /api/test-generation-workflow` returns the new `progress` field with the shape in
  `contracts/ai-enhancement-progress.md`.
- `frontend/tests/unit/AiEnhancementStage.test.tsx` — polls workflow status while a run is
  active, renders per-batch progress, stops polling once a terminal status is observed; single
  batch runs render exactly as before (no spurious "batch 1 of 1" step, FR-005).

## 2. Confirm single-batch specifications are unaffected (User Story 3, FR-005)

Using a fixture already known to complete in one batch today, run AI enhancement with the
`MockProvider` and confirm:

- Total time to the final result and the information shown are unchanged from a pre-feature
  run of the same fixture.
- `stages.aiEnhancement.progress` either never appears in a poll, or appears only fleetingly
  with `totalBatches: 1` — the UI does not show a misleading multi-step progress indicator for
  a run that was always one step.

## 3. Confirm live progress during a multi-batch run (User Story 1)

Using a fixture large enough to require multiple batches (e.g. `buildLargeAiScenarioApiModel`
from `backend/tests/fixtures/testDesign/aiScenarioDesignerFixtures.ts`, paired with a scripted
provider that resolves each batch after a short controlled delay so intermediate state is
observable), start AI enhancement and, while it is still running, poll `GET
/api/test-generation-workflow`:

- `stages.aiEnhancement.progress.totalBatches` matches the expected batch count.
- The `batches[]` array shows `"in-progress"` advancing one index at a time, with earlier
  indices already `"succeeded"`/`"failed"`.
- `reviewWorkspace.scenarios` already contains scenarios from earlier-succeeded batches before
  the run as a whole finishes.

## 4. Confirm an unambiguous final outcome (User Story 2, FR-006)

Once the run above finishes, confirm in a single poll:

- `stages.aiEnhancement.progress` is absent.
- `stages.aiEnhancement.status` is exactly one of `complete`/`partial`/`skipped`, matching the
  scripted batch outcomes, with `aiErrorCategory`/`aiErrorMessage` populated for
  `partial`/`skipped` exactly as specs/011 already documents.

## 5. Confirm the concurrency guard (FR-008)

While a multi-batch run is still in progress (per step 3), call `POST
/api/test-generation-workflow/ai-enhancement` again and confirm a `409
ai_enhancement_already_running` response, and that the original run's progress is unaffected
by the rejected second call.

## Optional: real-model validation

Run the actual UI flow (`npm run dev`) against a real specification large enough to need
multiple batches, with `AI_PROVIDER_MODE=local`. Confirm the "Enhance with AI" button's
in-progress state now shows batch-level status rather than a single unchanging "Enhancing…"
label, and that scenarios appear in the review list progressively rather than all at once at
the end.
