/**
 * The validated shape of an ApiPilot API definition, version 1 (specs/056 contracts/
 * api-definition-format-v1.md). These types describe a document that has already passed
 * `validateDefinition`; nothing else produces them.
 */

export type DefinitionMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
export type DefinitionParameterLocation = "path" | "query" | "header" | "cookie";
export type DefinitionAuthType = "http-bearer" | "http-basic" | "api-key" | "oauth2-client-credentials";

/** The closed schema vocabulary (the keys ApiPilot already extracts from OpenAPI). */
export interface DefinitionSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  required?: string[];
  properties?: Record<string, DefinitionSchema>;
  items?: DefinitionSchema;
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

export interface DefinitionExample {
  name?: string;
  value: unknown;
}

export interface DefinitionParameter {
  name: string;
  in: DefinitionParameterLocation;
  required?: boolean;
  description?: string;
  schema?: DefinitionSchema;
  example?: unknown;
}

export interface DefinitionRequestBody {
  contentType: string;
  required?: boolean;
  schema?: DefinitionSchema;
  examples?: DefinitionExample[];
}

export interface DefinitionResponse {
  status: number | string;
  description?: string;
  contentType?: string;
  schema?: DefinitionSchema;
  examples?: DefinitionExample[];
}

export interface DefinitionOperation {
  id?: string;
  method: DefinitionMethod;
  path: string;
  description?: string;
  tags?: string[];
  parameters?: DefinitionParameter[];
  requestBody?: DefinitionRequestBody;
  responses?: DefinitionResponse[];
  security?: string[];
}

export interface DefinitionAuthScheme {
  name: string;
  type: DefinitionAuthType;
  in?: "header" | "query" | "cookie";
  parameterName?: string;
  tokenUrl?: string;
  scopes?: string[];
}

export interface DefinitionHint {
  producer: { operation: string; field: string };
  consumer: { operation: string; location: "path" | "query" | "header" | "body"; field: string };
  note?: string;
}

export interface ApiDefinitionV1 {
  format: "apipilot.api-definition";
  version: 1;
  info: { title: string; version?: string; description?: string };
  baseUrl?: string;
  authentication?: DefinitionAuthScheme[];
  operations: DefinitionOperation[];
  dependencyHints?: DefinitionHint[];
}
