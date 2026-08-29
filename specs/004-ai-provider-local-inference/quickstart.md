# Quickstart: AI Provider & Local Inference Foundation

This guide validates that AP-004 works end-to-end on top of the AP-001–AP-003 foundation.

## Prerequisites

- AP-001–AP-003 are set up and running (`npm install`).
- Internet access for the *first* run only, to download and cache the selected local model
  (subsequent runs can be fully offline once cached — spec.md Assumptions).

## Steps

1. **Install and build**:
   ```
   npm install
   npm run build
   ```
2. **Run the benchmarking harness** (one-time / infrequent — FR-014):
   ```
   npm run ai:benchmark -w backend
   ```
   - Expected: a `BenchmarkReport` (data-model.md) is produced comparing the candidate
     models from [research.md](./research.md) #2, recording `selectedModelId` and
     `selectionRationale` (FR-015, SC-006).
3. **Start the app**:
   ```
   npm run dev
   ```
4. **Check AI readiness before the model is cached**: call
   `GET /api/ai/status` (see [contracts/ai-status-api.md](./contracts/ai-status-api.md)).
   - Expected: `state` is `"not-loaded"` or `"loading"`, never a silent generic failure.
5. **Wait for the model to load, then re-check status**.
   - Expected: `state` becomes `"ready"` with the selected `modelId` populated (User Story
     2, SC-007).
6. **Disconnect from the network** and issue an inference request through the local
   provider (e.g., via a small script or the `ai:benchmark` harness re-run).
   - Expected: the request completes successfully with zero outbound network calls
     (User Story 1, SC-001, SC-002).
7. **Force a model-load failure** (e.g., point `AI_MODEL_CACHE_DIR` at a corrupted/empty
   directory) and re-check `/api/ai/status`.
   - Expected: `state` is `"unavailable"` with a specific, non-empty `reason`; a second
     check immediately after confirms no automatic retry occurred (FR-019, spec.md Edge
     Cases).
8. **Run automated tests**:
   ```
   npm test
   ```
   - Expected: all `backend/tests/unit/ai/` tests (queue, readiness, mock provider, config,
     errors) and `backend/tests/integration/aiStatus.test.ts` pass using the deterministic
     mock provider — no real model is downloaded or loaded during the default test run
     (FR-011, SC-004, constitution XXI).
9. **Confirm no cloud fallback**: with the mock/local provider forced into an
   `unavailable`/failed state, confirm no code path substitutes a cloud provider (FR-007,
   SC-005) — there should be no cloud-provider implementation to substitute at all in this
   feature's codebase.

## Validation Checklist

- [X] `GET /api/ai/status` reports `not-loaded`/`loading`/`ready`/`unavailable` with a
      reason whenever unavailable (FR-004, SC-007)
- [X] Once cached, inference completes fully offline in local-only mode (FR-002, FR-006,
      SC-001, SC-002)
- [X] A concurrent request while busy is queued and processed serially, not rejected or
      run in parallel (FR-018)
- [X] A request exceeding the configured timeout resolves as a timeout error, not an
      indefinite hang (FR-017)
- [X] A model-load failure is never automatically retried (FR-019)
- [X] An enabled-but-unavailable accelerator falls back to CPU with a visible notice
      (FR-008)
- [X] The mock provider produces identical output for identical input across repeated
      calls, with no real model loaded (FR-011, SC-004)
- [X] No code outside `backend/src/ai/localProvider.ts` imports Transformers.js (FR-013,
      SC-003)
- [X] The benchmarking harness produces a `BenchmarkReport` comparing at least two
      candidates with a recorded selection rationale (FR-014, FR-015, SC-006)
- [X] `npm test` passes with zero failures and no network access
