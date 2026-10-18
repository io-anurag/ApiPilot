# ApiPilot API Definition Format, Version 1

A small JSON format for describing an HTTP API when there is neither an OpenAPI document nor a HAR capture. The
machine-readable form of this document is [api-definition.v1.schema.json](api-definition.v1.schema.json) (JSON Schema
draft-07); the two are kept equal by a test. A ready-to-upload copy of the example at the end of this page is [examples/sample-api-definition.json](examples/sample-api-definition.json).

The format is **strict**: unknown fields are rejected, not ignored. It carries **no credential values**. Whatever is not
written is unknown, never defaulted: a parameter without `required` has unknown requiredness, an operation without
`responses` documents no statuses, an operation without a schema has no schema, and no scenario or assertion depends on
what is missing.

A JSON file is treated as a definition only if its top level has `"format": "apipilot.api-definition"`. A file that merely
resembles one (an `operations` list with `path` fields, say) is **not** interpreted and gets `unrecognized_input_format`.

## Top level

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `format` | `"apipilot.api-definition"` | yes | Identifies the format. |
| `version` | `1` | yes | Only version 1 exists. Any other value is rejected (`/version`). |
| `info` | object | yes | `title` (required, 1 to 200 characters), `version`, `description`. |
| `baseUrl` | string | no | Absolute `http` or `https` URL without credentials, query or fragment. Informational: shown in review, **never used as an execution target**. |
| `authentication` | array | no | Declared schemes (at most 20). No values. |
| `operations` | array | yes | 1 to 2,000 operations. |
| `dependencyHints` | array | no | At most 500. |

