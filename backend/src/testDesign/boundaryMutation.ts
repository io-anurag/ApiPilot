import type {
  ApiOperation,
  GeneratedRequest,
  ScenarioCategory,
  SchemaConstraint,
  TestScenario,
} from "@apipilot/shared-domain";
import { selectNegativeAssertions, selectPositiveAssertions } from "./assertions";
import { buildConformantRequest, cloneRequest, primaryRequestBodySchema, setAtPath, walkFields } from "./requestHelpers";
import { buildScenario } from "./scenario";

export interface BoundaryVariant {
  /** Slug used to build the specific rule identifier, e.g. "below-minimum" (FR-013). */
  key: string;
  value: unknown;
  /** "valid" variants (at-boundary) are expected to succeed; "invalid" variants (past the boundary) are expected to fail. */
  outcome: "valid" | "invalid";
}

export interface BoundaryMutationRuleOptions {
  category: ScenarioCategory;
  rulePrefix: string;
  describe: (targetDescription: string, key: string) => string;
  /** Returns the applicable boundary variants for `schema`, or an empty array when no basis exists (FR-015). */
  variantsFor: (schema: SchemaConstraint) => BoundaryVariant[];
}

type RequestBucket = "pathParameters" | "queryParameters" | "headers";

function bucketFor(location: "path" | "query" | "header" | "cookie"): RequestBucket | undefined {
  if (location === "path") return "pathParameters";
  if (location === "query") return "queryParameters";
  if (location === "header") return "headers";
  return undefined;
}

/** Shared traversal for the three boundary rules (numeric/string/array), each producing up to four variants per field. */
export function generateBoundaryScenarios(
  operation: ApiOperation,
  options: BoundaryMutationRuleOptions,
): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const base = buildConformantRequest(operation);

  function assertionsFor(outcome: "valid" | "invalid") {
    return outcome === "valid" ? selectPositiveAssertions(operation) : selectNegativeAssertions(operation);
  }

  const bodySchema = primaryRequestBodySchema(operation);
  if (bodySchema) {
    for (const field of walkFields(bodySchema)) {
      for (const variant of options.variantsFor(field.schema)) {
        const request: GeneratedRequest = cloneRequest(base);
        request.body = setAtPath(request.body, field.path, variant.value);
        scenarios.push(
          buildScenario({
            operation,
            category: options.category,
            targetLocation: "body",
            targetField: field.path,
            request,
            assertionResult: assertionsFor(variant.outcome),
            rule: `${options.rulePrefix}-${variant.key}`,
            description: options.describe(`body field "${field.path}"`, variant.key),
          }),
        );
      }
    }
  }

  for (const parameter of operation.parameters) {
    const bucket = bucketFor(parameter.location);
    if (!bucket) continue;
    for (const variant of options.variantsFor(parameter.schema)) {
      const request = cloneRequest(base);
      request[bucket][parameter.name] = variant.value;
      scenarios.push(
        buildScenario({
          operation,
          category: options.category,
          targetLocation: parameter.location as "path" | "query" | "header",
          targetField: parameter.name,
          request,
          assertionResult: assertionsFor(variant.outcome),
          rule: `${options.rulePrefix}-${variant.key}`,
          description: options.describe(`${parameter.location} parameter "${parameter.name}"`, variant.key),
        }),
      );
    }
  }

  return scenarios;
}
