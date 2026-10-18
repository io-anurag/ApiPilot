import type { SchemaConstraint } from "./apiModel";
import type { FactOrigin } from "./apiInput";
import type { AIProviderMode } from "./aiProvider";

/** Classification of a generated scenario's intent, per data-model.md. */
export type ScenarioCategory =
  | "positive"
  | "missing-field"
  | "null-value"
  | "empty-value"
  | "invalid-type"
  | "invalid-format"
  | "invalid-enum"
  | "numeric-boundary"
  | "string-boundary"
  | "array-boundary";

/**
 * The same vocabulary as a runtime value, for the two places that need to enumerate rather than
 * merely type-check it: the AI prompt, which must tell the model which categories exist, and the
 * candidate validator, which rejects anything outside them.
 *
 * It lives here rather than in either consumer because both need it and neither owns it
 * (constitution X — Domain Model First); defining it in the validator and importing it into the
 * prompt builder would also close an import cycle through the response parser.
 */
export const SCENARIO_CATEGORIES: readonly ScenarioCategory[] = [
  "positive",
  "missing-field",
  "null-value",
  "empty-value",
  "invalid-type",
  "invalid-format",
  "invalid-enum",
  "numeric-boundary",
  "string-boundary",
  "array-boundary",
];

/** The concrete request one TestScenario exercises. */
export interface GeneratedRequest {
  pathParameters: Record<string, unknown>;
  queryParameters: Record<string, unknown>;
  headers: Record<string, unknown>;
  body?: unknown;
}

/** A deterministic, expected-response condition attached to a TestScenario. */
export interface Assertion {
  type: "status-code" | "schema-conformance";
  expectedStatusCode?: string;
  expectedSchema?: SchemaConstraint;
  /** Where the asserted fact comes from. Absent means documented. An observed `status-code` assertion never has `expectedSchema`. */
  basis?: "documented" | "declared" | "observed";
}

/**
 * The evidence a scenario built from observed or declared input rests on (specs/056 FR-035, FR-036).
 * Absent for scenarios generated from an OpenAPI document.
 */
export interface ScenarioEvidence {
  origin: FactOrigin;
  observationCount?: number;
  derivation: "observed-example" | "inference-derived" | "declared-example";
  summary: string;
}

/** Identifies which deterministic rule produced a scenario (constitution XIII). */
export interface RuleProvenance {
  source: "RULE";
  rule: string;
  description: string;
  duplicateOfRules: string[];
  duplicateOfAICandidates?: string[];
}

/**
 * An assertion an AI candidate proposed that was removed because the specification does not
 * document its status code (specs/005 amendment 2026-10-15). Kept so a reviewer can see what the
 * model proposed; it is never an executable contract fact.
 */
export interface AIStrippedAssertion {
  assertion: Assertion;
  reason: "undocumented-status-code";
}

/** Explains the model and reasoning behind a validated AI-derived scenario. */
export interface AIProvenance {
  source: "AI";
  aiCandidateId?: string;
  description: string;
  duplicateOfRules: string[];
  duplicateOfAICandidates: string[];
  aiModel: string;
  aiProvider: AIProviderMode;
  aiRationale: string;
  aiConfidence: number;
  aiAssumptions: string[];
  /**
   * The index (within its run's `BatchOutcomeRecord[]`) of the batch that produced this scenario
   * (specs/015-ai-batch-retry FR-010). Present on every AI-derived scenario produced from that
   * feature onward; absent on scenarios produced before it shipped.
   */
  aiBatchIndex?: number;
  /** Present only when at least one proposed assertion was removed as undocumented. */
  aiStrippedAssertions?: AIStrippedAssertion[];
}

export type Provenance = RuleProvenance | AIProvenance;

/** A single deterministic test case tied to one operation. */
export interface TestScenario {
  id: string;
  operationPath: string;
  operationMethod: string;
  category: ScenarioCategory;
  targetLocation?: "path" | "query" | "header" | "body";
  targetField?: string;
  request: GeneratedRequest;
  assertions: Assertion[];
  provenance: Provenance;
  /** Origin, observation count and summary of the evidence behind this scenario. Absent for OpenAPI scenarios. */
  evidence?: ScenarioEvidence;
}

/** The framework-independent output of the Deterministic Test Designer (FR-017). */
export interface TestModel {
  scenarios: TestScenario[];
}
