# API Contract: AI Test Model Enhancement

## `POST /api/test-models/enhance`

Enhances a caller-supplied deterministic `TestModel` with validated semantic AI candidates.
The endpoint is stateless and does not persist the supplied API specification or models.

### Request

- **Content-Type**: `application/json`
- **Body**:

  ```json
  {
    "apiModel": { "operations": [], "securitySchemes": {}, "summary": {} },
    "testModel": { "scenarios": [] }
  }
  ```

Both models are the normalized shapes produced by AP-002 and AP-003. The request must
contain an `apiModel.operations` array and a `testModel.scenarios` array.

### Success Response: `200 OK`

```json
{
  "requestId": "enhance-request-id",
  "enhancedTestModel": { "scenarios": [] },
  "aiCandidates": {
    "added": [],
    "deduplicated": [],
    "rejected": [],
    "nonExecutable": []
  },
  "aiProviderOutcome": "success"
}
```

`enhancedTestModel.scenarios` retains every supplied deterministic scenario and adds only
validated, non-duplicate AI scenarios. AI-derived scenarios have `provenance.source` equal
to `AI`, plus rationale, confidence, provider/model identity, and assumptions.

### Provider Degradation Response: `200 OK`

Provider unavailability, timeout, or invalid output returns `200` with the unchanged
deterministic model and an explicit `aiProviderOutcome` such as `unavailable`, `timeout`, or
`invalid-response`. `aiErrorCategory` and a safe `aiErrorMessage` explain the outcome.
This prevents an AI outage from hiding the deterministic baseline.

### Partial Completion Response: `200 OK`

When `apiModel` is large enough to require multiple AI batches (specs/011-ai-prompt-batching),
`aiProviderOutcome` may instead be `partial`: at least one batch succeeded while at least one
other failed, timed out, or was not attempted. `enhancedTestModel.scenarios` includes the
deterministic baseline plus whatever AI scenarios the successful batches produced, and
`aiErrorCategory`/`aiErrorMessage` describe the failing/not-attempted batches (see
specs/011-ai-prompt-batching/contracts/ai-batching-outcome.md for the full outcome-derivation
rationale). `partial` is never returned when every batch fails — that case still reports the
same `aiProviderOutcome` values (`unavailable`, `timeout`, `invalid-response`) as a single-batch
failure, for backward compatibility.

### Error Responses

- **400 Bad Request** — missing or minimally invalid `apiModel` or `testModel`.
  ```json
  { "error": "invalid_test_model_enhancement_request", "message": "..." }
  ```
- **405 Method Not Allowed** — any method other than `POST` on this route.

### Behavior and Safety Rules

- The route invokes AI only through `AIProvider`; it never imports a concrete inference
  runtime.
- AI candidates referencing unknown operations, methods, fields, schemas, or undocumented
  status codes are rejected or marked non-executable and never enter the executable model.
- AI content is never promoted to specification-derived or rule-derived provenance.
- Equivalent scenarios are represented once, with contributing AI origin details preserved.
- The endpoint does not approve, authorize, execute, or generate an artifact from a scenario.
- Sensitive prompts, full specifications, credentials, and raw provider content are not
  included in error messages by default.
