# API Contract: Specification Upload & Analysis

## `POST /api/specifications`

Uploads an OpenAPI specification file for parsing, validation, and analysis.

### Request

- **Content-Type**: `multipart/form-data`
- **Field**: `file` — a single YAML file (`.yaml`/`.yml`)
- **Max size**: enforced at the documented limit (default ~10 MB, FR-015); requests
  exceeding it are rejected before parsing begins

### Success Response — `200 OK`

Returned when the file is valid YAML and a supported OpenAPI 3.x document (even if it
contains flagged ambiguities — see `summary.issues` below).

```json
{
  "apiModel": {
    "operations": [
      {
        "path": "/pets/{petId}",
        "method": "GET",
        "operationId": "getPet",
        "parameters": [
          { "name": "petId", "location": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": null,
        "responses": [
          { "statusCode": "200", "description": "A pet", "contentTypes": { "application/json": { "type": "object" } }, "examples": {} }
        ],
        "security": [],
        "tags": ["pets"]
      }
    ],
    "securitySchemes": {},
    "summary": {
      "operationCount": 1,
      "schemaCount": 1,
      "securitySchemeCount": 0,
      "issues": []
    }
  }
}
```

### Error Responses

- **400 Bad Request** — the uploaded content is not valid YAML (FR-004).
  ```json
  { "error": "invalid_yaml", "message": "The uploaded file could not be parsed as YAML: <details>" }
  ```
- **400 Bad Request** — the document is valid YAML but not a supported OpenAPI version
  (FR-004).
  ```json
  { "error": "unsupported_version", "message": "Only OpenAPI 3.x documents are supported; found: <version>" }
  ```
- **413 Payload Too Large** — the file exceeds the documented maximum size (FR-015).
  ```json
  { "error": "file_too_large", "message": "Uploaded file exceeds the maximum allowed size of <limit>" }
  ```
- **405 Method Not Allowed** — for any method other than `POST` on this route.

### Behavior Notes

- The endpoint MUST NOT execute any code contained in, or referenced by, the uploaded
  document (FR-016).
- The endpoint MUST NOT fetch external (`http(s)://` or filesystem) `$ref` targets; such
  references are reported in `summary.issues` as `"unresolved-ref"` (FR-005, FR-006).
- The uploaded file and derived `apiModel` are not persisted beyond the request/session
  (research.md "No persistence" decision).
- A response with `summary.issues` non-empty is still a `200 OK` — issues are ambiguities
  to review, not upload failures (FR-013 vs. FR-004).
