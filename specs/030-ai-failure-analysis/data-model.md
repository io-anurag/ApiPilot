# Data Model: AI Failure Analysis (AP-031)

**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

New shared contracts live in `packages/shared-domain/src/failureAnalysis.ts` and are exported from
`packages/shared-domain/src/index.ts`. They are framework-agnostic (constitution VIII, X). Two
existing contracts gain one optional field each.

**Amended 2026-09-24** (spec Clarifications 2026-09-24; research D15 to D19): rules now decide the
cause, and the AI writes only the explanation. The changed sections are FailureAnalysisConclusion,
FailureAnalysis, FailureAnalysisProvenance, which is split, the strength presentation,
FailureAnalysisAttempt, the lifecycle and persistence.

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

## FailureAnalysisConclusion (discriminated on `kind`, decided by rules)

| kind | Fields | When |
|---|---|---|
| `likely-cause` | `cause: FailureCause`, `strength: "high" \| "moderate"`, `ruleId: FailureRuleId`, `decidingEvidenceIds: string[]` (at least 1) | The first classification rule that matches (research D15). `strength` is the rule's fixed, documented strength. |
| `insufficient-evidence` | `reason: "no-rule-matched"` | No rule matches. |

`FailureRuleId` is `"no-response" | "gateway-error" | "environment-rejected-request" |
"dependency-named-in-server-error" | "undocumented-status" | "status-assertion-mismatch" |
"response-content-assertion"`. Each rule's condition, cause and strength are in research D15. The
conclusion is computed by `classifyFailure` from the result, the specification context and the full
evidence list only. The AI never sets or changes it.

`FAILURE_RULE_DESCRIPTIONS: Record<FailureRuleId, string>` is exported from shared-domain. It holds
one plain sentence per rule, for example `"no-response"` → "No response was received: the
connection failed or timed out." The prompt (`classification`) and the UI (next to the strength
label) use the same text.

## FailureEvidence

One deterministic, redacted fact. The AI cites evidence but never writes it (research D4).

| Field | Type | Rule |
|---|---|---|
| `id` | string | `E1`, `E2`, … assigned in the fixed kind order below. The same input always gives the same ids. |
| `kind` | `FailureEvidenceKind` | One of: `failure-category`, `response-status`, `response-time`, `test-outcome`, `request-line`, `request-headers`, `request-body-excerpt`, `response-headers`, `response-body-excerpt`, `request-edited`, `documented-responses`, `scenario-expectation`, `upstream-step-outcome`. *(Amended 2026-09-24: `omitted-for-capacity` is removed; the capacity notice is a prompt-only `note`, research D8.)* |
| `source` | `"run-result" \| "specification-context"` | Keeps runtime observations separate from specification-derived facts (constitution preamble items 1 and 5). |
| `text` | string | A human-readable statement that has already been redacted (research D5), for example `Test "Status code is 201" failed: expected 201 but got 500`. Excerpts note when they are truncated. |

*Amended 2026-09-24 (research D15, D8):* the stored `evidence` list is always the full, untrimmed
list, and the classification rules read it. Trimming for the model's input budget affects only the
prompt copy, which keeps each item's original `id`.

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

## Provenance (split: rule for the cause, AI for the explanation)

`ClassificationProvenance`: `source: "RULE"`, `ruleSetVersion: number`
(`FAILURE_CLASSIFICATION_RULESET_VERSION`, currently 1). The rule itself is `conclusion.ruleId`.

`ExplanationProvenance`, present only on an available explanation:

| Field | Type | Rule |
|---|---|---|
| `source` | `"AI"` | Constitution XIII. |
| `aiModel` | string | From `InferenceResponse.modelId`. |
| `aiProvider` | `AIProviderMode` | From `InferenceResponse.provider`. |
| `responseVersion` | number | `FAILURE_ANALYSIS_RESPONSE_VERSION`, currently 4 (research D16; 3 was evaluated but never shipped). |

`FailureAnalysisProvenance` and its `confidenceThreshold` are removed.

## FailureExplanation (discriminated on `status`)

