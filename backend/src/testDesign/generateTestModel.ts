import type { AnalysisIssue, ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { deduplicate } from "./deduplicate";
import { arrayBoundaryScenarios } from "./rules/arrayBoundaryScenarios";
import { invalidEnumScenarios } from "./rules/invalidEnumScenarios";
import { invalidFormatScenarios } from "./rules/invalidFormatScenarios";
import { invalidTypeScenarios } from "./rules/invalidTypeScenarios";
import { numericBoundaryScenarios } from "./rules/numericBoundaryScenarios";
import { positiveScenario } from "./rules/positiveScenario";
import { requiredFieldScenarios } from "./rules/requiredFieldScenarios";
import { stringBoundaryScenarios } from "./rules/stringBoundaryScenarios";

const RULES: ((operation: ApiOperation) => TestScenario[])[] = [
  positiveScenario,
  requiredFieldScenarios,
  invalidTypeScenarios,
  invalidFormatScenarios,
  invalidEnumScenarios,
  numericBoundaryScenarios,
  stringBoundaryScenarios,
  arrayBoundaryScenarios,
];

/**
 * An operation is skipped entirely (FR-018) when the OpenAPI Specification Engine flagged an
 * unresolved reference or unsupported construct at that operation's location, rather than
 * deterministically fabricating a scenario against an unknown/ambiguous construct.
 */
function hasBlockingIssue(operation: ApiOperation, issues: AnalysisIssue[]): boolean {
  const operationLocationPrefix = `#/paths/${operation.path}/${operation.method.toLowerCase()}`;
  return issues.some(
    (issue) =>
      (issue.kind === "unresolved-ref" || issue.kind === "unsupported-construct") &&
      issue.location.startsWith(operationLocationPrefix),
  );
}

/** Generates the deterministic baseline TestModel for an analyzed specification (ApiModel -> TestModel). */
export function generateTestModel(apiModel: ApiModel): TestModel {
  const scenarios: TestScenario[] = [];
  for (const operation of apiModel.operations) {
    if (hasBlockingIssue(operation, apiModel.summary.issues)) continue;
    for (const rule of RULES) {
      scenarios.push(...rule(operation));
    }
  }
  return { scenarios: deduplicate(scenarios) };
}
