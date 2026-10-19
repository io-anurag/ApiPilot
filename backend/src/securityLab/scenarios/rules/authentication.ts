import type { SecurityMutation } from "@apipilot/shared-domain";
import { describeRequirement, operationKeyOf } from "../../analysis/effectiveSecurity";
import { isStateChangingMethod } from "../../analysis/sensitivity";
import { ROLE_ANY, expiredCredentialPrerequisite } from "../prerequisites";
import { suggestedSeverityFor } from "../suggestedSeverity";
import {
  NO_OUTPUT,
  makeContent,
  primaryScheme,
  rejectionExpectation,
  requirementOf,
  type RuleOutput,
  type ScenarioRule,
} from "./support";

interface Variant {
  readonly mutation: SecurityMutation;
  readonly title: string;
  readonly objective: string;
  readonly limitation?: string;
}

/**
 * Authentication: a missing, invalid, malformed and expired credential against an operation whose effective
 * requirement needs one (specs/057 FR-025, contracts/generation-and-analysis-rules.md section 3). It generates
 * nothing for an operation that is public, has nothing declared, or whose requirement allows an anonymous call:
 * not every endpoint requires authentication, and a test that expects rejection of a public operation would be
 * wrong. OAuth2 and OpenID Connect schemes are sent as a bearer token the engineer supplies; ApiPilot never performs
 * the OAuth flow or obtains a token.
 */
export const authenticationRule: ScenarioRule = {
  id: "authentication",
  categoryId: "authentication",
  run(context, operation): RuleOutput {
    const { requiresCredentials, schemes } = requirementOf(context, operation);
    if (!requiresCredentials) return NO_OUTPUT;

    const key = operationKeyOf(operation);
    const scheme = primaryScheme(context, schemes);
    if (!scheme) {
      return {
        contents: [],
        notes: [
          {
            categoryId: "authentication",
            operationKey: key,
            reason: `None of the operation's security schemes (${schemes.join(", ")}) is a type the sender can express (HTTP bearer or basic, API key in a header, query or cookie, OAuth2 or OpenID Connect as a supplied token).`,
          },
        ],
      };
    }

    const effective = context.effective.get(key);
    const requirement = effective ? describeRequirement(effective.requirement) : "a security requirement";
    const stateChanging = isStateChangingMethod(operation.method);
    const rejection = rejectionExpectation(operation, [401, 403], "SL-REJECT-NOT-SUCCESS");
    const rationale = `The operation's effective security requirement is ${requirement} (${effective?.source === "root" ? "inherited from the root" : "declared on the operation"}), so a request that does not present a valid credential for "${scheme}" should be rejected.`;

    const variants: Variant[] = [
      { mutation: { kind: "auth.omit" }, title: `${key} without credentials`, objective: "Check that the operation rejects a request that carries no credentials." },
      { mutation: { kind: "auth.invalid-token" }, title: `${key} with an invalid credential`, objective: "Check that the operation rejects a credential that was never issued." },
      { mutation: { kind: "auth.malformed" }, title: `${key} with a malformed credential`, objective: "Check that the operation rejects a credential that is structurally invalid for its scheme." },
      {
        mutation: { kind: "auth.expired", identity: ROLE_ANY },
        title: `${key} with an expired credential`,
        objective: "Check that the operation rejects a credential that was valid and has expired.",
        limitation: "Needs a known-expired credential that you supply. ApiPilot never makes one up and never obtains a token.",
      },
    ];

    return {
      contents: variants.map((variant) =>
        makeContent({
          context,
          operation,
          categoryId: "authentication",
          ruleId: `authentication.${variant.mutation.kind}`,
          title: variant.title,
          objective: variant.objective,
          rationale,
          impact: "A caller without valid credentials could use this operation.",
          mutations: [variant.mutation],
          expected: rejection.expected,
          conditions: rejection.conditions,
          severity: suggestedSeverityFor("authentication", variant.mutation.kind, stateChanging),
          ...(variant.mutation.kind === "auth.expired"
            ? {
                prerequisites: [expiredCredentialPrerequisite(scheme)],
                requiredIdentities: [{ role: ROLE_ANY, label: "An identity whose credential is known to be expired" }],
                limitations: variant.limitation ? [variant.limitation] : [],
                manualInputs: [`A known-expired credential for the "${scheme}" scheme.`],
              }
            : {}),
        }),
      ),
      notes: [],
    };
  },
};
