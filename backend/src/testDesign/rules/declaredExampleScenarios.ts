import type { ApiOperation, Assertion, GeneratedRequest, Parameter, SchemaConstraint, TestScenario } from "@apipilot/shared-domain";
import { selectPositiveAssertions } from "../assertions";
import { primaryRequestBodyContentType } from "../requestHelpers";
import { buildScenario } from "../scenario";
import { conformantValue } from "../valueGenerators";

/**
 * Generation for an operation declared in an API definition (specs/056 FR-037, contracts/
 * observed-generation-rules.md). A declared operation runs the existing deterministic rules unchanged
 * (they read declared schemas exactly as they read OpenAPI ones) plus `declaredExampleScenarios`,
 * which covers the one case those rules cannot: a request body the definition describes only by an
 * example. `schemaGroundedView` keeps the existing rules from inventing a value for anything the
 * definition left unstated.
 */

/** True when a constraint states nothing at all, which is what an omitted schema becomes in the model. */
export function isEmptyConstraint(constraint: SchemaConstraint): boolean {
  return (
    constraint.type === undefined &&
    constraint.required.length === 0 &&
    Object.keys(constraint.properties).length === 0 &&
    constraint.items === undefined &&
    constraint.enum === undefined &&
    constraint.format === undefined &&
    constraint.minimum === undefined &&
    constraint.maximum === undefined &&
    constraint.pattern === undefined &&
    constraint.minLength === undefined &&
    constraint.maxLength === undefined &&
    constraint.minItems === undefined &&
    constraint.maxItems === undefined
  );
}

function withoutEmptySchemas(contentTypes: Record<string, SchemaConstraint>): Record<string, SchemaConstraint> {
  return Object.fromEntries(Object.entries(contentTypes).filter(([, schema]) => !isEmptyConstraint(schema)));
}

/**
 * The operation as the existing rules should see it: only what the definition stated. A body with no
 * schema, a non-path parameter with no schema and a response schema that states nothing are left out
 * (the existing helpers would otherwise generate a placeholder string for each and assert conformance
 * to an empty schema). A path parameter is always kept, because a path cannot be built without a value.
 */
export function schemaGroundedView(operation: ApiOperation): ApiOperation {
  const body = operation.requestBody;
  const bodyContentTypes = body ? withoutEmptySchemas(body.contentTypes) : undefined;
  return {
    ...operation,
    parameters: operation.parameters.filter((parameter) => parameter.location === "path" || !isEmptyConstraint(parameter.schema)),
    requestBody: body && bodyContentTypes && Object.keys(bodyContentTypes).length > 0 ? { ...body, contentTypes: bodyContentTypes } : undefined,
    responses: operation.responses.map((response) => ({ ...response, contentTypes: withoutEmptySchemas(response.contentTypes) })),
  };
}

/** Marks every assertion as stated by the definition (FR-036); the assertion itself is unchanged. */
export function declaredAssertions(assertions: readonly Assertion[]): Assertion[] {
  return assertions.map((assertion) => ({ ...assertion, basis: "declared" as const }));
}

function parameterValue(parameter: Parameter): unknown {
  if (parameter.example !== undefined) return parameter.example;
  return isEmptyConstraint(parameter.schema) ? undefined : conformantValue(parameter.schema);
}

/**
 * One positive scenario from the first declared request-body example, only for an operation that
 * declares such an example and no schema for that body. Path, query and header values come from the
 * parameters' declared examples or schemas; a parameter that states neither is not sent, except a path
 * parameter, which is required to form the request and then takes the generated value an OpenAPI path
 * parameter without a schema takes.
 */
export function declaredExampleScenarios(operation: ApiOperation): TestScenario[] {
  const body = operation.requestBody;
  const contentType = primaryRequestBodyContentType(operation);
  const examples = Object.values(body?.examples ?? {});
  if (!body || contentType === undefined || examples.length === 0 || !isEmptyConstraint(body.contentTypes[contentType])) return [];

  const request: GeneratedRequest = { pathParameters: {}, queryParameters: {}, headers: {}, body: structuredClone(examples[0]) };
  for (const parameter of operation.parameters) {
    const value = parameter.location === "path" ? (parameter.example ?? conformantValue(parameter.schema)) : parameterValue(parameter);
    if (value === undefined) continue;
    if (parameter.location === "path") request.pathParameters[parameter.name] = value;
    else if (parameter.location === "query") request.queryParameters[parameter.name] = value;
    else if (parameter.location === "header") request.headers[parameter.name] = value;
  }

  const assertionResult = selectPositiveAssertions(operation);
  const scenario = buildScenario({
    operation,
    category: "positive",
    request,
    assertionResult: { ...assertionResult, assertions: declaredAssertions(assertionResult.assertions) },
    rule: "declared-example-positive",
    description: "Sends the request body example declared in the API definition, because the definition gives no schema for the body.",
  });
  return [
    {
      ...scenario,
      evidence: {
        origin: "declared",
        derivation: "declared-example",
        summary: "The request body is the first example declared in the API definition; the definition declares no schema for it.",
      },
    },
  ];
}
