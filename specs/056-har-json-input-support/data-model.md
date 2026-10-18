# Data Model: HAR and JSON API Input Support

All types live in `packages/shared-domain/` (framework-agnostic, no Express, React or Node dependencies). Every change to
an existing interface is an **optional field**; no existing field changes type or meaning (FR-029). Rationale in
[research.md](research.md) R6.

**Absence rule.** For an existing interface, an absent `provenance` means `documented`. OpenAPI input sets none of the new
fields, so an OpenAPI YAML model and its JSON twin are deeply equal.

## New file: `packages/shared-domain/src/apiInput.ts`

```ts
/** What the upload was recognized as. Decided from content, never the extension (FR-001). */
export type InputFormat =
  | "openapi-yaml"
  | "openapi-json"
  | "har"
  | "api-definition"
  | "postman-collection"; // routed away; never reaches the workflow

/** Carried on the upload response and on TestGenerationWorkflow, never inside ApiModel. */
export interface ApiInputDescriptor {
  format: Exclude<InputFormat, "postman-collection">;
  /** Human label: "OpenAPI (YAML)", "OpenAPI (JSON)", "HAR capture", "ApiPilot API definition". */
  label: string;
  filename: string;
}

/** Where a model fact comes from (Constitution amendment 3.2.0, R1). */
export type FactOrigin = "documented" | "declared" | "observed" | "inferred";

export type FactConfidence = "low" | "medium" | "high";

/** Minimum consistent observations before an inferred constraint can justify a negative scenario (FR-036). */
export const OBSERVED_EVIDENCE_MIN_OBSERVATIONS = 3;

export interface FactProvenance {
  origin: FactOrigin;
  /** Only for observed and inferred facts (FR-028). */
  observationCount?: number;
  /** Pure function of count and consistency: high at >= 3 consistent, medium at 2, low at 1 or any conflict. */
  confidence?: FactConfidence;
}

/** Credential seen in the input; never carries a value (FR-047). */
export type CredentialKind = "token" | "apiKey" | "password" | "cookie" | "session";

export interface CredentialObservation {
  location: "header" | "query" | "cookie" | "body" | "url-userinfo";
  /** Header, parameter, cookie or field name. Never a value. */
  name: string;
  kind: CredentialKind;
  /** How many observations carried it. */
  observations: number;
}

/** Per-field presence and type counts for one observed JSON body shape (R16). */
export interface FieldEvidence {
  /** Observations of this body in which the field was present. */
  presentIn: number;
  /** Count per JSON type seen: "string" | "number" | "integer" | "boolean" | "null" | "object" | "array". */
  types: Record<string, number>;
}

export interface SchemaEvidence {
  /** Observations of this body shape (the denominator for `presentIn`). */
  observations: number;
  /** Keyed by dotted field path; `[]` marks array elements. */
  fields: Record<string, FieldEvidence>;
}

export interface PathParameterDecision {
  name: string;
  /** Zero-based segment position in the normalized path. */
  position: number;
  /** Distinct values seen at this position. */
  distinctValues: number;
  /** Up to 10 observed values, in first-seen order. */
  exampleValues: string[];
  provenance: FactProvenance; // origin "inferred"
}

export interface ObservedRequestExample {
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  headers: Record<string, unknown>;
  /**
   * Present only when the body was available; credential values already replaced. A JSON body is
   * the parsed value. A form-encoded or multipart body is a flat object of text-field name to string
   * value (FR-056); every form value is a string by encoding.
   */
  body?: unknown;
  contentType?: string;
  /** Set when the request carried a body that could not be used; such an example is not replayed as a scenario. */
  bodyUnavailable?: BodyUnavailableReason;
  /** Status the server returned for this request. */
  responseStatus: string;
  /** Observations that collapsed into this example. */
  observations: number;
  /** Zero-based entry position of the first observation. */
  firstEntryIndex: number;
}

/** Why a body could not be used (R17). */
export type BodyUnavailableReason =
  | "missing" | "empty" | "oversized" | "binary" | "compressed" | "undecodable-encoding"
  | "truncated" | "not-json" | "invalid-json" | "too-deep" | "multipart-file";

export interface ObservedOperationDetails {
  /** Stable, deterministic key: first 12 hex characters of sha256(origin|METHOD|path). */
  key: string;
  /** Informational only. Never an execution target (FR-052). */
  origin: string;
  observationCount: number;
  /** Observed status -> observation count. Never contains a status that was not observed. */
  statusCounts: Record<string, number>;
  pathParameters: PathParameterDecision[];
  /** Query parameter name -> observations carrying it. Denominator is `observationCount`. */
  queryParameterCounts: Record<string, number>;
  headerCounts: Record<string, number>;
  /** At most 5 (R15); `droppedExampleCount` counts the rest. */
  requestExamples: ObservedRequestExample[];
  droppedExampleCount: number;
  /** Request body evidence keyed by content type. */
  requestBodyEvidence: Record<string, SchemaEvidence>;
  /** Response body evidence keyed by status, then content type. Never merged across statuses. */
  responseBodyEvidence: Record<string, Record<string, SchemaEvidence>>;
  /** Reasons bodies were unavailable, with counts. */
  unavailableBodies: { direction: "request" | "response"; reason: BodyUnavailableReason; count: number }[];
  credentialsObserved: CredentialObservation[];
}

/** One excluded or malformed group in the report (R11). */
export type ExclusionReason =
  | "non-http-scheme" | "cors-preflight" | "streaming" | "failed-request" | "redirect"
  | "not-modified" | "static-asset" | "html-document" | "analytics-telemetry"
  | "third-party-origin" | "duplicate-method-path-other-origin";

export interface ExclusionGroup {
  reason: ExclusionReason;
  count: number;
  /** First 20 entries, redacted. */
  samples: { entryIndex: number; method: string; host: string; path: string }[];
}

export interface MalformedEntry {
  entryIndex: number;
  /** "invalid-url" | "relative-url" | "missing-url" | "missing-method" | "missing-response-status" | "not-an-object" */
  reason: string;
}

export interface ImportAnalysisReport {
  /** Invariant: imported + excluded + malformed === total (FR-020). */
  counts: { total: number; imported: number; excluded: number; malformed: number; operations: number };
  harVersion?: string;
  creator?: string;
  exclusions: ExclusionGroup[];
  malformedEntries: MalformedEntry[];
  origins: { origin: string; importedEntries: number; operations: number }[];
  normalization: { trailingSlashesFolded: number; duplicateSlashesCollapsed: number; dotSegmentsRemoved: number };
  /** Entries whose URL carried credentials (userinfo), FR-050. The count covers all of them; the list is the first 20, by position and host, never the userinfo. */
  credentialUrlCount: number;
  credentialUrlEntries: { entryIndex: number; host: string }[];
  /** Limits that truncated or skipped something, naming the limit. */
  limitsApplied: { limit: string; effect: string; count: number }[];
}

/** A proposed relationship carried by the model into dependency analysis (R19, R20). */
export interface DependencyHint {
  origin: "observed" | "declared";
  producer: { operationMethod: string; operationPath: string; field: string };
  consumer: {
    operationMethod: string; operationPath: string; field: string;
    location: "path" | "query" | "header" | "body";
  };
  /** Distinct consuming observations (observed hints). */
  matchCount?: number;
  /** Producer observed before consumer. Always true for observed hints. */
  orderObserved?: boolean;
  sampleValue?: string;
  /** True when the value is withheld because the field is credential-like or the value matches a credential or email pattern. */
  valueWithheld?: boolean;
  /** Declared hints: both fields exist in the declared schemas. */
  verified?: boolean;
}

/** One operation (or the whole run) that produced no scenarios, and why (FR-040). */
export interface GenerationNote {
  operationMethod: string;
  operationPath: string;
  reason: string;
}
```

