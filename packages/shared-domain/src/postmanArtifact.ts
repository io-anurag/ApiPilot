import type { ApiModel } from "./apiModel";
import type { ApiDependencyGraph, DependencyCycleFinding, IntegrationWorkflow } from "./apiDependency";
import type { Provenance, TestModel } from "./testModel";
import type { WorkflowReviewDecision } from "./testGenerationWorkflow";

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
  /**
   * Reverts this export to pre-019 behavior: no automatic chain is applied regardless of
   * `WorkflowExportContext.automaticChaining`, and every otherwise-eligible path parameter is
   * reported as an `unresolved-path-parameter` limitation exactly as before 019 existed. Default
   * `false`/absent (specs/019-auto-workflow-chaining FR-002, FR-011). Applies to the whole export;
   * there is no per-relationship opt-out (019 Clarifications, 2026-09-13).
   */
  disableAutomaticChaining?: boolean;
}

/** Distinguishes an automatically applied chain (019) from a manually approved workflow (016). */
export type ChainOrigin = "approved-workflow" | "automatic-chain";

/** One named placeholder the collection references in place of a literal value. */
export interface ArtifactVariable {
  name: string;
  purpose: string;
  secret: boolean;
  value: string;
  provenance?: {
    /** For an automatic chain, the synthetic chain id (`auto_...`), not an `IntegrationWorkflow.id`. */
    workflowId: string;
    relationshipId?: string;
    /**
     * Defaults to `"approved-workflow"` when absent, preserving the meaning every provenance
     * entry produced before specs/019-auto-workflow-chaining already had.
     */
    origin?: ChainOrigin;
  };
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

/**
 * One runnable request, derived from exactly one approved scenario. `provenance.scenarioId` is
 * always present, tying the item back to the `TestScenario` it came from — the
 * workflow-specific fields are present only when the item is one step of an approved workflow
 * (AP-016); a standalone request carries `scenarioId` alone. AP-017's execution orchestrator
 * relies on this to correlate one executed item back to its originating scenario
 * (specs/018-test-execution-results).
 */
export interface PostmanRequestItem {
  id: string;
  name: string;
  request: PostmanRequest;
  event?: PostmanEvent[];
  provenance?: {
    scenarioId: string;
    workflowId?: string;
    stepPosition?: number;
    relationshipIds?: string[];
  };
}

export interface PostmanFolder {
  name: string;
  item: PostmanRequestItem[];
}

export interface PostmanCollectionVariable {
  key: string;
  value: string;
}

/**
 * The subset of the collection format ApiPilot emits; nothing outside it is generated.
 *
 * Deliberately carries no collection-level `variable` declaration: the environment artifact
 * (`PostmanEnvironment`) is the single place every variable name and value is declared, so an
 * engineer never has to reconcile two lists of the same names.
 */
export interface PostmanCollection {
  info: PostmanInfo;
  auth?: PostmanAuth;
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
  | "alternative-auth-requirement-selected"
  | "workflow-missing-scenario"
  | "workflow-unsupported-sequence"
  | "workflow-unresolved-handoff"
  | "workflow-unsupported-extraction-path"
  | "workflow-unsupported-request-representation"
  | "unresolved-credential-producer"
  | "unresolved-parameter-style";

/**
 * One distinct security scheme's identified credential-obtaining operation
 * (specs/021-multi-credential-token-provisioning FR-006). Identification only — this feature
 * does not wire the producer's response value into the variable; that is a later extension to
 * automatic chaining (FR-009), for which this is the target contract.
 */
export interface CredentialProducerCandidate {
  schemeKey: string;
  variableName: string;
  producerOperationPath: string;
  producerOperationMethod: string;
}

/**
 * A recorded gap. A limitation never blocks the export; a validation problem always does.
 * `message` names what could not be expressed and never carries a payload or a credential.
 */
export interface GenerationLimitation {
  kind: GenerationLimitationKind;
  scenarioId?: string;
  workflowId?: string;
  stepPosition?: number;
  relationshipId?: string;
  location: string;
  message: string;
}

/**
 * One distinct known-limitation case: the same gap at the same location, worded identically. Its
 * message never varies by scenario (e.g. "no value for the \"id\" path parameter" reads the same
 * whichever approved scenario hit it), so the same gap recurs once per approved scenario that
 * exercises that location, and again per rendered occurrence of each of those scenarios (once per
 * workflow step that reuses it, for instance). Without aggregation, the accompanying document and
 * review UI repeat an identical line once per scenario and again per occurrence. `scenarioIds`
 * and `occurrences` preserve both counts in one line instead.
 */
export interface AggregatedLimitation {
  kind: GenerationLimitationKind;
  location: string;
  message: string;
  /** Distinct approved scenarios this case was recorded against, in first-seen order. */
  scenarioIds: string[];
  /** Total recorded limitations collapsed into this entry — the number of requests it affects. */
  occurrences: number;
}

/**
 * Collapses limitations that share a kind, location, and message into one entry, preserving the
 * order each distinct case first appeared and every scenario it was recorded against. Every case
 * is still reported (FR-017): only the repetition of an identically worded line — across
 * occurrences of one scenario, and across the several approved scenarios that hit the same gap at
 * the same location — is removed.
 */
export function aggregateLimitations(
  limitations: GenerationLimitation[],
): AggregatedLimitation[] {
  const byKey = new Map<string, AggregatedLimitation>();
  for (const limitation of limitations) {
    const key = JSON.stringify([limitation.kind, limitation.location, limitation.message]);
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (limitation.scenarioId && !existing.scenarioIds.includes(limitation.scenarioId)) {
        existing.scenarioIds.push(limitation.scenarioId);
      }
      continue;
    }
    byKey.set(key, {
      kind: limitation.kind,
      location: limitation.location,
      message: limitation.message,
      scenarioIds: limitation.scenarioId ? [limitation.scenarioId] : [],
      occurrences: 1,
    });
  }
  return [...byKey.values()];
}

/**
 * Explicit workflow-review input at the artifact boundary. `automaticChaining` is additive
 * (specs/019-auto-workflow-chaining): absent means no automatic chaining is attempted, regardless
 * of `ExportOptions.disableAutomaticChaining` — behavior is identical to every export generated
 * before 019 existed.
 */
export interface WorkflowExportContext {
  workflows: IntegrationWorkflow[];
  approvedWorkflowIds: string[];
  automaticChaining?: {
    graph: ApiDependencyGraph;
    cycles: DependencyCycleFinding[];
    /** Keyed by `IntegrationWorkflow.id`, mirroring `TestGenerationWorkflow.workflowDecisions`. */
    workflowDecisions: Record<string, WorkflowReviewDecision>;
  };
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
  workflowCount: number;
  workflowRequestCount: number;
  standaloneRequestCount: number;
  workflowVariableCount: number;
  unsupportedWorkflowCount: number;
  omittedWorkflowCount: number;
  /**
   * Count of consumers resolved via an automatic chain (specs/019-auto-workflow-chaining): path
   * parameters, plus, per specs/023-auto-auth-credential-chaining, auth-credential consumers —
   * one shared counter, since both are reported through the same `AutomaticChain` mechanism.
   */
  automaticChainCount: number;
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
  /**
   * One entry per distinct scheme whose credential-producer operation was identified (FR-006).
   * Always present; empty when no distinct scheme had a discoverable producer.
   */
  credentialProducers: CredentialProducerCandidate[];
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
  { ok: true; result: ExportResult } | { ok: false; failure: ExportFailure };

/** Full request body accepted by `POST /api/test-models/postman-collection`. */
export interface PostmanCollectionExportRequest {
  apiModel: ApiModel;
  testModel: TestModel;
  workflowContext?: WorkflowExportContext;
  options?: ExportOptions;
}
