import type { ApiOperation, GeneratedRequest, TestScenario } from "@apipilot/shared-domain";
import { selectPositiveAssertions } from "../assertions";
import {
  buildConformantRequest,
  cloneRequest,
  primaryRequestBodySchema,
  setAtPath,
  walkFields,
} from "../requestHelpers";
import { buildScenario } from "../scenario";

type RequestBucket = "pathParameters" | "queryParameters" | "headers";

function bucketFor(location: "path" | "query" | "header" | "cookie"): RequestBucket | undefined {
  if (location === "path") return "pathParameters";
  if (location === "query") return "queryParameters";
  if (location === "header") return "headers";
  return undefined; // cookie parameters are out of scope for GeneratedRequest
}

function describe(target: string, value: unknown): string {
  return `Happy-path request using declared enum value ${JSON.stringify(value)} for ${target}.`;
}

/**
 * Generates one additional "positive" scenario per remaining declared enum value, for every
 * field/parameter with a declared enum constraint (FR-001a). The value the FR-001 baseline
 * positive scenario already covers (`schema.enum[0]`, per `conformantValue`) is not repeated.
 */
export function enumPositiveScenarios(operation: ApiOperation): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const base = buildConformantRequest(operation);

  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    for (const field of walkFields(bodySchema)) {
      for (const value of (field.schema.enum ?? []).slice(1)) {
        const request: GeneratedRequest = cloneRequest(base);
        request.body = setAtPath(request.body, field.path, value);
        scenarios.push(
          buildScenario({
            operation,
            category: "positive",
            targetLocation: "body",
            targetField: field.path,
            request,
            assertionResult: selectPositiveAssertions(operation),
            rule: "enum-positive-variant",
            description: describe(`body field "${field.path}"`, value),
          }),
        );
      }
    }
  }

  for (const parameter of operation.parameters) {
    const bucket = bucketFor(parameter.location);
    if (!bucket) continue;
    for (const value of (parameter.schema.enum ?? []).slice(1)) {
      const request = cloneRequest(base);
      request[bucket][parameter.name] = value;
      scenarios.push(
        buildScenario({
          operation,
          category: "positive",
          targetLocation: parameter.location as "path" | "query" | "header",
          targetField: parameter.name,
          request,
          assertionResult: selectPositiveAssertions(operation),
          rule: "enum-positive-variant",
          description: describe(`${parameter.location} parameter "${parameter.name}"`, value),
        }),
      );
    }
  }

  return scenarios;
}