| status | Fields | When |
|---|---|---|
| `available` | `summary: string`, `investigationSteps: string[]`, `citedEvidenceIds: string[]`, `provenance: ExplanationProvenance` | The AI answer passed D16's validation. |
| `unavailable` | `reason: {kind: "ai-error", aiErrorCategory: AIErrorCategory} \| {kind: "not-viable", projectedMs: number, budgetMs: number}`, `message: string` (plain language) | The provider was not ready or failed, the request was not viable, or the answer was rejected (`INVALID_RESPONSE`: shape, no valid citation, or a contradiction of the rule-decided cause). |

Validation for `available`:
- `summary` is 1 to 400 characters.
- `investigationSteps` has 1 to 3 entries of up to 200 characters each.
- `citedEvidenceIds` has at least 1 entry, and every entry is an `evidence[].id`.
- No text names a cause other than `conclusion.cause`, or any cause when the conclusion is insufficient evidence (D16).
- Every text field is scanned for sensitive values (D5).

## FailureAnalysis

| Field | Type | Rule |
|---|---|---|
| `analysisVersion` | `2` | The marker for the rule-decided design. Rows without it are legacy and removed on startup (research D19). |
| `runId` | string | The `UploadedCollectionExecutionRun.id`. |
| `resultIndex` | number | The position in `run.results`. Together with `runId` it forms the identity, and at most one analysis exists per `(session, runId, resultIndex)`. |
| `requestName`, `requestMethod` | string | Copied from the result at analysis time. |
| `conclusion` | `FailureAnalysisConclusion` | Decided by rules. |
| `classificationProvenance` | `ClassificationProvenance` | |
| `explanation` | `FailureExplanation` | AI text, or the reason it is unavailable. |
| `evidence` | `FailureEvidence[]` | The full, untrimmed list: every evidence item, whether it decided the cause, was cited, or neither. |
| `specificationContext` | `SpecificationContext` | |
| `analyzedAt` | ISO string | From the injected clock. |

**Validation invariants**:
- `likely-cause` implies `decidingEvidenceIds.length ≥ 1`, every entry an `evidence[].id`.
- `explanation.status === "available"` implies the FailureExplanation rules above.
- No field contains a value that redaction replaced (SC-003).

### Strength presentation (UI only)

The UI shows `conclusion.strength` as the label "High" or "Moderate", with no numeric value
(clarification 2026-09-24). It appears next to a `RULE` provenance badge and the rule's
description. An `insufficient-evidence` conclusion shows no strength label.

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

Amended 2026-09-24 (research D18):

| status | Fields |
|---|---|
| `analyzed` | `analysis: FailureAnalysis`: the new analysis, stored, which replaced any earlier one. Its explanation may be unavailable. |
| `kept-previous` | `analysis: FailureAnalysis`: the new one, not stored, with an unavailable explanation. Also `previousAnalysis: FailureAnalysis`: the stored one, unchanged, which has an available explanation. And `message: string`. |

`ai-failed` and `not-viable` are removed: they are now `explanation.reason` values.

## Lifecycle and state

```text
(no analysis) ── POST ──► classify (rules, synchronous) ──► waiting-for-ai ── onStarted ──► generating
                                                                 │                             │
                                                                 └──────────────┬──────────────┘
                                                                                ▼
                                                       explanation available or unavailable
                                                                                │
   stored row has an available explanation AND the new one is unavailable ──► kept-previous (nothing written)
   otherwise ──────────────────────────────────────────────────────────────► analyzed (row upserted)

any POST in the session while one is waiting-for-ai/generating ──► 409 failure_analysis_in_progress
stored row ── session idle-evicted ──► row deleted (onExpire listener)
waiting-for-ai/generating ── backend restart ──► in-progress entry lost; nothing stored; user may request again
startup ──► rows with analysis_version NULL (the AI-decided design) deleted and counted in the log (research D19)
```

## Persistence (AP-025 extension)

A new table, `failure_analyses`, is described in research D9. The primary key is
`(session_id, run_id, result_index)`. The `FailureAnalysis` JSON is encrypted in
`analysis_encrypted`/`analysis_iv` with the existing cipher, and `generated_at` is stored in
plaintext for ordering. Rows are deleted by session eviction together with the run they belong to.

Amended 2026-09-24:
- A nullable `analysis_version INTEGER` column is added idempotently by `ensureColumn`.
- New rows store `2`.
- On startup, rows with `NULL` are deleted, which is the one other deletion path. The count is
  logged as `failure_analyses_legacy_removed` (research D19).
