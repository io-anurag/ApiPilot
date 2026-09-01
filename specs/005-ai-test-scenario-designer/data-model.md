# Phase 1 Data Model: AI Test Scenario Designer

AP-005 extends the framework-independent shared domain. AI candidates are intermediate
inferences; only validated candidates become scenarios in `EnhancedTestModel`.

## Provenance Extension

`Provenance.source` becomes a discriminator supporting the existing `RULE` value and the new
`AI` value. Existing RULE fields remain valid. AI provenance contains:

| Field                     | Type             | Validation                                               |
| ------------------------- | ---------------- | -------------------------------------------------------- |
| `source`                  | `"AI"`           | Required for AI-derived scenarios                        |
| `description`             | `string`         | Non-empty rationale-facing description                   |
| `duplicateOfRules`        | `string[]`       | Existing field; unchanged for RULE compatibility         |
| `duplicateOfAICandidates` | `string[]`       | Stable IDs of equivalent AI candidates; defaults to `[]` |
| `aiModel`                 | `string`         | Provider-reported model identity                         |
| `aiProvider`              | `AIProviderMode` | Provider mode that produced the candidate                |
| `aiRationale`             | `string`         | Non-empty explanation of the semantic risk               |
| `aiConfidence`            | `number`         | Inclusive range $0 \leq confidence \leq 1$               |
| `aiAssumptions`           | `string[]`       | Explicit assumptions or uncertainty; defaults to `[]`    |

## AIScenarioCandidate

The structured candidate returned by the AI response contract before domain conversion.

| Field             | Type               | Validation                                                                             |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `candidateId`     | `string`           | Non-empty within one response; used for traceability                                   |
| `operationPath`   | `string`           | Must match an `ApiOperation.path`                                                      |
| `operationMethod` | `string`           | Must match an operation method                                                         |
| `category`        | `ScenarioCategory` | Must be an allowed semantic category; deterministic-only categories are not fabricated |
| `targetLocation`  | location union     | Must match the referenced operation input location                                     |
| `targetField`     | `string`           | Required when targeting a field; must resolve in operation schemas/parameters          |
| `request`         | `GeneratedRequest` | Must use only supported operation inputs                                               |
| `assertions`      | `Assertion[]`      | Status codes and schemas must be documented in `ApiModel`                              |
| `rationale`       | `string`           | Required, non-empty                                                                    |
| `confidence`      | `number`           | Required and bounded from 0 through 1                                                  |
| `assumptions`     | `string[]`         | Explicitly identifies inferred context                                                 |

## ValidationFinding

| Field         | Type                  | Meaning                                                                                                                        |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `code`        | closed string         | Examples: `invalid-shape`, `operation-not-found`, `field-not-found`, `undocumented-status-code`, `low-confidence`, `duplicate` |
| `message`     | `string`              | Safe actionable explanation                                                                                                    |
| `candidateId` | `string`              | Candidate being evaluated                                                                                                      |
| `path`        | `string \| undefined` | Candidate field path when relevant                                                                                             |
| `executable`  | `boolean`             | Whether candidate may enter `TestModel`                                                                                        |

## Candidate Outcomes

`EnhancementResult.aiCandidates` partitions candidates into:

- `added`: validated candidates added to the executable model.
- `deduplicated`: candidates equivalent to an existing scenario or another AI candidate,
  with retained scenario identity and contributing candidate IDs.
- `rejected`: malformed or contract-invalid candidates with findings.
- `nonExecutable`: structurally valid suggestions that cannot be safely mapped to executable
  domain intent, with findings and the original candidate summary.

## EnhancementResult

| Field               | Type                                                            | Rules                                                                        |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `enhancedTestModel` | `TestModel`                                                     | Contains all input deterministic scenarios plus added validated AI scenarios |
| `aiCandidates`      | outcome partitions                                              | Every provider candidate appears in exactly one outcome partition            |
| `aiProviderOutcome` | `"success" \| "unavailable" \| "timeout" \| "invalid-response"` | Explicit provider/result state                                               |
| `aiErrorCategory`   | `AIErrorCategory \| undefined`                                  | Present for provider failures                                                |
| `aiErrorMessage`    | `string \| undefined`                                           | Safe, actionable message; no raw prompt/specification by default             |
| `requestId`         | `string`                                                        | Correlates enhancement with provider inference                               |

## Invariants and State Flow

1. `ApiModel` and deterministic `TestModel` are accepted unchanged as input.
2. Provider response is parsed and structurally validated.
3. Each candidate becomes `added`, `deduplicated`, `rejected`, or `nonExecutable`.
4. Only `added` candidates enter the enhanced model; deduplicated candidates are represented
   by the retained scenario and provenance.
5. Provider failure bypasses candidate assembly and returns the original deterministic model.
6. No enhancement result authorizes review approval, artifact generation, or execution.
