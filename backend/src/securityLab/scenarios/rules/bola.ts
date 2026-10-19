import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { identifierPathParameters, isStateChangingMethod } from "../../analysis/sensitivity";
import {
  ROLE_OTHER_USER,
  ROLE_OWNER,
  identityPrerequisite,
  ownershipPrerequisite,
} from "../prerequisites";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { NO_OUTPUT, makeContent, primaryScheme, rejectionExpectation, requirementOf, type RuleOutput, type ScenarioRule } from "./support";

/** Operations a cross-identity check applies to. `POST` creates a new resource, so there is no existing owner to cross. */
const APPLICABLE_METHODS = new Set(["GET", "PUT", "PATCH", "DELETE"]);

/**
 * Broken object level authorization: one identity requesting a resource another identity owns (specs/057 FR-025).
 * It applies to read, update and delete operations that take a resource identifier and need credentials. The
 * scenario is always generated for such an operation; whether it can run depends on two identities and on test data
 * giving a resource the first one owns, which the prerequisites state, so a profile that lacks them shows the
 * scenario as incomplete with exactly what is missing instead of omitting it. The expectation is the named product
 * rule, because services answer an ownership failure with 403 or 404 and the specification rarely says which.
 */
export const bolaRule: ScenarioRule = {
  id: "bola",
  categoryId: "broken-object-level-authorization",
  run(context, operation): RuleOutput {
    if (!APPLICABLE_METHODS.has(operation.method.toUpperCase())) return NO_OUTPUT;
    const identifiers = identifierPathParameters(operation);
    if (identifiers.length === 0) return NO_OUTPUT;
    const { requiresCredentials, schemes } = requirementOf(context, operation);
    if (!requiresCredentials) return NO_OUTPUT;
    const scheme = primaryScheme(context, schemes);
    if (!scheme) return NO_OUTPUT;

    const key = operationKeyOf(operation);
    const parameter = identifiers[0];
    const stateChanging = isStateChangingMethod(operation.method);
    const rejection = rejectionExpectation(operation, null, "SL-REJECT-CROSS-IDENTITY");
    const limitations = ["The check substitutes the resource you give as the owner's; ApiPilot cannot verify who really owns it."];
    if (identifiers.length > 1) limitations.push(`Only the first identifier parameter, "${parameter}", is substituted; the operation also takes ${identifiers.slice(1).map((name) => `"${name}"`).join(", ")}.`);

    return {
      contents: [
        makeContent({
          context,
          operation,
          categoryId: "broken-object-level-authorization",
          ruleId: "bola.path-id-substitute",
          title: `${key} on another user's resource`,
          objective: `Check that an identity cannot ${operation.method.toUpperCase() === "GET" ? "read" : operation.method.toUpperCase() === "DELETE" ? "delete" : "update"} a resource that another identity owns.`,
          rationale: `The operation takes the resource identifier "${parameter}" and requires credentials, so an identity that does not own the resource should be rejected when it addresses it.`,
          impact: "One user could read or change another user's data by guessing or reusing an identifier.",
          mutations: [
            { kind: "path-id.substitute", parameter, ownerIdentity: ROLE_OWNER },
            { kind: "identity.swap", from: ROLE_OWNER, to: ROLE_OTHER_USER },
          ],
          expected: rejection.expected,
          conditions: rejection.conditions,
          severity: suggestedSeverityFor("broken-object-level-authorization", "path-id.substitute", stateChanging),
          prerequisites: [
            identityPrerequisite(ROLE_OWNER, scheme),
            identityPrerequisite(ROLE_OTHER_USER, scheme),
            ownershipPrerequisite(key, parameter, ROLE_OWNER),
          ],
          requiredIdentities: [
            { role: ROLE_OWNER, label: "The identity that owns the resource" },
            { role: ROLE_OTHER_USER, label: "A different identity with no access to that resource" },
          ],
          limitations,
          manualInputs: [`The value of "${parameter}" for a resource owned by the "${ROLE_OWNER}" identity.`],
        }),
      ],
      notes: [],
    };
  },
};
