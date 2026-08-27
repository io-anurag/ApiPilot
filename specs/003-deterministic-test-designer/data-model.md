# Phase 1 Data Model: Deterministic Test Designer

Types below extend `packages/shared-domain` (framework-independent, consumed by both
`backend/` and `frontend/`), consistent with constitution X (Domain Model First) and VIII
(Framework-Independent Test Model).

## Extension: `SchemaConstraint` (existing type, in `apiModel.ts`)

Four new optional fields are added; all existing fields and consumers are unaffected
(additive, backward-compatible change).

| Field | Type | Notes |
|-------|------|-------|
| `minLength` | `number \| undefined` | For `type: "string"` schemas (new) |
| `maxLength` | `number \| undefined` | For `type: "string"` schemas (new) |
| `minItems` | `number \| undefined` | For `type: "array"` schemas (new) |
| `maxItems` | `number \| undefined` | For `type: "array"` schemas (new) |

`backend/src/openapi/buildApiModel.ts`'s `extractSchemaConstraint` is extended to read
these four fields from the raw schema node using the same pattern as the existing
`minimum`/`maximum`/`pattern` extraction (typed, presence-checked, never inferred).

## TestModel

The top-level output of this feature: every generated scenario for one analyzed
specification.

| Field | Type | Notes |
|-------|------|-------|
| `scenarios` | `TestScenario[]` | Deduplicated, per-operation (FR-012) |

## TestScenario

A single deterministic test case.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | `crypto.randomUUID()`-generated; not used for equivalence/dedup |
| `operationPath` | `string` | Matches the source `ApiOperation.path` |
| `operationMethod` | `string` | Matches the source `ApiOperation.method` |
| `category` | `ScenarioCategory` | Broad classification |
| `targetLocation` | `"path" \| "query" \| "header" \| "body" \| undefined` | Where the targeted field/parameter lives; `undefined` for the positive scenario |
| `targetField` | `string \| undefined` | Dotted path for the targeted field (e.g., `"address.zipCode"`); parameter name for parameters; `undefined` for the positive scenario |
| `request` | `GeneratedRequest` | The concrete request this scenario exercises |
| `assertions` | `Assertion[]` | Deterministic expected-response checks (FR-010, FR-011); MAY be empty when no documented basis exists (research.md) |
| `provenance` | `Provenance` | Traceability back to the generating rule (FR-013) |

## ScenarioCategory

```text
"positive"
"missing-field"
"null-value"
"empty-value"
"invalid-type"
"invalid-format"
"invalid-enum"
"numeric-boundary"
"string-boundary"
"array-boundary"
```

## GeneratedRequest

| Field | Type | Notes |
|-------|------|-------|
| `pathParameters` | `Record<string, unknown>` | Keyed by parameter name |
| `queryParameters` | `Record<string, unknown>` | Keyed by parameter name |
| `headers` | `Record<string, unknown>` | Keyed by header name |
| `body` | `unknown \| undefined` | Present only if the operation declares a request body |

## Assertion

| Field | Type | Notes |
|-------|------|-------|
| `type` | `"status-code" \| "schema-conformance"` | |
| `expectedStatusCode` | `string \| undefined` | Present for `"status-code"` assertions; always a status code documented in the source `ApiModel` (FR-010, SC-006) |
| `expectedSchema` | `SchemaConstraint \| undefined` | Present for `"schema-conformance"` assertions (FR-011), copied from the matching documented `Response.contentTypes` entry |

## Provenance

| Field | Type | Notes |
|-------|------|-------|
| `source` | `"RULE"` | Fixed for this feature — distinguishes from future `"AI"`/`"USER"` provenance (constitution XIII) |
| `rule` | `string` | Specific rule identifier, e.g. `"required-field-missing"`, `"numeric-boundary-above-maximum"`, `"invalid-format"` (FR-013) |
| `description` | `string` | Human-readable explanation; also used to record assertion gaps (research.md) when no documented error response exists |
| `duplicateOfRules` | `string[]` | Other rule identifiers that would have produced an equivalent scenario, merged in during deduplication (FR-012); empty when no merge occurred |

## Validation Rules

- Every `TestScenario.operationPath` + `operationMethod` MUST correspond to an operation
  present in the source `ApiModel` (SC-006).
- Every `Assertion.expectedStatusCode` MUST correspond to a status code documented on that
  operation's `responses` in the source `ApiModel` (FR-010, SC-006); assertions are never
  fabricated — an empty `assertions` array is valid and expected when no documented basis
  exists (research.md).
- Every positive scenario whose operation documents a response schema for its expected
  status code MUST include a `"schema-conformance"` assertion copied from that documented
  schema (FR-011).
- `TestScenario.category` MUST be consistent with `Provenance.rule` (e.g., a `"positive"`
  category never pairs with rule `"invalid-enum"`).
- `TestModel.scenarios` MUST NOT contain two scenarios with the same
  `(operationPath, operationMethod, request, assertions)` combination (FR-012, SC-004) —
  duplicates are merged into a single scenario with an extended `Provenance.duplicateOfRules`.
- A `"missing-field"`, `"null-value"`, or `"empty-value"` scenario MUST NOT target a
  `targetLocation: "path"` field (FR-009 / research.md).
- `"numeric-boundary"`/`"string-boundary"`/`"array-boundary"` scenarios MUST NOT be
  generated for a field/parameter lacking the corresponding declared constraint (FR-015).