## Additive edits to existing interfaces

### `apiModel.ts`

| Interface | New optional field | Meaning |
| --- | --- | --- |
| `ApiModel` | `importReport?: ImportAnalysisReport` | HAR only. |
| `ApiModel` | `dependencyHints?: DependencyHint[]` | HAR and definition only. |
| `ApiModel` | `declaredBaseUrl?: string` | Definition only. Informational, shown in review, never an execution target (FR-052). |
| `ApiOperation` | `provenance?: FactProvenance` | Origin of the operation as a whole. Absent = documented. |
| `ApiOperation` | `observed?: ObservedOperationDetails` | HAR only. |
| `ApiOperation` | `description?: string` | Definition `description`. OpenAPI summaries are not mapped (unchanged). |
| `Parameter` | `provenance?: FactProvenance` | Per parameter (a path parameter from inference is `inferred`). |
| `Parameter` | `requiredUnknown?: true` | `required` is `false` for compatibility but is not a fact (FR-017). |
| `RequestBody` | `provenance?`, `requiredUnknown?`, `examples?: Record<string, unknown>` | Examples keyed by name. Declared (definition) or observed. |
| `Response` | `provenance?: FactProvenance` | A status in `responses` is observed or declared, with count where observed. |
| `Response` | `bodyUnavailable?: BodyUnavailableReason` | Why `contentTypes` is empty although a body was sent. |
| `AnalysisIssue.kind` | `+ "ambiguous-path" \| "conflicting-types" \| "unsupported-content" \| "incomplete-observation" \| "credential-detected"` | `location` carries an operation key or `entries[n]`. Messages never contain values. |

