import type {
  BodyUnavailableReason,
  DependencyHint,
  FactProvenance,
  ImportAnalysisReport,
  ObservedOperationDetails,
} from "./apiInput";

/** The uploaded document's own `info` object, when it declares a usable title. */
export interface ApiInfo {
  title: string;
  version: string;
}

/** Normalized, framework-independent representation of a parsed API input (OpenAPI, HAR or an ApiPilot API definition). */
export interface ApiModel {
  operations: ApiOperation[];
  securitySchemes: Record<string, SecuritySchemeDefinition>;
  summary: AnalysisSummary;
  /** Absent when the document declares no non-empty `info.title` — never a fabricated name. */
  info?: ApiInfo;
  /** HAR input only: what was imported, excluded and inferred (specs/056 FR-020, FR-042). Never holds a credential value. */
  importReport?: ImportAnalysisReport;
  /** HAR and definition input only: relationships proposed from observed value reuse or declared hints. */
  dependencyHints?: DependencyHint[];
  /** Definition input only. Informational, shown in review, never an execution target (specs/056 FR-052). */
  declaredBaseUrl?: string;
  /**
   * OpenAPI input only (specs/057 research R2): the document's root `security`, exactly as written. Together
   * with `ApiOperation.securitySource` it lets Security Lab tell "inherited", "explicitly public" and
   * "none declared" apart, which `ApiOperation.security` alone cannot.
   */
  rootSecurity?: SecurityRequirement[];
  /** OpenAPI input only: whether the root declared `security` at all (`[]` counts as declared). */
  rootSecurityDeclared?: boolean;
}

export interface ApiOperation {
  path: string;
  method: string;
  operationId: string | undefined;
  /** Origin of the operation as a whole. Absent means documented (OpenAPI), so OpenAPI models are unchanged. */
  provenance?: FactProvenance;
  /** HAR input only: what the capture showed for this operation. */
  observed?: ObservedOperationDetails;
  /** Definition input only: the operation's declared description. */
  description?: string;
  parameters: Parameter[];
  requestBody: RequestBody | undefined;
  responses: Response[];
  security: SecurityRequirement[];
  /**
   * OpenAPI input only (specs/057 research R2): how `security` was determined. `operation` is the operation's own
   * non-empty requirement, `explicit-public` its own `security: []`, `root` an inherited root requirement and
   * `none-declared` neither. Unset for HAR and definition input, where it is not measurable.
   */
  securitySource?: "operation" | "root" | "explicit-public" | "none-declared";
  /** OpenAPI input only: the operation's `deprecated` flag, when the specification sets it. */
  deprecated?: boolean;
  tags: string[];
}

export interface Parameter {
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: SchemaConstraint;
  /** The specification's own declared `style`, verbatim, when present. Absent — never a
   *  fabricated default — when the specification omits it; the OpenAPI 3.x per-location default
   *  is resolved at serialization time (specs/022-openapi-parameter-serialization). */
  style?: string;
  /** The specification's own declared `explode`, verbatim, when present. Same absent-not-defaulted
   *  rule as `style`. */
  explode?: boolean;
  /** True when the specification declares this parameter via `content` (a media-type-encoded
   *  value) instead of `schema`+`style`; `style`/`explode` are meaningless when this is true.
   *  Absent is equivalent to `false` — there is no second meaning omission could carry. */
  contentEncoded?: boolean;
  /** Origin of this parameter (a path parameter from inference is "inferred"). Absent means documented. */
  provenance?: FactProvenance;
  /** True when `required` is `false` only for compatibility and is not a fact (specs/056 FR-017). Absent means the value is known. */
  requiredUnknown?: true;
  /** Definition input only: the example the definition declared for this parameter, credential values already replaced. */
  example?: unknown;
}

export interface RequestBody {
  required: boolean;
  contentTypes: Record<string, SchemaConstraint>;
  /** Origin of this body. Absent means documented. */
  provenance?: FactProvenance;
  /** Same meaning as `Parameter.requiredUnknown`. */
  requiredUnknown?: true;
  /** Declared or observed request examples keyed by name (credential values already replaced). */
  examples?: Record<string, unknown>;
}

export interface Response {
  statusCode: string;
  description: string;
  contentTypes: Record<string, SchemaConstraint>;
  examples: Record<string, unknown>;
  /** Origin of this status: observed (with count) or declared. Absent means documented. */
  provenance?: FactProvenance;
  /** Why `contentTypes` is empty although a body was sent. */
  bodyUnavailable?: BodyUnavailableReason;
}

/** Recursive schema-level validation rules, extracted exactly as declared (no invented values). */
export interface SchemaConstraint {
  type?: string;
  required: string[];
  properties: Record<string, SchemaConstraint>;
  items?: SchemaConstraint;
  enum?: unknown[];
  format?: string;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  /** OpenAPI input only, and only when the specification sets it (specs/057 R2). Never defaulted. */
  readOnly?: boolean;
  writeOnly?: boolean;
}

/** One requirement set (AND); ApiOperation.security is a list of these (OR). */
export interface SecurityRequirement {
  schemes: { name: string; scopes: string[] }[];
}

export interface SecuritySchemeDefinition {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
  /** Only when the specification declares it (specs/057 R2), for example `JWT` on an HTTP bearer scheme. */
  bearerFormat?: string;
  /** Only for `type: "openIdConnect"`, verbatim from the specification. Never fetched. */
  openIdConnectUrl?: string;
  /** Present only for `type: "oauth2"` when the specification declares a `clientCredentials`
   *  flow; absent for every other scheme and for an oauth2 scheme with no such flow. Read
   *  verbatim from the specification — never inferred. */
  flows?: {
    clientCredentials?: {
      tokenUrl: string;
      /** Scope identifiers, in declaration order — never the scopes object's description text. */
      scopes: string[];
    };
  };
}

export interface AnalysisSummary {
  operationCount: number;
  schemaCount: number;
  securitySchemeCount: number;
  issues: AnalysisIssue[];
}

export interface AnalysisIssue {
  kind:
    | "unresolved-ref"
    | "circular-ref"
    | "unsupported-construct"
    | "duplicate-operation"
    | "composed-schema"
    | "ambiguous-path"
    | "conflicting-types"
    | "unsupported-content"
    | "incomplete-observation"
    | "credential-detected";
  location: string;
  message: string;
}
