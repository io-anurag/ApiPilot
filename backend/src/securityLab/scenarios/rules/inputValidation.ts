import type { ApiOperation, ConstraintKind, InjectionProbeId, SchemaConstraint, SecurityMutation } from "@apipilot/shared-domain";
import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { isStateChangingMethod } from "../../analysis/sensitivity";
import { primaryRequestBodySchema, walkFields } from "../../../testDesign/requestHelpers";
import { isCredentialFieldName } from "../credentialPlaceholders";
import { ROLE_ANY, identityPrerequisite } from "../prerequisites";
import { productRuleStatement } from "../productRules";
import { formatTarget, type TargetLocation } from "../requestTarget";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { CONSTRAINT_ORDER, violationFor } from "../violations";
import { makeContent, primaryScheme, rejectionExpectation, requirementOf, type GenerationContext, type RuleOutput, type ScenarioRule } from "./support";

interface Target {
  readonly location: TargetLocation;
  readonly name: string;
  readonly schema: SchemaConstraint;
  readonly required: boolean;
}

/** The request inputs a constraint can be violated on: body fields and the operation's parameters, never a credential field. */
function targetsOf(operation: ApiOperation): Target[] {
  const targets: Target[] = [];
  const body = primaryRequestBodySchema(operation);
  if (body) {
    for (const field of walkFields(body)) {
      if (!isCredentialFieldName(field.path.split(".").at(-1) ?? field.path)) {
        targets.push({ location: "body", name: field.path, schema: field.schema, required: field.required });
      }
    }
  }
  for (const parameter of operation.parameters) {
    if (isCredentialFieldName(parameter.name)) continue;
    targets.push({ location: parameter.location === "cookie" ? "header" : parameter.location, name: parameter.name, schema: parameter.schema, required: parameter.required });
  }
  return targets;
}

function describeConstraint(schema: SchemaConstraint, constraint: ConstraintKind): string {
  switch (constraint) {
    case "type":
      return `type ${schema.type}`;
    case "format":
      return schema.format ? `format ${schema.format}` : "a pattern";
    case "enum":
      return `one of ${(schema.enum ?? []).map((value) => JSON.stringify(value)).join(", ")}`;
    case "minimum":
      return `minimum ${schema.minimum}`;
    case "maximum":
      return `maximum ${schema.maximum}`;
    case "minLength":
      return `minimum length ${schema.minLength}`;
    case "maxLength":
      return `maximum length ${schema.maxLength}`;
    case "minItems":
      return `at least ${schema.minItems} items`;
    case "maxItems":
      return `at most ${schema.maxItems} items`;
    case "required":
      return "that it is required";
  }
}

const PROBES: readonly InjectionProbeId[] = ["sql-quote", "xss-angle"];

function injectionScenarios(context: GenerationContext, operation: ApiOperation, key: string, credentials: { scheme?: string }) {
  if (isStateChangingMethod(operation.method)) return [];
  if (!context.profile?.permittedCategories.includes("input-validation")) return [];
  const target = operation.parameters.find((parameter) => parameter.location === "query" && parameter.schema.type === "string" && !isCredentialFieldName(parameter.name));
  if (!target) return [];
  return PROBES.map((probeId) => {
    const mutation: SecurityMutation = { kind: "input.injection-probe", path: formatTarget("query", target.name), probeId };
    return makeContent({
      context,
      operation,
      categoryId: "input-validation",
      ruleId: `input-validation.injection-probe.${probeId}`,
      title: `${key}: "${target.name}" carries a ${probeId === "sql-quote" ? "SQL quote" : "script"} probe`,
      objective: `Check that a benign ${probeId === "sql-quote" ? "SQL" : "script"} probe in "${target.name}" does not make the service reveal an error, a stack trace or an internal path.`,
      rationale: `The query parameter "${target.name}" is a string the service may pass to a query or a template. A fixed, harmless probe shows whether an error leaks internals. A pass shows no leak for this probe only; it is not evidence that the input is safe.`,
      impact: "Error text that reveals queries, paths or stack traces helps an attacker and can indicate an injectable input.",
      mutations: [mutation],
      expected: { kind: "no-leak", statement: productRuleStatement("SL-NO-LEAK-PATTERN"), basis: "product-rule", ruleId: "SL-NO-LEAK-PATTERN" },
      conditions: [
        { kind: "body.not-match-leak-pattern", patternId: "sql-error" },
        { kind: "body.not-match-leak-pattern", patternId: "stack-trace" },
      ],
      severity: suggestedSeverityFor("input-validation", "input.injection-probe", false),
      specElementPointer: `/operations/${key}/parameters/${target.name}`,
      limitations: ["The probe is a fixed, harmless string. A pass means no leak for that probe, not that the input is safe."],
      ...(credentials.scheme
        ? { prerequisites: [identityPrerequisite(ROLE_ANY, credentials.scheme)], requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }] }
        : {}),
    });
  });
}