## `authentication[]`

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | `^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Referenced from an operation's `security`. Unique. |
| `type` | yes | `http-bearer`, `http-basic`, `api-key`, `oauth2-client-credentials`. |
| `in`, `parameterName` | for `api-key` | Where the key goes (`header`, `query`, `cookie`) and its name. Rejected for other types. |
| `tokenUrl` | for `oauth2-client-credentials` | Absolute `http` or `https` URL. Rejected for other types. |
| `scopes` | no | Scope names, `oauth2-client-credentials` only. |

There is no field for a token, key, password or secret. Credentials are supplied at execution time through an environment.

## `operations[]`

| Field | Required | Notes |
| --- | --- | --- |
| `method` | yes | Upper case: `GET POST PUT PATCH DELETE HEAD OPTIONS TRACE`. |
| `path` | yes | Starts with `/`, no query or fragment, no whitespace. Path parameters are written `{name}`. |
| `id` | no | `^[A-Za-z0-9_.-]{1,100}$`. Unique. Becomes the operation id. Needed to be referenced by a hint, unless the hint uses `"METHOD /path"`. |
| `description` | no | |
| `tags` | no | |
| `parameters` | no | Path, query, header and cookie parameters. **Request headers are header parameters** (give an `example`). |
| `requestBody` | no | One content type with optional schema and examples. |
| `responses` | no | Expected statuses with optional content type, schema and examples. |
| `security` | no | Names from `authentication`. Each name is an alternative: the operation accepts any one of them. An empty array states the operation needs none. Absent means unknown (the model holds no requirement in either case). |

### `parameters[]`

`name` and `in` are required. `required` (boolean), `description`, `schema`, `example` are optional. A path parameter must
appear in the path as `{name}`, and every `{name}` in the path must be declared; a path parameter must not set `required:
false`. A parameter is identified by its location and name (header names compare without case) and may be declared once.

A parameter's `example` is kept in the model with credential values replaced by placeholders. The generated tests send a
declared example for that parameter only in the declared-example scenario (see *How a definition is used to generate tests*);
a non-path parameter that states neither a schema nor an example is not sent.

### `requestBody`

`contentType` is required (a media type such as `application/json`). `required`, `schema` and `examples` are optional.
`examples` is a list of `{ "name"?, "value" }` (at most 20).

### `responses[]`

`status` is required: an integer 100 to 599 or a three-digit string. `description`, `contentType`, `schema` and `examples`
are optional, except that a `schema` or `examples` need a `contentType` to belong to. A status appears once per operation.

### `schema` (closed vocabulary)

Exactly these keys and no others: `type` (`string number integer boolean object array null`), `required`, `properties`,
`items`, `enum`, `format`, `minimum`, `maximum`, `pattern`, `minLength`, `maxLength`, `minItems`, `maxItems`. This is the
vocabulary ApiPilot already extracts from OpenAPI, so deterministic generation treats a definition schema exactly as it
treats an OpenAPI one. `$ref`, `$schema`, `$id`, `allOf`, `oneOf` and `anyOf` are unknown fields and are rejected; nothing
is ever fetched or resolved.

## `dependencyHints[]`

```json
{
  "producer": { "operation": "createOrder", "field": "id" },
  "consumer": { "operation": "getOrder", "location": "path", "field": "orderId" },
  "note": "optional"
}
```

`operation` is an operation `id` or `"METHOD /path"` (the path written exactly as in `operations`). `producer.field` is a
dotted response field path (`data.id`, or `items[].id` to step into an array); `consumer.location` is `path`, `query`,
`header` or `body`. `note` is for the author and is not used. A hint naming an operation that does not exist is a validation
error. When both operations declare schemas and both fields exist in them, the hint is verified and treated as a confirmed
relationship; otherwise it is likely, with the reason stated.

## Validation

Every violation found is reported at once, as `"<JSON Pointer>: <corrective message>"`, in the `problems` array of
`invalid_definition`. Nothing is imported when there is any violation.

| Violation | Example report |
| --- | --- |
| Missing or unsupported `version` | `/version: must be 1 (the only supported version)` |
| Unknown or misspelled field | `/operations/2/descripton: unknown field 'descripton'; check the spelling or remove it` |
| Missing `method` or `path` | `/operations/0/path: is required` |
| Method not upper case or unknown | `/operations/1/method: must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE` |
| Path does not start with `/` or has a query | `/operations/3/path: must start with '/' and contain no query or fragment` |
| Invalid status | `/operations/0/responses/1/status: must be an integer from 100 to 599` |
| Duplicate method and path | `/operations/4: duplicates operation 1 (GET /orders/{orderId})` |
| Duplicate `id` | `/operations/4/id: 'getOrder' is already used by operation 1` |
| Path parameter declared but not in the path, or in the path but not declared | `/operations/1/parameters/0: path parameter 'orderId' does not appear in the path` |
| `required: false` on a path parameter | `/operations/1/parameters/0/required: path parameters are always required` |
| Invalid schema (unknown key, bad type) | `/operations/0/requestBody/schema/foo: unknown field 'foo'` |
| Security reference to an undefined scheme | `/operations/0/security/0: 'bearerAuth' is not declared in authentication` |
| `baseUrl` not absolute `http` or `https`, or has credentials | `/baseUrl: must be an absolute http or https URL without credentials` |
| Dependency hint naming a nonexistent operation | `/dependencyHints/0/consumer/operation: no operation with id or key 'getOrdr'` |
| Path-located hint field that is not a path parameter of the operation | `/dependencyHints/0/consumer/field: 'orderNumber' is not a path parameter of GET /orders/{orderId}` |
| Malformed path template (unbalanced braces, bad or repeated parameter name) | `/operations/1/path: path parameters must be written as {name}, with balanced braces` |
| Duplicate parameter (same location and name) | `/operations/1/parameters/2: duplicates parameter 1 (query 'expand')` |
| Status declared twice for one operation | `/operations/0/responses/1/status: status 201 is already declared by response 0` |
| Response schema or examples without a content type | `/operations/0/responses/1/contentType: is required when a schema or examples are given` |
| Authentication field that does not belong to the type, or a missing one | `/authentication/0/in: is only valid for type 'api-key'`, `/authentication/0/tokenUrl: is required when type is 'oauth2-client-credentials'` |
| Duplicate authentication name | `/authentication/1/name: 'bearerAuth' is already used by authentication 0` |
| Invalid regular expression, or a minimum above its maximum, in an embedded schema | `/operations/0/requestBody/schema/properties/sku/pattern: is not a valid regular expression` |

A single mistake reports one message per location: alternatives inside `oneOf` (for example, `status`) are collapsed. Messages
may name a field or an identifier from your file (shortened, printable characters only) and never repeat a value. At most 100
problems are listed, followed by a line giving how many more there were.

## How a definition is used to generate tests

Deterministic generation reads a definition the way it reads an OpenAPI document, over only what you wrote:

- Required-field, type, enum, format, boundary and length scenarios come from the `schema` you declare; nothing is generated
  for a constraint you did not write. A body, a non-path parameter or a response schema with no schema states nothing and is
  not used to build a request or an assertion.
- Expected statuses and response-schema assertions come from `responses`, and are labelled **Declared**. An operation with no
  `responses` has no expected outcome, and its scenarios assert nothing.
- An operation whose request body has `examples` but no `schema` gets one extra positive scenario that sends the first example
  (with its parameters' examples), labelled as a declared example.
- Dependency hints become relationships in dependency analysis. A hint is **confirmed** only when both fields exist in the
  declared schemas; otherwise it is **likely**, and the explanation says it could not be checked.
- `baseUrl` is shown in review for your information. It is never used as a test target; the address of a run always comes from
  the environment you select.

## Credentials in examples

The format has no credential fields, but an example value can still hold one (for instance an `Authorization` header
parameter example, or a `password` field in a body example). Those values are replaced by placeholders before they enter
the model, and a `credential-detected` analysis issue says which locations held one. They never reach logs, AI prompts or
generated artifacts (FR-026).

## Example

```json
{
  "format": "apipilot.api-definition",
  "version": 1,
  "info": { "title": "Orders API", "version": "1.0.0", "description": "Minimal ordering service." },
  "baseUrl": "https://api.example.test",
  "authentication": [
    { "name": "bearerAuth", "type": "http-bearer" }
  ],
  "operations": [
    {
      "id": "createOrder",
      "method": "POST",
      "path": "/orders",
      "description": "Create an order.",
      "tags": ["orders"],
      "requestBody": {
        "contentType": "application/json",
        "required": true,
        "schema": {
          "type": "object",
          "required": ["sku", "quantity"],
          "properties": {
            "sku": { "type": "string", "minLength": 3 },
            "quantity": { "type": "integer", "minimum": 1, "maximum": 100 }
          }
        },
        "examples": [ { "name": "two widgets", "value": { "sku": "WID-001", "quantity": 2 } } ]
      },
      "responses": [
        {
          "status": 201,
          "description": "Order created.",
          "contentType": "application/json",
          "schema": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } } },
          "examples": [ { "value": { "id": "ord_1001" } } ]
        },
        { "status": 400, "description": "Invalid order." }
      ],
      "security": ["bearerAuth"]
    },
    {
      "id": "getOrder",
      "method": "GET",
      "path": "/orders/{orderId}",
      "parameters": [
        { "name": "orderId", "in": "path", "required": true, "schema": { "type": "string" }, "example": "ord_1001" },
        { "name": "expand", "in": "query", "schema": { "type": "string", "enum": ["items"] } }
      ],
      "responses": [
        { "status": "200", "contentType": "application/json", "schema": { "type": "object", "properties": { "id": { "type": "string" } } } }
      ],
      "security": ["bearerAuth"]
    }
  ],
  "dependencyHints": [
    {
      "producer": { "operation": "createOrder", "field": "id" },
      "consumer": { "operation": "getOrder", "location": "path", "field": "orderId" },
      "note": "The id returned by createOrder is the path parameter of getOrder."
    }
  ]
}
```

This example validates against the schema. It yields 2 operations,
declared provenance on every fact, `expand` with unknown requiredness, a `bearerAuth` scheme mapped to HTTP bearer, and one
declared, verified dependency (confirmed). Because it declares response and request schemas, the existing deterministic
rules apply to it unchanged (positive, required-field, type, enum, numeric and string boundary scenarios).

## Versioning

`version` is an integer. Version 1 is this document. A future version is a new number with its own schema; an unsupported
number is rejected (never best-effort parsed), so a file is either valid for the version it names or refused with the
location of the problem.
