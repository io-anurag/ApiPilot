# API Contract: Baseline Test Model Generation

## `POST /api/test-models`

Generates a deterministic baseline `TestModel` from a previously analyzed `ApiModel` (the
same shape returned by `POST /api/specifications`, see
[../../002-openapi-specification-engine/contracts/specifications-api.md](../../002-openapi-specification-engine/contracts/specifications-api.md)).

### Request

- **Content-Type**: `application/json`
- **Body**:
  ```json
  { "apiModel": { "operations": [ /* ApiModel.operations, as returned by /api/specifications */ ], "securitySchemes": {}, "summary": { "operationCount": 0, "schemaCount": 0, "securitySchemeCount": 0, "issues": [] } } }
  ```

### Success Response — `200 OK`

```json
{
  "testModel": {
    "scenarios": [
      {
        "id": "b3f1c2a0-...",
        "operationPath": "/pets/{petId}",
        "operationMethod": "GET",
        "category": "positive",
        "targetLocation": null,
        "targetField": null,
        "request": {
          "pathParameters": { "petId": "example-id" },
          "queryParameters": {},
          "headers": {},
          "body": null
        },
        "assertions": [
          { "type": "status-code", "expectedStatusCode": "200" },
          { "type": "schema-conformance", "expectedSchema": { "type": "object", "required": [], "properties": {} } }
        ],
        "provenance": {
          "source": "RULE",
          "rule": "positive-scenario",
          "description": "Happy-path request using specification-conformant values.",
          "duplicateOfRules": []
        }
      },
      {
        "id": "1a2b3c4d-...",
        "operationPath": "/pets/{petId}",
        "operationMethod": "GET",
        "category": "invalid-type",
        "targetLocation": "path",
        "targetField": "petId",
        "request": {
          "pathParameters": { "petId": 12345 },
          "queryParameters": {},
          "headers": {},
          "body": null
        },
        "assertions": [
          { "type": "status-code", "expectedStatusCode": "400" }
        ],
        "provenance": {
          "source": "RULE",
          "rule": "invalid-type",
          "description": "petId sent as an incompatible type (expected string).",
          "duplicateOfRules": []
        }
      }
    ]
  }
}
```

### Error Responses

- **400 Bad Request** — the request body is missing `apiModel` or it does not have the
  minimal shape required (e.g., `operations` is not an array).
  ```json
  { "error": "invalid_api_model", "message": "The request body must include a valid 'apiModel' with an 'operations' array" }
  ```
- **405 Method Not Allowed** — for any method other than `POST` on this route.

### Behavior Notes

- This endpoint is stateless: it does not read or write any previously uploaded
  specification. The caller supplies the full `apiModel` produced by
  `POST /api/specifications` (research.md "no persistence" decision).
- Every `assertions[].expectedStatusCode` corresponds to a status code documented in the
  supplied `apiModel` for that operation; an empty `assertions` array on a scenario means
  no documented error response was available to assert against (never a fabricated
  `400`) — see `provenance.description` for the explanation.
- The endpoint MUST NOT invoke any AI/LLM inference (FR-014).
- Scenarios are deduplicated per operation before being returned (FR-012); a merged
  scenario's `provenance.duplicateOfRules` lists any additional rule(s) that would have
  produced an equivalent scenario.
