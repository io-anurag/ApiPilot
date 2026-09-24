# API Contract: AI Failure Analysis (AP-031)

These routes are served by a new router, `createFailureAnalysisRouter(provider)`, mounted under
`/api`. They sit beside the AP-026 run routes (`specs/026-external-collection-execution/contracts/external-collections-api.md`)
and are session-scoped in the same way (specs/017). No active `TestGenerationWorkflow` is required.
When one exists, it is only read, to attach specification context (research D3). Neither route
requires the uploaded collection `:id` to still exist, matching `GET …/execution/runs/:runId`.
Types are defined in [data-model.md](../data-model.md).

Neither route executes any request against the target API (FR-009).

## `POST /api/external-collections/:id/execution/runs/:runId/results/:resultIndex/failure-analysis`

Generates an analysis for one failed result, on user request (FR-001, FR-012). It awaits one
inference. Once the model starts on this request, the inference is bounded by the configured AI
timeout (120 s by default). Any earlier wait for the local AI is reported through
`GET /api/failure-analysis/in-progress`. There is no automatic retry.

**Request body**: none. An empty JSON object is accepted.

Checks run in this order. The first failing check determines the response:

| # | Condition | Response |
|---|---|---|
| 1 | `resultIndex` is not a non-negative integer | **400** `{ "error": "invalid_result_index", "message": "…" }` |
| 2 | No run `runId` in this session | **404** `{ "error": "run_not_found", "message": "…" }` |
| 3 | `resultIndex ≥ run.results.length` | **404** `{ "error": "result_not_found", "message": "…" }` |
| 4 | `run.results[resultIndex].outcome !== "failed"` | **409** `{ "error": "result_not_failed", "message": "…", "outcome": "passed" \| "not-attempted" }` (FR-002) |
| 5 | Any analysis is already in progress in this session, for this or another result | **409** `{ "error": "failure_analysis_in_progress", "message": "…", "runId": "…", "resultIndex": 2 }` (FR-016) |

The run's own status is not checked, so a failed result can be analyzed while its run is still in
progress (FR-001, clarification 2026-09-23).

When every check passes, the response is **200 OK** with a `FailureAnalysisAttempt` body.

*Amended 2026-09-24* (spec Clarifications 2026-09-24; research D15 to D18): the cause is decided by
rules before any inference, so an eligible request always produces an analysis. The `ai-failed`
and `not-viable` statuses are replaced by `explanation.status: "unavailable"` and a
`kept-previous` status.

```json
{ "status": "analyzed", "analysis": { "analysisVersion": 2, "runId": "…", "resultIndex": 3, "requestName": "…", "requestMethod": "GET",
  "conclusion": { "kind": "likely-cause", "cause": "environment-issue", "strength": "high", "ruleId": "no-response", "decidingEvidenceIds": ["E1"] },
  "classificationProvenance": { "source": "RULE", "ruleSetVersion": 1 },
  "explanation": { "status": "available", "summary": "…", "investigationSteps": ["…"], "citedEvidenceIds": ["E1"],
    "provenance": { "source": "AI", "aiModel": "onnx-community/Qwen2.5-0.5B-Instruct", "aiProvider": "local", "responseVersion": 4 } },
  "evidence": [ { "id": "E1", "kind": "failure-category", "source": "run-result", "text": "Request failed: connectivity failure, no response was received" } ],
  "specificationContext": { "status": "unavailable", "reason": "not-generated-by-current-workflow" },
  "analyzedAt": "2026-09-24T10:00:00.000Z" } }
```

On `analyzed`, the analysis has been stored. It replaced any earlier analysis for this result
atomically (FR-013, FR-015). Its `explanation` may be unavailable:

```json
"explanation": { "status": "unavailable", "reason": { "kind": "ai-error", "aiErrorCategory": "TIMEOUT" }, "message": "The local AI model did not finish within 2 minutes." }
```

`reason` is one of:
- `{ "kind": "ai-error", "aiErrorCategory": … }`, where the category is one of:
  - `NOT_READY`, `LOAD_FAILED` or `PROVIDER_UNAVAILABLE` for provider problems (FR-006);
  - `TIMEOUT`;
  - `INVALID_REQUEST` for input over the model's capacity after trimming;
  - `INVALID_RESPONSE` for an unparseable answer, an answer citing no valid evidence, or an answer
    that names a cause other than the rule-decided one (FR-008).
- `{ "kind": "not-viable", "projectedMs": 142000, "budgetMs": 120000 }` when the request was
  refused before inference (research D8).

```json
{ "status": "kept-previous", "analysis": { "…": "the new analysis, not stored, explanation unavailable" }, "previousAnalysis": { "…": "the stored analysis, unchanged, explanation available" }, "message": "The local AI model did not finish within 2 minutes, so the earlier explanation was kept." }
```

On `kept-previous`:
- the new explanation is unavailable;
- the stored analysis has an available one, so nothing is written (FR-015).

Rule and AI outcomes are reported inside a 200 response, matching the existing AI endpoints
(`aiProviderOutcome` in `enhancedTestModels`). A 5xx status means an unexpected server error only,
with the standard safe body `{ "error": "internal_server_error" }`.

## `GET /api/external-collections/:id/execution/runs/:runId/failure-analyses`

Lists the stored analyses for one run, so the UI can show them after a reload or backend restart
(FR-013, FR-014).

**200 OK**: `{ "analyses": FailureAnalysis[] }`, ordered by `resultIndex` ascending. The array is
empty when there are none.

**404** `run_not_found`: no run `runId` in this session.

## `GET /api/failure-analysis/in-progress`

This is session-level. It reports the session's analysis in progress, if any, so the UI can disable
every "Analyze failure" action and show the phase and elapsed time, including after a page reload
(FR-016, SC-005, research D10).

- **200 OK**: `{ "inProgress": { "runId": "…", "resultIndex": 2, "requestName": "…", "phase": "waiting-for-ai" | "generating", "phaseStartedAt": "…" } }`
- **204 No Content**: nothing is in progress.

## Additive change to the AP-026 contract

`GET /api/external-collections/:id/execution/runs/:runId` and the run returned by
`…/execution/start` now carry `itemId` on each result recorded after this feature ships
(data-model.md). Existing fields and behavior are unchanged. `specs/026-external-collection-execution/contracts/external-collections-api.md`
and its `data-model.md` carry a dated amendment note (2026-09-23).

## Additive change to the AP-004 provider contract

The provider contract gains two optional, backward-compatible additions:
- `InferenceRequest.systemPrompt?: string` (research D6).
- An optional second parameter `hooks?: { onStarted?: () => void }` on `AIProvider.infer` (research D10).

Both are described in data-model.md. Existing callers pass neither, and their behavior is
byte-identical. `specs/004-ai-provider-local-inference/data-model.md` carries a dated amendment note
(2026-09-23).

## Logging

Each request logs `runId`, `resultIndex`, outcome `status`, `ruleId` (or `no-rule-matched`), the
explanation status, `aiErrorCategory` when present, evidence count and duration. It never logs the prompt, the model response, evidence text, the
summary, or raw capture content (constitution XX).
