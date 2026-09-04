# AP-008 Data Model

All types below are framework-independent and belong in a new
`packages/shared-domain/src/apiDependency.ts` module. Nothing here changes `ApiModel`, `TestModel`,
`TestScenario`, or `Provenance`; AP-008 introduces new domain concepts (constitution X: API
dependency, workflow, workflow variable, confidence).

## Inputs

| Input      | Source  | Role                                                                 |
| ---------- | ------- | --------------------------------------------------------------------- |
| `ApiModel` | AP-002  | Operations, parameters, request/response schemas, tags, security      |
| `AIProvider` | AP-004 | Optional semantic detection pass; the backend selects/injects it     |

No `TestModel` input is required; this feature reasons about operations and schemas, not generated
scenarios (research.md).

## FieldRef

Identifies one field on one side of a relationship.

| Field      | Meaning                                              | Invariant                                    |
| ---------- | ----------------------------------------------------- | --------------------------------------------- |
| `operationPath` | The operation's declared path                    | Matches an `ApiOperation.path` in the ApiModel |
| `operationMethod` | The operation's HTTP method                    | Matches an `ApiOperation.method`               |
| `field`    | Dotted field path (e.g. `id`, `user.id`)              | Producer: a path yielded by `walkFields` over a 2xx response schema. Consumer: a parameter name, or a path yielded by `walkFields` over the request body schema |
| `location` | Where the consumer reads the field                   | `"path" \| "query" \| "header" \| "body"`; present only on the consumer side |

## DeterministicDependencyEvidence

The five boolean signals computable from the current `ApiModel` (research.md).

| Field | Meaning |
| ----- | ------- |
| `nameMatch` | Producer and consumer field names match after normalization (case-insensitive; common `Id`/`ID` suffix treated as equivalent) |
| `typeMatch` | Both schemas declare the same `SchemaConstraint.type` |
| `formatMatch` | Both schemas declare the same `SchemaConstraint.format` (absent on both sides does not count) |
| `resourceRelationship` | The operations' paths have a prefix relationship after stripping `{param}` segments |
| `tagAlignment` | The operations share at least one `ApiOperation.tags` entry |

## AIDependencyCorroboration

Present when the AI-assisted pass reported the same relationship, or found it independently.

| Field | Meaning |
| ----- | ------- |
| `aiModel` | The model identifier that produced the candidate (`InferenceResponse.modelId`) |
| `aiProvider` | `AIProviderMode` (`local` \| `mock`) |
| `aiConfidence` | The model's own reported confidence (0–1) |
| `aiRationale` | The model's stated reasoning |

## Confidence classification

`DependencyConfidence = "CONFIRMED" | "LIKELY" | "POSSIBLE"`. A relationship with only deterministic
evidence is classified by this fixed rule (research.md):

| Signals present | Classification |
| ---------------- | -------------- |
| `nameMatch` + `resourceRelationship` + (`typeMatch` or `formatMatch`) | CONFIRMED |
| `nameMatch` + `resourceRelationship`, with neither `typeMatch` nor `formatMatch` | LIKELY |
| `nameMatch`, no `resourceRelationship`, with at least two of {`typeMatch`, `formatMatch`, `tagAlignment`} true | LIKELY |
| `nameMatch`, no `resourceRelationship`, with at most one of {`typeMatch`, `formatMatch`, `tagAlignment`} true | POSSIBLE |
| No `nameMatch` | Not reported by deterministic matching (may still be found by the AI pass) |

This table is exhaustive: `nameMatch` gates whether deterministic matching reports anything at all, and
every combination of the remaining four booleans (`resourceRelationship`, `typeMatch`, `formatMatch`,
`tagAlignment`) falls into exactly one row above.

A relationship found only by the AI pass (no deterministic `nameMatch`) is classified:

| AI signal | Classification |
| --------- | -------------- |
| `aiConfidence` ≥ 0.85 | LIKELY |
| `aiConfidence` < 0.85 | POSSIBLE |

AI can never place a relationship at CONFIRMED unaided (research.md, constitution XV). When the
deterministic and AI passes independently find the *same* field pair, they merge into one
relationship (FR-006a) that keeps the deterministic classification above and attaches
`aiCorroboration` purely as supporting evidence — it never changes the classification.

## ApiDependencyRelationship

| Field | Meaning | Invariant |
| ----- | ------- | --------- |
| `id` | Content-derived identifier | SHA-256 over the producer/consumer field-ref tuple (research.md) |
| `producer` | `FieldRef` (no `location`) | References an operation and response field present in the ApiModel |
| `consumer` | `FieldRef` (with `location`) | References an operation and request field present in the ApiModel |
| `confidence` | `DependencyConfidence` | Set per the classification table above; never omitted (FR-002) |
| `source` | `"deterministic" \| "ai" \| "deterministic+ai"` | `"deterministic+ai"` only for a merged relationship (FR-006a) |
| `evidence` | `DeterministicDependencyEvidence` | Present whenever `source` includes `"deterministic"` |
| `aiCorroboration` | `AIDependencyCorroboration` | Present whenever `source` includes `"ai"` |
| `explanation` | Human-readable summary of the evidence/rationale | Non-empty; names the specific signals or AI rationale used (FR-007) |

