/** Normalized, framework-independent representation of a parsed OpenAPI specification. */
export interface ApiModel {
  operations: ApiOperation[];
  securitySchemes: Record<string, SecuritySchemeDefinition>;
  summary: AnalysisSummary;
}

export interface ApiOperation {
  path: string;
  method: string;
  operationId: string | undefined;
  parameters: Parameter[];
  requestBody: RequestBody | undefined;
  responses: Response[];
  security: SecurityRequirement[];
  tags: string[];
}

export interface Parameter {
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: SchemaConstraint;
}

export interface RequestBody {
  required: boolean;
  contentTypes: Record<string, SchemaConstraint>;
}

export interface Response {
  statusCode: string;
  description: string;
  contentTypes: Record<string, SchemaConstraint>;
  examples: Record<string, unknown>;
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
}

export interface AnalysisSummary {
  operationCount: number;
  schemaCount: number;
  securitySchemeCount: number;
  issues: AnalysisIssue[];
}

export interface AnalysisIssue {
  kind: "unresolved-ref" | "circular-ref" | "unsupported-construct" | "duplicate-operation";
  location: string;
  message: string;
}