`SecuritySchemeDefinition` is unchanged. HAR input leaves `securitySchemes` empty and each operation's `security` empty
(no scheme was observed as a scheme); credentials seen are in `credentialsObserved`. Definition input maps its
`authentication` entries onto the existing shapes (`http`/`bearer`, `http`/`basic`, `apiKey`, `oauth2` with
`clientCredentials`).

### `testModel.ts`

| Interface | New optional field | Meaning |
| --- | --- | --- |
| `TestScenario` | `evidence?: ScenarioEvidence` | `{ origin: FactOrigin; observationCount?: number; derivation: "observed-example" \| "inference-derived" \| "declared-example"; summary: string }`. Absent for OpenAPI scenarios. |
| `Assertion` | `basis?: "documented" \| "declared" \| "observed"` | Absent = documented. An observed `status-code` assertion never has `expectedSchema`. |

`ScenarioCategory`, `RuleProvenance` and `AIProvenance` are unchanged. Observed and declared scenarios keep
`provenance.source: "RULE"`; the origin is in `evidence` (R21).

### `postmanArtifact.ts` (the one type widening)

`PostmanBody` is today the single shape `{ mode: "raw"; raw; options }`. FR-056 widens it to a union, because the exporter
must be able to emit form bodies:

```ts
export type PostmanBody = PostmanRawBody | PostmanUrlencodedBody | PostmanFormdataBody;
export interface PostmanRawBody { mode: "raw"; raw: string; options: { raw: { language: string } } }          // today's shape, unchanged
export interface PostmanUrlencodedBody { mode: "urlencoded"; urlencoded: { key: string; value: string }[] }
export interface PostmanFormdataBody { mode: "formdata"; formdata: { key: string; value: string; type: "text" }[] }
```

This is additive at runtime (every existing item still has `mode: "raw"`) but it is a compile-time widening: code that reads
`body.raw` without checking `mode` stops compiling, which is deliberate, since the compiler then lists every consumer
(`postman/validateCollection.ts`, `performance/plan/stepRequest.ts`; see
[contracts/postman-artifact-amendment.md](contracts/postman-artifact-amendment.md)). Items generated for any input that has
no form body are byte-identical to today's.

### `apiDependency.ts`

`DependencySource` gains `"observed"` and `"declared"`. `ApiDependencyRelationship` gains `inputEvidence?: DependencyHint`.
Confidence rules are in [contracts/observed-generation-rules.md](contracts/observed-generation-rules.md).

### `testGenerationWorkflow.ts`

`TestGenerationWorkflow` gains `input?: ApiInputDescriptor` (set at start for every format, including OpenAPI YAML) and
`generationNotes?: GenerationNote[]` (set by the deterministic generation stage, only when non-empty).

