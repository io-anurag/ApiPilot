import type { SchemaConstraint } from "./apiModel";
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
}

/** Identifies which deterministic rule produced a scenario (constitution XIII). */
export interface RuleProvenance {
  source: "RULE";
  rule: string;
  description: string;
  duplicateOfRules: string[];
  duplicateOfAICandidates?: string[];
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
}

/** The framework-independent output of the Deterministic Test Designer (FR-017). */
export interface TestModel {
  scenarios: TestScenario[];
}
