# Data Model: AI Failure Analysis (AP-031)

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

New shared contracts live in `packages/shared-domain/src/failureAnalysis.ts` and are exported from
`packages/shared-domain/src/index.ts`. They are framework-agnostic (constitution VIII, X). Two
existing contracts gain one optional field each.

## Changes to existing contracts (additive)

| Contract | Field | Rule |
|---|---|---|
| `UploadedRequestResult` (`externalCollections.ts`) | `itemId?: string` | The executed Postman item's `id`. Set on every result recorded after this feature ships, including `not-attempted` results. Absent on older stored results, which remain valid (FR-017, research D2). |
| `InferenceRequest` (`aiProvider.ts`) | `systemPrompt?: string` | When present, `LocalProvider` uses it as the chat system message. When absent, the behavior is unchanged. `MockProvider` ignores it. `contractVersion` stays `1` (research D6). |
| `AIProvider.infer` (`aiProvider.ts`) | optional 2nd parameter `hooks?: { onStarted?: () => void }` | `LocalProvider` calls `onStarted` once, after dequeuing and loading the engine and right before its timeout starts. `MockProvider` calls it immediately. It is never called for a request rejected before that point (research D10). |

## FailureCause

`"specification-mismatch" | "environment-issue" | "downstream-service-issue"`

These are shown in the UI as "Potential specification mismatch", "Potential environment issue" and
"Potential downstream-service issue". The "Potential" prefix is part of FR-007's inference labelling.

## FailureAnalysisConclusion (discriminated on `kind`)

| kind | Fields | When |
|---|---|---|
| `likely-cause` | `cause: FailureCause`, `confidence: number` (0–1) | The model named a cause, the confidence is at least `FAILURE_ANALYSIS_MIN_CONFIDENCE` (0.5), and at least one valid evidence id was cited. |
| `insufficient-evidence` | `reason: "model-reported" \| "below-confidence-threshold" \| "no-valid-evidence-cited"`, `confidence?: number` | Every other valid answer (research D7). A cause rejected by the threshold is not stored. |

## FailureEvidence

One deterministic, redacted fact. The AI cites evidence but never writes it (research D4).

| Field | Type | Rule |
|---|---|---|
| `id` | string | `E1`, `E2`, … assigned in the fixed kind order below. The same input always gives the same ids. |
| `kind` | `FailureEvidenceKind` | One of: `failure-category`, `response-status`, `response-time`, `test-outcome`, `request-line`, `request-headers`, `request-body-excerpt`, `response-headers`, `response-body-excerpt`, `request-edited`, `documented-responses`, `scenario-expectation`, `upstream-step-outcome`, `omitted-for-capacity`. |
| `source` | `"run-result" \| "specification-context"` | Keeps runtime observations separate from specification-derived facts (constitution preamble items 1 and 5). |
| `text` | string | A human-readable statement that has already been redacted (research D5), for example `Test "Status code is 201" failed: expected 201 but got 500`. Excerpts note when they are truncated. |

Kinds `request-line` through `response-body-excerpt` exist only when the result has a `rawCapture`
(`"local"` tier). Kinds `documented-responses`, `scenario-expectation` and `upstream-step-outcome`
exist only when `SpecificationContext.status === "matched"`.

## SpecificationContext (discriminated on `status`)

| status | Fields |
|---|---|
| `matched` | `workflowId`, `scenarioId`, `scenarioName`, `scenarioCategory`, `operationPath`, `operationMethod`, `documentedStatusCodes: string[]`, `requestEditedAfterGeneration: boolean`, `upstream: UpstreamContext[]` (empty when there is none) |
| `unavailable` | `reason: "no-request-identity" \| "no-generated-collection" \| "not-generated-by-current-workflow" \| "no-originating-scenario"` |

It is captured once, at analysis time, from `getCurrentWorkflow()`, and stored inside the analysis.
It is never re-read from the workflow when the analysis is displayed (FR-018, research D3).

### UpstreamContext

| Field | Type | Rule |
|---|---|---|
| `via` | `"integration-workflow" \| "dependency-relationship"` | `integration-workflow` comes from `provenance.workflowId` and `stepPosition` in an approved `IntegrationWorkflow`. `dependency-relationship` comes from `provenance.relationshipIds` in the `ApiDependencyGraph`. |
| `stepPosition?` | number | Present for `integration-workflow` only. |
| `operationPath`, `operationMethod` | string | The upstream (producer) operation. |
| `suppliedFields` | string[] | Variable names (for a workflow) or producer fields (for a relationship) that this request consumes. These are names only, never values. |
| `outcomeInRun` | `"passed" \| "failed" \| "not-attempted" \| "not-in-run"` | Found by matching the other results' `itemId`s in the same run (research D3). |

