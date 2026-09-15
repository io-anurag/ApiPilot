# API Contract: Distinct-Credential Token Provisioning for Postman Export

This feature extends the existing stateless `POST /api/test-models/postman-collection` contract
(007-postman-collection-generator, 016-workflow-aware-postman, 019-auto-workflow-chaining) and the
guided workflow's Postman-generation stage. **The request shape is unchanged** — this feature needs
no new input; `apiModel.securitySchemes`, already part of every request, is sufficient. Only the
**response** gains one additive field.

## `POST /api/test-models/postman-collection`

### Request

No new fields. Existing requests are interpreted exactly as before; the difference is entirely in
how `apiModel.securitySchemes` is now read when it declares more than one distinctly-keyed scheme of
the same type.

```json
{
  "apiModel": {
    "operations": [
      { "path": "/auth/login", "method": "POST", "operationId": "login", "security": [], "...": "…" },
      { "path": "/auth/admin-login", "method": "POST", "operationId": "adminLogin", "security": [], "...": "…" },
      { "path": "/reports", "method": "GET", "security": [{ "schemes": [{ "name": "adminAuth", "scopes": [] }] }], "...": "…" },
      { "path": "/orders", "method": "GET", "security": [{ "schemes": [{ "name": "bearerAuth", "scopes": [] }] }], "...": "…" }
    ],
    "securitySchemes": {
      "bearerAuth": { "type": "http", "scheme": "bearer" },
      "adminAuth": { "type": "http", "scheme": "bearer" }
    },
    "summary": {}
  },
  "testModel": { "scenarios": [] }
}
```

### Success Response: `200 OK`

The existing response fields remain unchanged in shape. `limitations` may now include the new kind
below, and `ExportResult` gains one new field, `credentialProducers`:

```json
{
  "collection": {
    "info": {},
    "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{token}}", "type": "string" }] },
    "item": [
      {
        "name": "reports folder",
        "item": [
          {
            "name": "GET /reports",
            "request": {
              "method": "GET",
              "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{adminToken}}", "type": "string" }] }
            }
          }
        ]
      }
    ]
  },
  "environment": {
    "name": "… environment",
    "values": [
      { "key": "token", "value": "", "type": "secret", "enabled": true },
      { "key": "adminToken", "value": "", "type": "secret", "enabled": true }
    ]
  },
  "readme": "…",
  "validation": { "valid": true, "problems": [] },
  "limitations": [
    {
      "kind": "unresolved-credential-producer",
      "location": "security scheme \"adminAuth\"",
      "message": "No operation in the specification could be identified as obtaining the \"adminAuth\" credential; populate {{adminToken}} manually. Affected operations: GET /reports."
    }
  ],
  "summary": { "requestCount": 2, "folderCount": 1, "byProvenance": { "RULE": 2, "AI": 0 }, "...": "…" },
  "credentialProducers": []
}
```

When the specification instead declares an unauthenticated `POST /auth/admin-login` whose path
contains `adminAuth`'s stem (`admin`) as its sole match, `credentialProducers` contains:

```json
{
  "credentialProducers": [
    {
      "schemeKey": "adminAuth",
      "variableName": "adminToken",
      "producerOperationPath": "/auth/admin-login",
      "producerOperationMethod": "POST"
    }
  ],
  "limitations": []
}
```

and no `unresolved-credential-producer` limitation is recorded for `adminAuth`.

**This feature does not wire `credentialProducers` entries into the collection.** No request's
auth block, test script, or environment value changes because a producer was found; the array is
solely the identification contract a later extension to automatic chaining (spec 019's
`automaticChaining.ts`) will consume to actually capture and substitute the value (spec FR-009).
Today, whether or not a producer is identified, every distinct-scheme variable is emitted empty in
the environment exactly as `{{token}}` always has been.

### Error Responses

Unchanged (see 007/016/019 contracts). This feature validates no new request field.

## Guided Workflow Contract

`POST /api/test-generation-workflow/postman-generation` is unaffected — it already forwards the full
`apiModel` (including `securitySchemes`) unchanged; no new stage or request field is introduced.

## Guarantees

- A specification declaring exactly one scheme per type produces byte-identical `collection.json`
  and `environment.json` output to every export generated before this feature existed (SC-001).
- Every operation's auth block references the credential variable matching its own declared scheme
  key, never another distinct scheme's variable (SC-002).
- Every distinct scheme with no discoverable producer produces exactly one
  `unresolved-credential-producer` limitation, naming the scheme and every affected operation
  (SC-003) — never a silently-empty, unexplained variable.
- Tag names, folder names, and path segments are never used to decide whether a credential is
  distinct (FR-005) — only the declared security scheme key.
- `credentialProducers` never causes a request to be executed, and never appears anywhere a real
  credential value could leak (it carries only scheme keys, variable names, and operation
  identifiers, never a token value).