## ApiDependencyGraph

The full analysis output before workflow assembly.

| Field | Meaning |
| ----- | ------- |
| `relationships` | Every `ApiDependencyRelationship` found, CONFIRMED through POSSIBLE, deduplicated per FR-006a |

An empty `relationships` array is a valid, explicit result (FR-009), not an error.

## WorkflowVariable

One inter-step hand-off inside a generated workflow.

| Field | Meaning | Invariant |
| ----- | ------- | --------- |
| `name` | A workflow-scoped variable name derived from the consumer field | Unique within its `IntegrationWorkflow` |
| `producerStepIndex` | Index into `IntegrationWorkflow.steps` that produces the value | Always less than `consumerStepIndex` (FR-013) |
| `producerField` | The producer's response field | Matches the originating relationship's `producer.field` |
| `consumerStepIndex` | Index into `IntegrationWorkflow.steps` that consumes the value | |
| `consumerLocation` | Where the consuming step reads the value | Matches the originating relationship's `consumer.location` |
| `consumerField` | The consumer's request field | Matches the originating relationship's `consumer.field` |
| `relationshipId` | The `ApiDependencyRelationship.id` this hand-off came from | References an entry in the same analysis's `relationships` |

## WorkflowStep

| Field | Meaning |
| ----- | ------- |
| `position` | 0-based order within the workflow |
| `operationPath` | The step's operation path |
| `operationMethod` | The step's operation method |
| `producesVariableNames` | Names of `WorkflowVariable`s this step's response feeds |
| `consumesVariableNames` | Names of `WorkflowVariable`s this step's request reads |

## IntegrationWorkflow

| Field | Meaning | Invariant |
| ----- | ------- | --------- |
| `id` | Content-derived identifier | SHA-256 over the ordered `relationshipIds` (research.md) |
| `steps` | Ordered `WorkflowStep[]` | A consuming step never precedes its producing step (FR-013) |
| `variables` | `WorkflowVariable[]` | One entry per hand-off used to assemble this workflow |
| `relationshipIds` | Ordered `ApiDependencyRelationship["id"][]` that produced this workflow | Traces the workflow back to its evidence (FR-022) |

## ManualConfirmationCandidate

A POSSIBLE relationship, or a relationship excluded from automatic assembly by disambiguation, that
could extend or form a workflow with human confirmation (FR-012).

| Field | Meaning |
| ----- | ------- |
| `relationshipId` | The `ApiDependencyRelationship.id` in question |
| `reason` | `"possible-confidence" \| "excluded-by-disambiguation"` |
| `message` | Human-readable explanation of why it needs confirmation |

`"excluded-by-disambiguation"` covers the FR-013a case: a CONFIRMED/LIKELY relationship that was not
chosen as the resolved producer for a consuming field remains visible here rather than being
discarded.

## DependencyCycleFinding

A detected cycle among candidate relationships (FR-014).

| Field | Meaning |
| ----- | ------- |
| `relationshipIds` | The relationships forming the cycle |
| `operations` | The `{ path, method }` list of operations involved, in cycle order |
| `message` | Human-readable description of the contradictory ordering |

## DependencyAnalysisResult

The single value the analysis returns and the endpoint serializes.

| Field | Meaning |
| ----- | ------- |
| `requestId` | Content-derived id for this analysis run (mirrors `enhanceTestModel`'s `requestId`) |
| `graph` | `ApiDependencyGraph` |
| `workflows` | `IntegrationWorkflow[]` assembled from CONFIRMED/LIKELY relationships |
| `manualConfirmationCandidates` | `ManualConfirmationCandidate[]` |
| `cycles` | `DependencyCycleFinding[]` |
| `aiOutcome` | `"success" \| "unavailable" \| "timeout" \| "invalid-response" \| "skipped"` |
| `aiErrorCategory` | `AIErrorCategory`, present when `aiOutcome` is not `"success"`/`"skipped"` |
| `aiErrorMessage` | Human-readable summary; never contains prompts, responses, or specification content (FR-020) |

`aiOutcome: "skipped"` covers the case where no `AIProvider` was supplied to the analysis at all
(distinguishing "we did not try" from "we tried and it failed/timed out").

## Failure outcomes

Refusals, not results — an error response rather than a `DependencyAnalysisResult`.

| Outcome | Cause | Requirement |
| ------- | ----- | ----------- |
| `invalid_request` | The body is missing `apiModel` or it is not the expected shape | — |
| `analysis_timeout` | The deterministic analysis and workflow assembly itself could not complete within the performance budget | SC-008 |
