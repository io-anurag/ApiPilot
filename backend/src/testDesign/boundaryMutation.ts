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

/** One boundary-adjacent value to try against a schema, plus whether it is expected to pass or fail validation. */
export interface BoundaryVariant {
  /** Slug used to build the specific rule identifier, e.g. "below-minimum" (FR-013). */
  key: string;
  value: unknown;
  /** "valid" variants (at-boundary) are expected to succeed; "invalid" variants (past the boundary) are expected to fail. */
  outcome: "valid" | "invalid";
}

/**
 * Configures `generateBoundaryScenarios` for one boundary rule (numeric/string/array): its
 * rule-name prefix, description builder, and variant source.
 *
 * `category` applies only to "invalid" variants (past the boundary): an "at-boundary" value is
 * schema-conformant by definition, so those variants are categorized as `"positive"` instead
 * (see `assertionsFor`/the `buildScenario` call sites below) — the rule name (e.g.
 * `"numeric-boundary-at-maximum"`) still records which boundary produced it.
 */
export interface BoundaryMutationRuleOptions {
  category: ScenarioCategory;
  rulePrefix: string;
  describe: (targetDescription: string, key: string) => string;
  /** Returns the applicable boundary variants for `schema`, or an empty array when no basis exists (FR-015). */
  variantsFor: (schema: SchemaConstraint) => BoundaryVariant[];
}

/** "Valid" (at-boundary) variants are schema-conformant, so they are positive scenarios; only past-the-boundary variants keep the rule's negative boundary category. */
function categoryFor(options: BoundaryMutationRuleOptions, outcome: "valid" | "invalid"): ScenarioCategory {
  return outcome === "valid" ? "positive" : options.category;
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
            category: categoryFor(options, variant.outcome),
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
          category: categoryFor(options, variant.outcome),
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
