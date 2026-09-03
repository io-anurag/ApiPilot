# API Contract: Postman Collection Generator

AP-007 provides a stateless generation boundary. It accepts an `ApiModel` and an approved
`TestModel`, returns the generated artifacts in one response, and persists nothing. It never issues
a network request to any API described by the specification and never invokes AI.

## `POST /api/test-models/postman-collection`

Generates the collection, environment, and accompanying document from an approved TestModel.

### Request

```json
{
  "apiModel": { "operations": [], "securitySchemes": {}, "summary": {} },
  "testModel": { "scenarios": [] },
  "options": {
    "collectionName": "Orders API tests",
    "baseUrl": "https://qa.internal.example",
    "variableValues": { "token": "" }
  }
}
```

`apiModel` and `testModel` are required. `testModel` must be the approved TestModel produced by
`POST /api/test-models/reviews`; this endpoint does not review, filter by review state, or approve.

`options` is optional in full and in every field. `variableValues` accepts only names the generated
collection actually references; an unknown name is a validation error rather than a silently ignored
field. Values supplied for credential variables are written to the environment artifact only.

### Success Response: `200 OK`

```json
{
  "collection": {
    "info": {
      "name": "Orders API tests",
      "_postman_id": "…",
      "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    "variable": [{ "key": "baseUrl", "value": "" }],
    "item": [
      {
        "name": "orders",
        "item": [
          {
            "id": "…",
            "name": "POST /orders — positive",
            "request": {
              "method": "POST",
              "url": {
                "raw": "{{baseUrl}}/orders",
                "host": ["{{baseUrl}}"],
                "path": ["orders"],
                "query": [],
                "variable": []
              },
              "header": [{ "key": "Content-Type", "value": "application/json" }],
              "body": { "mode": "raw", "raw": "{}", "options": { "raw": { "language": "json" } } }
            },
            "event": [
              {
                "listen": "test",
                "script": { "type": "text/javascript", "exec": ["…"] }
              }
            ]
          }
        ]
      }
    ]
  },
  "environment": {
    "name": "Orders API tests environment",
    "_postman_variable_scope": "environment",
    "values": [
      { "key": "baseUrl", "value": "https://qa.internal.example", "type": "default", "enabled": true },
      { "key": "token", "value": "", "type": "secret", "enabled": true }
    ]
  },
  "readme": "# Orders API tests\n…",
  "validation": { "valid": true, "problems": [] },
  "limitations": [
    {
      "kind": "no-expected-outcome",
      "scenarioId": "scenario-14",
      "location": "POST /orders",
      "message": "The specification documents no error response for this operation, so no expected outcome is asserted."
    }
  ],
  "summary": {
    "requestCount": 42,
    "folderCount": 5,
    "byProvenance": { "RULE": 36, "AI": 4 }
  }
}
```

`byProvenance` counts the origins the approved `TestModel` actually carries. `Provenance.source`
is `RULE` or `AI`; a scenario's user-modified flag lives on AP-006's `ReviewScenario`, which this
boundary never receives, so no `USER` count is reported. Reporting one would mean inventing it
(constitution I). If a later feature needs that count, AP-006 must carry the flag into the
approved model, and this contract changes with it.

The response is fully deterministic: the same `apiModel`, `testModel`, and `options` produce a
byte-identical body, including the ordering of folders, items, headers, query parameters, and
environment values.

`limitations` reports what could not be expressed. It never blocks a successful response — a
successful export with recorded limitations is the expected outcome for most real specifications.

### Error Response: `400 Bad Request`

Returned for a malformed or unusable request body.

```json
{ "error": "invalid_request", "message": "testModel.scenarios must be an array" }
```

Error codes:

| Code                        | Meaning                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `invalid_request`           | The body is missing `apiModel`/`testModel` or they are not the expected shape |
| `empty_approved_test_model` | The approved TestModel contains no scenarios (FR-020)                      |
| `unknown_operation`         | A scenario references an operation the ApiModel does not contain           |
| `unknown_variable`          | `options.variableValues` names a variable the collection does not reference |
| `workflow_intent_unsupported` | The TestModel carries multi-step workflow intent, which this feature does not render (FR-030) |

### Error Response: `500 Internal Server Error`

Returned when generation completed but the produced collection failed validation (FR-015). The
artifacts are not returned; an invalid artifact is never presented as a successful export.

```json
{
  "error": "collection_validation_failed",
  "message": "The generated collection did not pass validation and was not returned.",
  "problems": ["item[3].request.url.raw does not begin with {{baseUrl}}"]
}
```

`problems` names failing locations and expectations only. It never contains request payloads,
specification content, or variable values (FR-025).

## Guarantees asserted by contract tests

- No response field contains a literal host; every request URL begins with `{{baseUrl}}` (FR-008).
- No credential value appears in `collection`, `readme`, or any error body; supplied credential
  values appear only in `environment.values` with `type: "secret"` (FR-011, SC-003, SC-004).
- Every `{{…}}` reference in the collection is declared in both `collection.variable` and
  `environment.values` (FR-010).
- Every emitted check corresponds to an assertion carried by the approved scenario; no request
  carries a check the scenario did not define (FR-006, SC-005).
- Repeating an identical request yields an identical response body (FR-018, SC-002).
- Removing one scenario from the approved TestModel changes only that scenario's item (User Story 4).
- No request is issued to any host in the specification during generation (FR-023, SC-012).

## Frontend contract

The export UI calls this endpoint once per export and writes three files from the single response:
`collection.json`, `environment.json`, and `README.md`. It exposes loading, success, empty, and
failure states with recovery guidance (FR-027), reports the validation outcome and the limitation
list to the engineer (FR-014, FR-017), and never renders a supplied credential value back to the
page.
