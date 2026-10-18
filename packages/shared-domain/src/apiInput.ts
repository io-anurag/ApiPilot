/**
 * Contracts for the format-independent input layer (AP-056, specs/056-har-json-input-support).
 *
 * Every field added to an existing interface elsewhere in this package is optional. For OpenAPI
 * input none of them is set, so an OpenAPI YAML model and its JSON twin are deeply equal. An
 * absent `provenance` therefore means "documented".
 */

/** What the upload was recognized as. Decided from content, never from the extension (FR-001). */
export type InputFormat =
  | "openapi-yaml"
  | "openapi-json"
  | "har"
  | "api-definition"
  /** Routed away to Import & Run Collection; never reaches the workflow. */
  | "postman-collection";

/** Carried on the upload response and on `TestGenerationWorkflow`, never inside `ApiModel`. */
export interface ApiInputDescriptor {
  format: Exclude<InputFormat, "postman-collection">;
  /** Human label: "OpenAPI (YAML)", "OpenAPI (JSON)", "HAR capture", "ApiPilot API definition". */
  label: string;
  filename: string;
}

/** Human labels for each workflow input format (single definition for backend and frontend). */
export const INPUT_FORMAT_LABELS: Readonly<Record<ApiInputDescriptor["format"], string>> = {
  "openapi-yaml": "OpenAPI (YAML)",
  "openapi-json": "OpenAPI (JSON)",
  har: "HAR capture",
  "api-definition": "ApiPilot API definition",
};

/** Where a model fact comes from (constitution 3.2.0). */
export type FactOrigin = "documented" | "declared" | "observed" | "inferred";

export type FactConfidence = "low" | "medium" | "high";

/** Minimum consistent observations before an inferred constraint can justify a negative scenario (FR-036). */
export const OBSERVED_EVIDENCE_MIN_OBSERVATIONS = 3;

export interface FactProvenance {
  origin: FactOrigin;
  /** Only for observed and inferred facts (FR-028). */
  observationCount?: number;
  /** Pure function of count and consistency: high at 3 or more consistent, medium at 2, low at 1 or any conflict. */
  confidence?: FactConfidence;
}

/** Credential seen in the input; never carries a value (FR-047). */
export type CredentialKind = "token" | "apiKey" | "password" | "cookie" | "session";

export interface CredentialObservation {
  location: "header" | "query" | "cookie" | "body" | "url-userinfo" | "path";
  /** Header, parameter, cookie or field name. Never a value. */
  name: string;
  kind: CredentialKind;
  /** How many observations carried it. */
  observations: number;
}

/** Per-field presence and type counts for one observed body shape (research R16). */
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
  /** Origin is always "inferred". */
  provenance: FactProvenance;
}

/** Why a body could not be used (research R17). */
export type BodyUnavailableReason =
  | "missing"
  | "empty"
  | "oversized"
  | "binary"
  | "compressed"
  | "undecodable-encoding"
  | "truncated"
  | "not-json"
  | "invalid-json"
  | "too-deep"
  | "multipart-file";

export interface ObservedRequestExample {
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  headers: Record<string, unknown>;
  /**
   * Present only when the body was available; credential values already replaced. A JSON body is the
   * parsed value. A form-encoded or multipart body is a flat object of text-field name to string
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

export interface ObservedOperationDetails {
  /** Stable, deterministic key: first 12 hex characters of sha256(origin|METHOD|path). */
  key: string;
  /** Informational only. Never an execution target (FR-052). */
  origin: string;
  observationCount: number;
  /** Observed status to observation count. Never contains a status that was not observed. */
  statusCounts: Record<string, number>;
  pathParameters: PathParameterDecision[];
  /** Query parameter name to observations carrying it. Denominator is `observationCount`. */
  queryParameterCounts: Record<string, number>;
  headerCounts: Record<string, number>;
  /** At most 5 (research R15); `droppedExampleCount` counts the rest. */
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

/** One excluded group in the report (research R11). */
export type ExclusionReason =
  | "non-http-scheme"
  | "cors-preflight"
  | "streaming"
  | "failed-request"
  | "redirect"
  | "not-modified"
  | "static-asset"
  | "html-document"
  | "analytics-telemetry"
  | "third-party-origin"
  | "duplicate-method-path-other-origin";

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

/** A proposed relationship carried by the model into dependency analysis (research R19, R20). */
export interface DependencyHint {
  origin: "observed" | "declared";
  producer: { operationMethod: string; operationPath: string; field: string };
  consumer: {
    operationMethod: string;
    operationPath: string;
    field: string;
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

/** One operation that produced no scenarios, and why (FR-040). */
export interface GenerationNote {
  operationMethod: string;
  operationPath: string;
  reason: string;
}
