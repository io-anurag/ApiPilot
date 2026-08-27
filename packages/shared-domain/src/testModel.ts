import type { SchemaConstraint } from "./apiModel";

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
export interface Provenance {
  source: "RULE";
  rule: string;
  description: string;
  duplicateOfRules: string[];
}

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