## FailureAnalysisProvenance

| Field | Type | Rule |
|---|---|---|
| `source` | `"AI"` | Constitution XIII. |
| `aiModel` | string | From `InferenceResponse.modelId`. |
| `aiProvider` | `AIProviderMode` | From `InferenceResponse.provider`. |
| `responseVersion` | number | `FAILURE_ANALYSIS_RESPONSE_VERSION` (currently 1). |
| `confidenceThreshold` | number | The threshold applied (0.5), so an old analysis stays interpretable if the constant changes. |
| `generatedAt` | ISO string | From an injected clock. |

## FailureAnalysis

| Field | Type | Rule |
|---|---|---|
| `runId` | string | The `UploadedCollectionExecutionRun.id`. |
| `resultIndex` | number | The position in `run.results`. Together with `runId` it forms the identity, and at most one analysis exists per `(session, runId, resultIndex)`. |
| `requestName`, `requestMethod` | string | Copied from the result at analysis time. |
| `conclusion` | `FailureAnalysisConclusion` | |
| `summary` | string | Model text, at most 400 characters, scanned for sensitive values after inference. Always shown as an inference. |
| `investigationSteps` | string[] | Model text, 0 to 3 entries of at most 200 characters each, scanned the same way. |
| `citedEvidenceIds` | string[] | Only ids present in `evidence`. It may be empty only when `conclusion.kind === "insufficient-evidence"`. |
| `evidence` | `FailureEvidence[]` | Every evidence item offered to the model, whether cited or not. |
| `specificationContext` | `SpecificationContext` | |
| `provenance` | `FailureAnalysisProvenance` | |

**Validation invariants**:
- `likely-cause` implies `citedEvidenceIds.length ≥ 1` and `confidence ≥ provenance.confidenceThreshold`.
- Every `citedEvidenceIds` entry is an `evidence[].id`.
- No field contains a value that redaction replaced (SC-003).

### Confidence presentation (UI only, not stored)

`confidence` is stored as a number. The UI shows it with a label (clarification 2026-09-23):

| Label | Range |
|---|---|
| Moderate | 0.5 to below 0.75 |
| High | 0.75 and above |

The exact value appears next to the label, for example "Moderate (0.62)". An
`insufficient-evidence` conclusion never shows a cause confidence label.

## FailureAnalysisInProgress (in memory only, one per session at most)

| Field | Type | Rule |
|---|---|---|
| `runId`, `resultIndex` | string, number | The result being analyzed. |
| `requestName` | string | Lets the UI say which request is being analyzed (FR-016). |
| `phase` | `"waiting-for-ai" \| "generating"` | `waiting-for-ai` lasts until the provider's `onStarted` fires, and `generating` follows (research D10). |
| `phaseStartedAt` | ISO string | For the elapsed timer. From the injected clock. |

This record is returned by `GET /api/failure-analysis/in-progress`. It is never persisted and is lost
on restart.

## FailureAnalysisAttempt (the POST response body, discriminated on `status`)

| status | Fields |
|---|---|
| `analyzed` | `analysis: FailureAnalysis` (the stored result, which replaced any earlier one) |
| `ai-failed` | `aiErrorCategory: AIErrorCategory`, `message: string` (plain language, with no internal identifiers), `previousAnalysis?: FailureAnalysis` (unchanged, FR-015) |
| `not-viable` | `notViable: { projectedMs: number; budgetMs: number }`, `message: string`, `previousAnalysis?: FailureAnalysis` |

## Lifecycle and state

```text
(no analysis) ── POST ──► waiting-for-ai ── onStarted ──► generating ──► analyzed ──► stored row written
                               │                              │
                               └──────────────┬───────────────┘
                                              └── ai-failed / not-viable ──► nothing written; any stored row kept

any POST in the session while one is waiting-for-ai/generating ──► 409 failure_analysis_in_progress
stored row ── POST again ──► … ──► analyzed ──► row replaced atomically (upsert)
stored row ── session idle-evicted ──► row deleted (onExpire listener)
waiting-for-ai/generating ── backend restart ──► in-progress entry lost; nothing stored; user may request again
```

## Persistence (AP-025 extension)

A new table, `failure_analyses`, is described in research D9. The primary key is
`(session_id, run_id, result_index)`. The `FailureAnalysis` JSON is encrypted in
`analysis_encrypted`/`analysis_iv` with the existing cipher, and `generated_at` is stored in
plaintext for ordering. Rows are deleted by session eviction together with the run they belong to.
There is no other deletion path, because runs themselves are only removed by eviction.
