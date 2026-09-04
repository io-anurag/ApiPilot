# API Contract: API Dependency & Integration Workflow Engine

AP-008 provides a stateless analysis boundary. It accepts an `ApiModel`, returns the discovered
dependency relationships and assembled workflows in one response, and persists nothing. It never
issues a network request to any API described by the specification.

## `POST /api/api-models/dependencies`

Analyzes an `ApiModel` for dependency relationships and assembles integration workflows from the
confident ones.

### Request

```json
{
  "apiModel": { "operations": [], "securitySchemes": {}, "summary": {} }
}
```

`apiModel` is required and must match the shape produced by `POST /api/specifications`. No
`TestModel` is accepted; this endpoint reasons about operations and schemas, not generated test
scenarios.

### Success Response: `200 OK`

```json
{
  "requestId": "dep-3f9a2c1e8b7d4560",
  "graph": {
    "relationships": [
      {
        "id": "a1b2c3d4e5f6...",
        "producer": { "operationPath": "/users", "operationMethod": "POST", "field": "id" },
        "consumer": {
          "operationPath": "/users/{userId}",
          "operationMethod": "GET",
          "field": "userId",
          "location": "path"
        },
        "confidence": "CONFIRMED",
        "source": "deterministic",
        "evidence": {
          "nameMatch": true,
          "typeMatch": true,
          "formatMatch": false,
          "resourceRelationship": true,
          "tagAlignment": true
        },
        "explanation": "POST /users returns 'id'; GET /users/{userId} consumes it as path parameter 'userId'. Same resource path, matching type, shared tag 'users'."
      },
      {
        "id": "b2c3d4e5f6a1...",
        "producer": { "operationPath": "/accounts", "operationMethod": "POST", "field": "accountId" },
        "consumer": {
          "operationPath": "/transfers",
          "operationMethod": "POST",
          "field": "accountRef",
          "location": "body"
        },
        "confidence": "LIKELY",
        "source": "ai",
        "aiCorroboration": {
          "aiModel": "mock-dependency-model",
          "aiProvider": "mock",
          "aiConfidence": 0.88,
          "aiRationale": "accountRef in the transfer request body semantically refers to the account identifier returned by account creation."
        },
        "explanation": "AI-suggested: accountRef (POST /transfers) is inferred to reference accountId (POST /accounts). No deterministic name/type match found this pair."
      }
    ]
  },
  "workflows": [
    {
      "id": "w1a2b3c4...",
      "steps": [
        { "position": 0, "operationPath": "/users", "operationMethod": "POST", "producesVariableNames": ["userId"], "consumesVariableNames": [] },
        { "position": 1, "operationPath": "/users/{userId}", "operationMethod": "GET", "producesVariableNames": [], "consumesVariableNames": ["userId"] },
        { "position": 2, "operationPath": "/users/{userId}", "operationMethod": "PUT", "producesVariableNames": [], "consumesVariableNames": ["userId"] },
        { "position": 3, "operationPath": "/users/{userId}", "operationMethod": "DELETE", "producesVariableNames": [], "consumesVariableNames": ["userId"] }
      ],
      "variables": [
        {
          "name": "userId",
          "producerStepIndex": 0,
          "producerField": "id",
          "consumerStepIndex": 1,
          "consumerLocation": "path",
          "consumerField": "userId",
          "relationshipId": "a1b2c3d4e5f6..."
        }
      ],
      "relationshipIds": ["a1b2c3d4e5f6..."]
    }
  ],
  "manualConfirmationCandidates": [
    {
      "relationshipId": "c3d4e5f6a1b2...",
      "reason": "possible-confidence",
      "message": "Field name 'name' matches between User and Product schemas with no other supporting evidence; confirm manually before including in a workflow."
    }
  ],
  "cycles": [],
  "aiOutcome": "success"
}
```

The response is fully deterministic for its deterministic portion — the same `apiModel` produces an
identical `graph.relationships` set (for deterministically-sourced and merged relationships),
`workflows`, `manualConfirmationCandidates`, and `cycles` on every repeated call. AI-only
relationships follow constitution XXIV: reproducible in automated tests via the mock provider, best
effort (not contractually byte-identical) against a live local model.

`aiOutcome` reports what happened to the AI-assisted pass:

| Value | Meaning |
| ----- | ------- |
| `success` | The AI call returned and its candidates were processed (accepted, merged, or rejected) |
| `unavailable` | The configured AI provider was not ready; deterministic relationships are still returned |
| `timeout` | The AI call did not return within its request-scoped timeout; deterministic relationships are still returned |
| `invalid-response` | The AI call returned output that failed shape/semantic validation; deterministic relationships are still returned |
| `skipped` | No `AIProvider` was supplied to this analysis run |

An `aiOutcome` other than `success` never fails the request (FR-018); it only means the `graph`
contains deterministic relationships only.

### Error Response: `400 Bad Request`

```json
{ "error": "invalid_request", "message": "apiModel.operations must be an array" }
```

| Code | Meaning |
| ---- | ------- |
| `invalid_request` | The body is missing `apiModel` or it is not the expected shape |

### Error Response: `500 Internal Server Error`

Returned only when the deterministic analysis or workflow assembly itself cannot complete within the
performance budget (SC-008). This is distinct from an AI failure, which never produces an error
response.

```json
{ "error": "analysis_timeout", "message": "Dependency analysis did not complete within the performance budget." }
```

## Guarantees asserted by contract tests

- No relationship is classified CONFIRMED or LIKELY with only a name match and no other evidence
  (FR-003, SC-002).
- Every relationship carries a non-empty `explanation` and identifies deterministic vs. AI evidence
  (FR-007, SC-004).
- No workflow step consumes a variable before the step that produces it appears earlier in `steps`
  (FR-013, SC-005).
- Every `WorkflowVariable.relationshipId` and every workflow's `relationshipIds` reference an entry
  present in `graph.relationships` (FR-022).
- Repeating an identical request (same `apiModel`, mock AI provider) yields an identical response
  body (FR-010, FR-016, SC-003).
- No request is issued to any host described by the `apiModel` during analysis (FR-019, SC-009).
- An AI-suggested relationship referencing a field or operation absent from the `apiModel` never
  appears in `graph.relationships` (FR-008).

## Consumers

No frontend page is introduced in this feature (research.md). This endpoint is consumed by later
features: AP-006's review capability (for confirming `manualConfirmationCandidates` and
approving workflows) and AP-009's end-to-end workflow assembly.