/**
 * Input validation: a deliberate violation of one declared constraint per scenario (type, format, enum, numeric,
 * length and item bounds, and a missing required field), reusing the test designer's value generators (specs/057
 * FR-025, FR-027). A scenario exists only for a constraint the specification actually declares. Injection probes
 * come only from a fixed, benign set, only for a safe method, and only when the selected profile permits this
 * category. Where the specification documents a 400 or 422 the scenario cites it; otherwise the named rule applies.
 */
export const inputValidationRule: ScenarioRule = {
  id: "input-validation",
  categoryId: "input-validation",
  run(context, operation): RuleOutput {
    const key = operationKeyOf(operation);
    const stateChanging = isStateChangingMethod(operation.method);
    const { requiresCredentials, schemes } = requirementOf(context, operation);
    const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
    if (requiresCredentials && !scheme) return { contents: [], notes: [] };
    const rejection = rejectionExpectation(operation, [400, 422], "SL-REJECT-CONSTRAINT-VIOLATION");

    const contents = targetsOf(operation).flatMap((target) =>
      CONSTRAINT_ORDER.flatMap((constraint) => {
        // A missing-field scenario needs a required, omittable input; a path segment cannot be omitted.
        if (constraint === "required" && (!target.required || target.location === "path")) return [];
        // Everything in a URL or a header is text, so a number in a string parameter is not a violation.
        if (constraint === "type" && target.location !== "body" && target.schema.type === "string") return [];
        if (!violationFor(target.schema, constraint)) return [];
        const mutation: SecurityMutation = { kind: "field.violate-constraint", path: formatTarget(target.location, target.name), constraint };
        return [
          makeContent({
            context,
            operation,
            categoryId: "input-validation",
            ruleId: `input-validation.${constraint}`,
            title: `${key}: "${target.name}" violates ${constraint === "required" ? "required" : constraint}`,
            objective: `Check that the service rejects a request in which "${target.name}" ${constraint === "required" ? "is missing" : `breaks its declared ${constraint}`}.`,
            rationale: `The specification declares ${describeConstraint(target.schema, constraint)} for "${target.name}", so a request that breaks it should not be processed as successful.`,
            impact: "A service that accepts invalid input may store bad data or fail in a way an attacker can use.",
            mutations: [mutation],
            expected: rejection.expected,
            conditions: rejection.conditions,
            severity: suggestedSeverityFor("input-validation", "field.violate-constraint", stateChanging),
            specElementPointer: `/operations/${key}/${target.location === "body" ? "requestBody" : "parameters"}/${target.name}`,
            ...(scheme
              ? { prerequisites: [identityPrerequisite(ROLE_ANY, scheme)], requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }] }
              : {}),
          }),
        ];
      }),
    );

    return { contents: [...contents, ...injectionScenarios(context, operation, key, { scheme })], notes: [] };
  },
};