## Entity relationships

```text
Upload ──detect──> InputFormat ──adapter──> ApiModel (+ importReport?, dependencyHints?)
                                              └─ ApiOperation (+ provenance, observed?)
                                                   ├─ Parameter / RequestBody / Response (+ provenance)
                                                   └─ ObservedOperationDetails
                                                        ├─ PathParameterDecision[]
                                                        ├─ ObservedRequestExample[] (<= 5)
                                                        ├─ SchemaEvidence (request, per status response)
                                                        └─ CredentialObservation[] (no values)
ApiModel ──generateTestModel──> TestModel (TestScenario.evidence, Assertion.basis) + GenerationNote[]
ApiModel.dependencyHints ──analyzeDependencies──> ApiDependencyRelationship (source observed | declared)
```

## Validation rules and invariants

- `importReport.counts.imported + excluded + malformed === total`. `excluded` equals the sum of `exclusions[].count`;
  `malformed` equals `malformedEntries.length`. Checked in `buildHarModel`; a mismatch throws an internal error.
- Every operation's `observed.statusCounts` keys appear in `responses[].statusCode`, and every `responses[].statusCode` of
  an observed operation appears in `statusCounts` (no unobserved status).
- No field of any HAR-derived structure holds a credential value. `CredentialObservation` has no value field, and the
  placeholder format is `[redacted:<kind>]`.
- `SchemaConstraint.required` of an observed schema contains exactly the paths with `presentIn === observations`.
- A schema has no `enum`, `format`, `minimum`, `maximum`, `pattern`, `minLength`, `maxLength`, `minItems` or `maxItems`
  unless the operation is `declared` or `documented`.
- A form-encoded or multipart request body is modelled as `requestBody.contentTypes["<content type>"]` whose constraint has
  one `properties` entry per observed text field (`type: "string"`) and `required` per the same all-observations rule. Field
  presence is the only inferred structure (spec edge case); no other constraint exists for it.
- A credential-named or credential-valued entry in any structure (JSON field, form field, query value, header, cookie) holds
  `[redacted:<kind>]`. That marker format is the single definition shared by redaction (writer) and the exporter's variable
  substitution (reader); see R18 and R24.
- `confidence`: `high` iff `observationCount >= 3` and consistent; `medium` iff 2; otherwise `low`.
- Operation order: primary origin first, then path ascending (code-point order), then method rank
  `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE`. Issue order: by kind in the declared union order, then location
  ascending. Example order: observations descending, then first entry index ascending. All sorting is stable and
  locale-independent (`Intl` is not used).
- `(method, path)` is unique across `ApiModel.operations` (R13).

## State and lifecycle

No new state machine. `TestGenerationWorkflow` stages are unchanged; `upload` and `analysis` still complete together.
`input` and `generationNotes` are written once each and never mutated. All data is in-memory, session-scoped and cleared
with the workflow, exactly as for OpenAPI. The raw upload is not part of any state.

## Definition-format mapping (summary)

`api-definition` fields map to the existing model as follows; the full field reference is
[contracts/api-definition-format-v1.md](contracts/api-definition-format-v1.md).

| Definition | `ApiModel` |
| --- | --- |
| `info.title`, `info.version` | `info` |
| operation `id` | `operationId` |
| operation `description` | `ApiOperation.description` |
| operation `tags` | `tags` |
| parameter | `Parameter` with `provenance.origin: "declared"`; `required` as declared, else `requiredUnknown: true` (path parameters are always required) |
| `requestBody.examples` | `RequestBody.examples` (redacted) |
| `requestBody.schema` | `RequestBody.contentTypes[contentType]` |
| `responses[]` | `Response` with `provenance.origin: "declared"` |
| `authentication[]` | `securitySchemes` (existing shapes) |
| operation `security` | `ApiOperation.security` |
| `baseUrl` | `ApiModel.declaredBaseUrl`; informational only, shown in the review, never used as an execution target (FR-052). The exporter keeps building URLs from the selected environment |
| `dependencyHints[]` | `ApiModel.dependencyHints` with `origin: "declared"` |
