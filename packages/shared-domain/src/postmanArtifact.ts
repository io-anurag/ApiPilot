import type { ApiModel } from "./apiModel";
import type { Provenance, TestModel } from "./testModel";

/**
 * Artifact contracts for the Postman collection export (AP-007).
 *
 * These types describe the *artifact* boundary only. The framework-independent TestModel
 * remains the domain (constitution VIII), so nothing here is imported by test design; a
 * future Playwright or Newman generator would add a sibling contract module rather than
 * extend these types.
 */

/** Engineer-supplied export configuration; every field is optional (FR-012). */
export interface ExportOptions {
  baseUrl?: string;
  variableValues?: Record<string, string>;
  collectionName?: string;
}

/** One named placeholder the collection references in place of a literal value. */
export interface ArtifactVariable {
  name: string;
  purpose: string;
  secret: boolean;
  value: string;
}

/** Postman Collection Format v2.1.0 schema identifier emitted in `info.schema`. */
export const POSTMAN_COLLECTION_SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

export interface PostmanInfo {
  name: string;
  _postman_id: string;
  schema: typeof POSTMAN_COLLECTION_SCHEMA;
}

export interface PostmanAuthAttribute {
  key: string;
  value: string;
  type: "string";
}

/** Only the auth types AP-007 can configure from a declared security scheme (FR-009). */
export type PostmanAuth =
  | { type: "bearer"; bearer: PostmanAuthAttribute[] }
  | { type: "basic"; basic: PostmanAuthAttribute[] }
  | { type: "apikey"; apikey: PostmanAuthAttribute[] };

export interface PostmanQueryParameter {
  key: string;
  value: string;
}

export interface PostmanPathVariable {
  key: string;
  value: string;
}

export interface PostmanHeader {
  key: string;
  value: string;
}

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query: PostmanQueryParameter[];
  variable: PostmanPathVariable[];
}

export interface PostmanBody {
  mode: "raw";
  raw: string;
  options: { raw: { language: string } };
}

export interface PostmanRequest {
  method: string;
  url: PostmanUrl;
  header: PostmanHeader[];
  body?: PostmanBody;
  auth?: PostmanAuth;
}

export interface PostmanEvent {
  listen: "test";
  script: { type: "text/javascript"; exec: string[] };
}

/** One runnable request, derived from exactly one approved scenario. */
export interface PostmanRequestItem {
  id: string;
  name: string;
  request: PostmanRequest;
  event?: PostmanEvent[];
}

export interface PostmanFolder {
  name: string;
  item: PostmanRequestItem[];
}

export interface PostmanCollectionVariable {
  key: string;
  value: string;
}

/** The subset of the collection format ApiPilot emits; nothing outside it is generated. */
export interface PostmanCollection {
  info: PostmanInfo;
  auth?: PostmanAuth;
  variable: PostmanCollectionVariable[];
  item: PostmanFolder[];
}

export interface PostmanEnvironmentValue {
  key: string;
  value: string;
  type: "secret" | "default";
  enabled: boolean;
}

/** The companion artifact carrying every declared variable; the only place values appear. */
export interface PostmanEnvironment {
  name: string;
  _postman_variable_scope: "environment";
  values: PostmanEnvironmentValue[];
}

/** Categories of approved test intent the export could not fully express (FR-017). */
export type GenerationLimitationKind =
  | "no-expected-outcome"
  | "undocumented-status-code"
  | "unsupported-auth-scheme"
  | "unsupported-content-type"
  | "unresolved-path-parameter"
  | "specification-analysis-issue"
  | "alternative-auth-requirement-selected";

/**
 * A recorded gap. A limitation never blocks the export; a validation problem always does.
 * `message` names what could not be expressed and never carries a payload or a credential.
 */
export interface GenerationLimitation {
  kind: GenerationLimitationKind;
  scenarioId?: string;
  location: string;
  message: string;
}

/** Pre-delivery check of the emitted collection; `valid: false` withholds the artifacts (FR-015). */
export interface ValidationReport {
  valid: boolean;
  problems: string[];
}

/**
 * Counts of approved scenarios by origin. Only `RULE` and `AI` are countable here: the
 * approved TestModel carries `Provenance.source`, while a scenario's user-modified flag
 * lives on AP-006's ReviewScenario, which this boundary never receives.
 */
export type ProvenanceCounts = Record<Provenance["source"], number>;

export interface ExportSummary {
  requestCount: number;
  folderCount: number;
  byProvenance: ProvenanceCounts;
}

/** The human-readable accompanying document (`README.md`) content. */
export type ArtifactDocument = string;

/** The single value the generator returns and the endpoint serializes. */
export interface ExportResult {
  collection: PostmanCollection;
  environment: PostmanEnvironment;
  readme: ArtifactDocument;
  validation: ValidationReport;
  limitations: GenerationLimitation[];
  summary: ExportSummary;
}

/** Refusals, not results: each produces an error response rather than an ExportResult. */
export type ExportFailureCode =
  | "empty_approved_test_model"
  | "unknown_operation"
  | "unknown_variable"
  | "workflow_intent_unsupported"
  | "collection_validation_failed";

export interface ExportFailure {
  code: ExportFailureCode;
  message: string;
  problems?: string[];
}

export type ExportOutcome =
  | { ok: true; result: ExportResult }
  | { ok: false; failure: ExportFailure };

/** Full request body accepted by `POST /api/test-models/postman-collection`. */
export interface PostmanCollectionExportRequest {
  apiModel: ApiModel;
  testModel: TestModel;
  options?: ExportOptions;
}
