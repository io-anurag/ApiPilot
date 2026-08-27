import type { ApiOperation, GeneratedRequest, TestScenario } from "@apipilot/shared-domain";
import { selectNegativeAssertions, type AssertionResult } from "../assertions";
import {
  buildConformantRequest,
  cloneRequest,
  deleteAtPath,
  primaryRequestBodySchema,
  setAtPath,
  walkFields,
} from "../requestHelpers";
import { buildScenario } from "../scenario";

/** Empty-value equivalents by declared type; `undefined` means no empty-value scenario applies (FR-002). */
function emptyValueFor(type: string | undefined): unknown {
  if (type === "string") return "";
  if (type === "array") return [];
  if (type === "object") return {};
  return undefined;
}

type Bucket = "queryParameters" | "headers";

function bodyRequiredFieldScenarios(
  operation: ApiOperation,
  base: GeneratedRequest,
  negative: () => AssertionResult,
): TestScenario[] {
  const bodySchema = primaryRequestBodySchema(operation);
  if (!bodySchema) return [];

  const scenarios: TestScenario[] = [];
  for (const field of walkFields(bodySchema)) {
    if (!field.required) continue;

    const missingRequest: GeneratedRequest = cloneRequest(base);
    missingRequest.body = deleteAtPath(missingRequest.body, field.path);
    scenarios.push(
      buildScenario({
        operation,
        category: "missing-field",
        targetLocation: "body",
        targetField: field.path,
        request: missingRequest,
        assertionResult: negative(),
        rule: "required-field-missing",
        description: `Required body field "${field.path}" omitted from the request.`,
      }),
    );

    const nullRequest: GeneratedRequest = cloneRequest(base);
    nullRequest.body = setAtPath(nullRequest.body, field.path, null);
    scenarios.push(
      buildScenario({
        operation,
        category: "null-value",
        targetLocation: "body",
        targetField: field.path,
        request: nullRequest,
        assertionResult: negative(),
        rule: "required-field-null",
        description: `Required body field "${field.path}" set to null.`,
      }),
    );

    const empty = emptyValueFor(field.schema.type);
    if (empty === undefined) continue;
    const emptyRequest: GeneratedRequest = cloneRequest(base);
    emptyRequest.body = setAtPath(emptyRequest.body, field.path, empty);
    scenarios.push(
      buildScenario({
        operation,
        category: "empty-value",
        targetLocation: "body",
        targetField: field.path,
        request: emptyRequest,
        assertionResult: negative(),
        rule: "required-field-empty",
        description: `Required body field "${field.path}" set to an empty value.`,
      }),
    );
  }
  return scenarios;
}

function parameterRequiredFieldScenarios(
  operation: ApiOperation,
  base: GeneratedRequest,
  negative: () => AssertionResult,
): TestScenario[] {
  const scenarios: TestScenario[] = [];
  for (const parameter of operation.parameters) {
    if (!parameter.required || parameter.location === "path" || parameter.location === "cookie") continue;
    const bucket: Bucket = parameter.location === "query" ? "queryParameters" : "headers";

    const missingRequest: GeneratedRequest = cloneRequest(base);
    delete missingRequest[bucket][parameter.name];
    scenarios.push(
      buildScenario({
        operation,
        category: "missing-field",
        targetLocation: parameter.location,
        targetField: parameter.name,
        request: missingRequest,
        assertionResult: negative(),
        rule: "required-field-missing",
        description: `Required ${parameter.location} parameter "${parameter.name}" omitted from the request.`,
      }),
    );

    const nullRequest: GeneratedRequest = cloneRequest(base);
    nullRequest[bucket][parameter.name] = null;
    scenarios.push(
      buildScenario({
        operation,
        category: "null-value",
        targetLocation: parameter.location,
        targetField: parameter.name,
        request: nullRequest,
        assertionResult: negative(),
        rule: "required-field-null",
        description: `Required ${parameter.location} parameter "${parameter.name}" set to null.`,
      }),
    );

    const empty = emptyValueFor(parameter.schema.type);
    if (empty === undefined) continue;
    const emptyRequest: GeneratedRequest = cloneRequest(base);
    emptyRequest[bucket][parameter.name] = empty;
    scenarios.push(
      buildScenario({
        operation,
        category: "empty-value",
        targetLocation: parameter.location,
        targetField: parameter.name,
        request: emptyRequest,
        assertionResult: negative(),
        rule: "required-field-empty",
        description: `Required ${parameter.location} parameter "${parameter.name}" set to an empty value.`,
      }),
    );
  }
  return scenarios;
}

/**
 * For every required request-body field (at any nesting depth) and required query/header
 * parameter, generates missing-field, null-value, and (for string/array/object types)
 * empty-value scenarios. Required path parameters are excluded (FR-009).
 */
export function requiredFieldScenarios(operation: ApiOperation): TestScenario[] {
  const base = buildConformantRequest(operation);
  const negative = () => selectNegativeAssertions(operation);
  return [
    ...bodyRequiredFieldScenarios(operation, base, negative),
    ...parameterRequiredFieldScenarios(operation, base, negative),
  ];
}

