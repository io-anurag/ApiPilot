# Quickstart: Validating Bounded AI Prompt Batching

## Prerequisites

- Repository dependencies installed (`npm install` at repo root).
- No real local model download is required — validation below uses the deterministic
  `MockProvider` (constitution XXI); a real-model run is optional and separate (see
  "Optional: real-model validation").

## 1. Run the automated test suite for this feature

```bash
npm test -w backend
```

Expect the existing suite to keep passing, plus new/extended coverage for:

- `backend/tests/unit/ai/requestBatching.test.ts` — deterministic splitting behavior
  (single batch when input fits or budget is `undefined`; recursive halving down to
  one-operation batches when it doesn't; identical grouping across repeated calls with the
  same input).
- `backend/tests/unit/dependencies/analyzeDependencies.test.ts` — multi-batch merge,
  `"partial"` outcome when one of several batches fails, `ANALYSIS_TIMEOUT_MS` budget
  exhaustion mid-run.
- `backend/tests/unit/testDesign/enhanceTestModel.test.ts` — multi-batch merge, `"partial"`
  outcome, small-specification single-batch behavior unchanged (FR-006).
- `backend/tests/unit/testGenerationWorkflow/aiEnhancementStage.test.ts` — `"partial"`
  surfaces as a distinct `aiEnhancement` stage status (`"partial"`), never collapsed into
  `"skipped"`.
- `frontend/tests/unit/AiEnhancementStage.test.tsx`,
  `frontend/tests/unit/WorkflowStageTracker.test.tsx`,
  `frontend/tests/unit/TestGenerationWorkflowPage.test.tsx` — partial status renders with its
  own label/tone, distinct from both "complete" and "skipped".

## 2. Confirm small specifications are unaffected (FR-006)

Using a fixture already known to complete in one batch today (e.g. an existing small
`ApiModel` fixture under `backend/tests/fixtures/`), run dependency analysis and scenario
enhancement with the `MockProvider` and confirm:

- Exactly one `provider.infer()` call is made for each pass.
- `aiOutcome` / `aiProviderOutcome` is `"success"`, never `"partial"`.
- Output (relationships / scenarios) is byte-for-byte identical to a pre-feature run of the
  same fixture.

## 3. Confirm large specifications now complete instead of being skipped (User Story 1)

Construct (or reuse, if one exists) an `ApiModel` fixture large enough that its serialized
JSON prompt exceeds a configured `MockProvider` test budget (via the new test-only budget
override — see data-model.md). Run both passes and confirm:

- More than one `provider.infer()` call is made.
- Every operation from the fixture appears in exactly one batch (no operation is missing
  from the merged result, none is duplicated).
- `aiOutcome` / `aiProviderOutcome` is `"success"` when every batch's mock call succeeds.

## 4. Confirm partial-failure reporting (User Story 3)

Using a provider test double that fails on a specific batch (e.g. a wrapped `MockProvider`
or a purpose-built test double implementing `AIProvider`) while succeeding on the others,
confirm:

- Results from the successful batch(es) are present in the merged output.
- `aiOutcome` / `aiProviderOutcome` is `"partial"`, not `"success"` or a full-failure value.
- `aiErrorMessage` is a clear, human-readable explanation referencing partial completion.
- For scenario enhancement specifically, the workflow's `aiEnhancement` stage status is
  `"partial"` (not `"skipped"`), and `WorkflowStageTracker`/`AiEnhancementStage` render a
  status distinct from a full skip (research.md Decision 7).

## 5. Confirm total failure still behaves like today (edge case)

Force every batch to fail. Confirm the resulting outcome/message is equivalent in meaning to
today's single-batch failure case (deterministic-only results, explicit reason) — never
`"partial"`.

## 6. Confirm bulk review remains practical for a newly-unblocked large specification

Using the large fixture from step 3 (which previously produced zero AI-derived candidates
and now produces a full batch's worth), confirm the existing review UI's grouped/bulk
decision actions (constitution XXXII, spec 010) remain practical for the increased AI
candidate volume — this feature should not be the first time a large specification's AI
candidates reach the review screen at full scale.

## Optional: real-model validation

Not required for this feature's automated tests, but useful for a final manual sanity check
before merging:

```bash
$env:AI_TEST_REAL_MODEL = "1"
npm run test:ai-real -w backend
```

Then, with `AI_PROVIDER_MODE=local` configured against a real large OpenAPI specification
(e.g. the ~51-operation production specification referenced in the constitution's v2.1.0
Sync Impact Report), confirm the workflow's AI-assisted dependency detection and scenario
enhancement stages complete (fully or partially) instead of being skipped with
`PROVIDER_UNAVAILABLE`/`INVALID_REQUEST`.
