import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { isStateChangingMethod } from "../../analysis/sensitivity";
import { ROLE_PRIVILEGED, ROLE_RESTRICTED, identityPrerequisite } from "../prerequisites";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { NO_OUTPUT, isExpressibleScheme, makeContent, rejectionExpectation, type RuleOutput, type ScenarioRule } from "./support";

/**
 * Authorization: acting as an identity that lacks a permission the specification states (specs/057 FR-025,
 * contracts/generation-and-analysis-rules.md section 3). It is generated only where a policy is *known*: the
 * operation's effective requirement lists scopes. No policy is ever invented, so an operation whose requirement
 * names no scope produces nothing. The expectation is the named product rule, not an invented status code.
 */
export const authorizationRule: ScenarioRule = {
  id: "authorization",
  categoryId: "authorization",
  run(context, operation): RuleOutput {
    const key = operationKeyOf(operation);
    const effective = context.effective.get(key);
    if (!effective || (effective.source !== "operation" && effective.source !== "root")) return NO_OUTPUT;

    const scoped = effective.requirement.flatMap((entry) => entry.schemes.filter((scheme) => scheme.scopes.length > 0));
    const target = scoped.find((scheme) => isExpressibleScheme(context, scheme.name));
    if (!target) return NO_OUTPUT;

    const scopes = [...new Set(scoped.flatMap((scheme) => scheme.scopes))].sort();
    const rejection = rejectionExpectation(operation, null, "SL-REJECT-INSUFFICIENT-PERMISSION");
    const stateChanging = isStateChangingMethod(operation.method);

    return {
      contents: [
        makeContent({
          context,
          operation,
          categoryId: "authorization",
          ruleId: "authorization.identity-swap",
          title: `${key} as an identity without the required permissions`,
          objective: "Check that an identity that lacks the permissions the specification requires cannot use the operation.",
          rationale: `The specification requires the scope${scopes.length === 1 ? "" : "s"} ${scopes.map((scope) => `"${scope}"`).join(", ")} for this operation, so an identity without ${
            scopes.length === 1 ? "it" : "them"
          } should be rejected.`,
          impact: "An identity without the required permissions could use a privileged operation.",
          mutations: [{ kind: "identity.swap", from: ROLE_PRIVILEGED, to: ROLE_RESTRICTED }],
          expected: rejection.expected,
          conditions: rejection.conditions,
          severity: suggestedSeverityFor("authorization", "identity.swap", stateChanging),
          prerequisites: [identityPrerequisite(ROLE_PRIVILEGED, target.name), identityPrerequisite(ROLE_RESTRICTED, target.name)],
          requiredIdentities: [
            { role: ROLE_PRIVILEGED, label: `An identity that holds ${scopes.join(", ")}` },
            { role: ROLE_RESTRICTED, label: `An identity that lacks ${scopes.join(", ")}` },
          ],
          limitations: ['ApiPilot cannot verify that the "restricted" identity really lacks the permissions; you configure which identity that is.'],
        }),
      ],
      notes: [],
    };
  },
};
