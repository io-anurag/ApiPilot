import type {
  ApiOperation,
  GeneratedRequest,
  ScenarioCategory,
  SchemaConstraint,
  TestScenario,
} from "@apipilot/shared-domain";
import { selectNegativeAssertions } from "./assertions";
import { buildConformantRequest, cloneRequest, primaryRequestBodySchema, setAtPath, walkFields } from "./requestHelpers";
import { buildScenario } from "./scenario";

/** Configures `generateSingleFieldMutationScenarios` for one single-field rule (invalid-type/format/enum): its category, rule name, description builder, and mutated-value source. */
export interface SingleFieldMutationRuleOptions {
  category: ScenarioCategory;
  rule: string;
  describe: (targetDescription: string) => string;
  /** Returns the mutated value to use, or `undefined` if the rule has no basis to fire for this field (FR-015). */
  valueFor: (schema: SchemaConstraint) => unknown;
}

type RequestBucket = "pathParameters" | "queryParameters" | "headers";

function bucketFor(location: "path" | "query" | "header" | "cookie"): RequestBucket | undefined {
  if (location === "path") return "pathParameters";
  if (location === "query") return "queryParameters";
  if (location === "header") return "headers";
  return undefined; // cookie parameters are out of scope for GeneratedRequest
}

/**
 * Shared traversal for rules that mutate exactly one declared-constraint field/parameter at a
 * time against an otherwise-conformant request (invalid-type, invalid-format, invalid-enum).
 */
export function generateSingleFieldMutationScenarios(
  operation: ApiOperation,
  options: SingleFieldMutationRuleOptions,
): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const base = buildConformantRequest(operation);
  const assertionResult = () => selectNegativeAssertions(operation);

  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    for (const field of walkFields(bodySchema)) {
      const value = options.valueFor(field.schema);
      if (value === undefined) continue;
      const request: GeneratedRequest = cloneRequest(base);
      request.body = setAtPath(request.body, field.path, value);
      scenarios.push(
        buildScenario({
          operation,
          category: options.category,
          targetLocation: "body",
          targetField: field.path,
          request,
          assertionResult: assertionResult(),
          rule: options.rule,
          description: options.describe(`body field "${field.path}"`),
        }),
      );
    }
  }

  for (const parameter of operation.parameters) {
    const bucket = bucketFor(parameter.location);
    if (!bucket) continue;
    const value = options.valueFor(parameter.schema);
    if (value === undefined) continue;
    const request = cloneRequest(base);
    request[bucket][parameter.name] = value;
    scenarios.push(
      buildScenario({
        operation,
        category: options.category,
        targetLocation: parameter.location as "path" | "query" | "header",
        targetField: parameter.name,
        request,
        assertionResult: assertionResult(),
        rule: options.rule,
        description: options.describe(`${parameter.location} parameter "${parameter.name}"`),
      }),
    );
  }

  return scenarios;
}
