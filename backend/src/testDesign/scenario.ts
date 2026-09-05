import { randomUUID } from "node:crypto";
import type { ApiOperation, GeneratedRequest, ScenarioCategory, TestScenario } from "@apipilot/shared-domain";
import type { AssertionResult } from "./assertions";

/** Input to `buildScenario`: the target operation/field, the generated request, and the assertions/rule/description that give the resulting TestScenario its provenance. */
export interface BuildScenarioInput {
  operation: ApiOperation;
  category: ScenarioCategory;
  targetLocation?: "path" | "query" | "header" | "body";
  targetField?: string;
  request: GeneratedRequest;
  assertionResult: AssertionResult;
  rule: string;
  description: string;
}

/** Shared TestScenario construction so every rule module attaches provenance consistently (FR-013). */
export function buildScenario(input: BuildScenarioInput): TestScenario {
  const description = input.assertionResult.gapDescription
    ? `${input.description} ${input.assertionResult.gapDescription}`
    : input.description;
  return {
    id: randomUUID(),
    operationPath: input.operation.path,
    operationMethod: input.operation.method,
    category: input.category,
    targetLocation: input.targetLocation,
    targetField: input.targetField,
    request: input.request,
    assertions: input.assertionResult.assertions,
    provenance: {
      source: "RULE",
      rule: input.rule,
      description,
      duplicateOfRules: [],
    },
  };
}
