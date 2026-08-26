# Phase 1 Data Model: OpenAPI Specification Engine

All types below are added to `packages/shared-domain` (framework-independent, consumed by
both `backend/` and `frontend/`), consistent with constitution X (Domain Model First) and
VIII (Framework-Independent Test Model — this feature's output, `ApiModel`, is a precursor
to the `TestModel` introduced in a later feature).

## ApiModel

The normalized, top-level representation of one fully processed specification.

| Field | Type | Notes |
|-------|------|-------|
| `operations` | `ApiOperation[]` | Every discovered path + HTTP method combination (FR-007) |
| `securitySchemes` | `Record<string, SecuritySchemeDefinition>` | Named security scheme definitions declared by the spec |
| `summary` | `AnalysisSummary` | Aggregate counts and flagged ambiguities (FR-012) |

## ApiOperation

A single discovered operation.

| Field | Type | Notes |
|-------|------|-------|
| `path` | `string` | e.g. `/pets/{petId}` |
| `method` | `string` | HTTP method, uppercase (e.g. `GET`) |
| `operationId` | `string \| undefined` | As declared, if present |
| `parameters` | `Parameter[]` | Path, query, header, cookie parameters (FR-008) |
| `requestBody` | `RequestBody \| undefined` | Present only if the operation declares one |
| `responses` | `Response[]` | One entry per documented status code (FR-008) |
| `security` | `SecurityRequirement[]` | OR-of-ANDs, mirroring raw OpenAPI structure (research.md) |
| `tags` | `string[]` | As declared, if present |

## Parameter

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | |
| `location` | `"path" \| "query" \| "header" \| "cookie"` | |
| `required` | `boolean` | |
| `schema` | `SchemaConstraint` | Extracted constraints for this parameter's value |

## RequestBody

| Field | Type | Notes |
|-------|------|-------|
| `required` | `boolean` | |
| `contentTypes` | `Record<string, SchemaConstraint>` | Keyed by media type (e.g. `application/json`) |

## Response

| Field | Type | Notes |
|-------|------|-------|
| `statusCode` | `string` | e.g. `"200"`, `"404"`, or `"default"` |
| `description` | `string` | |
| `contentTypes` | `Record<string, SchemaConstraint>` | Keyed by media type, empty if no body documented |
| `examples` | `Record<string, unknown>` | Raw documented examples, if present (FR-010) |

## SchemaConstraint

Extracted, schema-level validation rules for a single field or value (FR-009). Recursive to
represent nested objects/arrays exactly as declared.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `string \| undefined` | e.g. `"string"`, `"integer"`, `"object"`, `"array"` |
| `required` | `string[]` | Required property names, for object schemas |
| `properties` | `Record<string, SchemaConstraint>` | For object schemas |
| `items` | `SchemaConstraint \| undefined` | For array schemas |
| `enum` | `unknown[] \| undefined` | |
| `format` | `string \| undefined` | e.g. `"date-time"`, `"uuid"` |
| `minimum` / `maximum` | `number \| undefined` | |
| `pattern` | `string \| undefined` | |

## SecurityRequirement

| Field | Type | Notes |
|-------|------|-------|
| `schemes` | `{ name: string; scopes: string[] }[]` | All entries required together (AND); `ApiOperation.security` is a list of these, any one of which satisfies the requirement (OR) |

## SecuritySchemeDefinition

| Field | Type | Notes |
|-------|------|-------|
| `type` | `string` | e.g. `"apiKey"`, `"http"`, `"oauth2"`, `"openIdConnect"` |
| `scheme` | `string \| undefined` | e.g. `"bearer"`, for `type: "http"` |
| `in` | `string \| undefined` | e.g. `"header"`, for `type: "apiKey"` |
| `name` | `string \| undefined` | Header/query/cookie name, for `type: "apiKey"` |

## AnalysisSummary

| Field | Type | Notes |
|-------|------|-------|
| `operationCount` | `number` | |
| `schemaCount` | `number` | |
| `securitySchemeCount` | `number` | |
| `issues` | `AnalysisIssue[]` | Every unresolved ref, circular ref, unsupported construct, or duplicate found (FR-006, FR-013) |

## AnalysisIssue

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"unresolved-ref" \| "circular-ref" \| "unsupported-construct" \| "duplicate-operation"` | |
| `location` | `string` | JSON-pointer-style location within the document |
| `message` | `string` | Human-readable description |

## Validation Rules

- Every `ApiOperation` MUST have a non-empty `path` and a valid HTTP `method`.
- `SchemaConstraint.required` entries MUST correspond to keys present in `properties`.
- `AnalysisSummary.issues` MUST be empty only if no ambiguity was detected; its presence
  does not by itself mean the upload was rejected (only version/YAML/size failures reject
  the upload outright — see spec.md FR-004 vs. FR-013).
- `SecurityRequirement` lists MUST NOT be flattened or simplified — the OR-of-ANDs
  structure must be preserved exactly as declared (research.md).
