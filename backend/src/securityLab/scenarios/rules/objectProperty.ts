import type { SchemaConstraint, SecurityMutation } from "@apipilot/shared-domain";
import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { isStateChangingMethod, walkProperties } from "../../analysis/sensitivity";
import { primaryRequestBodySchema } from "../../../testDesign/requestHelpers";
import { ROLE_ANY, identityPrerequisite } from "../prerequisites";
import { productRuleStatement } from "../productRules";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { NO_OUTPUT, makeContent, primaryScheme, requirementOf, type RuleOutput, type ScenarioRule } from "./support";

/** At most this many protected properties are probed per operation. */
const MAX_PROPERTIES = 3;
const APPLICABLE_METHODS = new Set(["POST", "PUT", "PATCH"]);

function valueKindFor(constraint: SchemaConstraint): "string" | "number" | "boolean" | "protected-example" | undefined {
  switch (constraint.type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
    case undefined:
      return "protected-example";
    default:
      return undefined;
  }
}

/**
 * Object-property authorization and mass assignment: sending a property the specification marks `readOnly` in a
 * request (specs/057 FR-025). Only a property the *model* declares protected is probed; a field is never guessed.
 * Persisted state is not read back in V1, so an accepted request is judged only by whether the response echoes the
 * value; otherwise the outcome is inconclusive. That is stated on the scenario, so a quiet "accepted and ignored" is
 * never reported as a finding.
 */
export const objectPropertyRule: ScenarioRule = {
  id: "object-property",
  categoryId: "object-property-authorization",
  run(context, operation): RuleOutput {
    if (!APPLICABLE_METHODS.has(operation.method.toUpperCase())) return NO_OUTPUT;
    const schema = primaryRequestBodySchema(operation);
    if (!schema) return NO_OUTPUT;

    const protectedProperties = walkProperties(schema)
      .filter((property) => property.constraint.readOnly === true && !property.path.includes("[]"))
      .slice(0, MAX_PROPERTIES);
    if (protectedProperties.length === 0) return NO_OUTPUT;

    const key = operationKeyOf(operation);
    const { requiresCredentials, schemes } = requirementOf(context, operation);
    const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
    const stateChanging = isStateChangingMethod(operation.method);

    const contents = protectedProperties.flatMap((property) => {
      const valueKind = valueKindFor(property.constraint);
      if (!valueKind) return [];
      const segments = property.path.split(".");
      const name = segments.at(-1) as string;
      const parent = segments.slice(0, -1).join(".");
      const mutation: SecurityMutation = { kind: "body.add-property", path: parent, name, valueKind };
      return [
        makeContent({
          context,
          operation,
          categoryId: "object-property-authorization",
          ruleId: "object-property.add-protected",
          title: `${key} sets the read-only property "${property.path}"`,
          objective: `Check that the service does not let a client set the read-only property "${property.path}".`,
          rationale: `The specification marks "${property.path}" readOnly, so a client should not be able to set it. Sending a value for it checks whether the service ignores or rejects it.`,
          impact: "A client could set a property it is not allowed to control, for example its own role or another account's balance.",
          mutations: [mutation],
          expected: {
            kind: "persisted-unchanged",
            statement: productRuleStatement("SL-REJECT-PROTECTED-PROPERTY"),
            basis: "product-rule",
            ruleId: "SL-REJECT-PROTECTED-PROPERTY",
          },
          conditions: [{ kind: "persisted.field-unchanged", path: property.path }],
          severity: suggestedSeverityFor("object-property-authorization", "body.add-property", stateChanging),
          specElementPointer: `/operations/${key}/requestBody/${property.path}`,
          ...(scheme
            ? {
                prerequisites: [identityPrerequisite(ROLE_ANY, scheme)],
                requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }],
              }
            : {}),
          limitations: [
            "Persisted state is not read back in V1. An accepted request counts as a violation only if the response echoes the value you sent; otherwise the outcome is inconclusive.",
          ],
        }),
      ];
    });
    return { contents, notes: [] };
  },
};
