import { allowsAnonymous, describeRequirement } from "../effectiveSecurity";
import { describeOperationSensitivity, isStateChangingMethod } from "../sensitivity";
import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

/**
 * `effective-security-public`, `effective-security-none-declared` and `security-override`
 * (contracts/generation-and-analysis-rules.md sections 1 and 2). An operation with no explicit requirement is
 * not automatically vulnerable: it may inherit the root requirement (no observation at all), or be public on
 * purpose. Nothing here claims a runtime vulnerability.
 */
export const effectiveSecurityRule: ObservationRule = {
  id: "effective-security",
  run(context) {
    const drafts: DraftObservation[] = [];
    const schemesDeclared = Object.keys(context.apiModel.securitySchemes).length > 0;
    const rootRequirement = context.apiModel.rootSecurity ?? [];
    let anyNoneDeclared = false;

    for (const { operation, key } of context.operations) {
      const effective = context.effective.get(key);
      if (!effective || effective.source === "unknown" || effective.source === "root") continue;
      const sensitivity = describeOperationSensitivity(operation);
      const looksSensitive = sensitivity.bases.length > 0;
      const why = sensitivity.detail.join("; ");

      if (effective.source === "explicit-public") {
        const stateChanging = isStateChangingMethod(operation.method);
        const classification = looksSensitive && stateChanging ? "potential-risk" : looksSensitive ? "requires-context" : "informational";
        drafts.push({
          ruleId: "effective-security-public",
          classification,
          operationKey: key,
          elementPointer: operationPointer(key, "security"),
          rationale: `The operation declares an empty security requirement, so the specification makes it public on purpose.${
            looksSensitive ? ` It may deserve a second look because ${why}. Confirm that being public is intended; the specification cannot say whether it is.` : ""
          }`,
          origin: originOf(operation),
          categoryId: "authentication",
        });
        continue;
      }

      if (effective.source === "none-declared") {
        if (!schemesDeclared) {
          anyNoneDeclared = true;
          continue;
        }
        drafts.push({
          ruleId: "effective-security-none-declared",
          classification: "requires-context",
          operationKey: key,
          elementPointer: operationPointer(key, "security"),
          rationale: `Neither the operation nor the specification's root declares a security requirement${
            effective.rootExplicitlyEmpty ? " (the root declares an empty requirement on purpose)" : ""
          }, although security schemes are declared. The operation may be public or the requirement may be undocumented; the specification cannot tell which.${
            looksSensitive ? ` It looks sensitive because ${why}.` : ""
          }`,
          origin: originOf(operation),
          categoryId: "authentication",
        });
        continue;
      }

      // `operation`: an own requirement. Say so when it replaces a different root requirement.
      if (rootRequirement.length > 0) {
        drafts.push({
          ruleId: "security-override",
          classification: "informational",
          operationKey: key,
          elementPointer: operationPointer(key, "security"),
          rationale: `The operation replaces the root requirement (${describeRequirement(rootRequirement)}) with its own (${describeRequirement(
            effective.requirement,
          )}).${allowsAnonymous(effective.requirement) ? " Its own requirement allows an anonymous call." : ""}`,
          origin: originOf(operation),
          categoryId: "authentication",
        });
      } else if (allowsAnonymous(effective.requirement)) {
        drafts.push({
          ruleId: "security-override",
          classification: "requires-context",
          operationKey: key,
          elementPointer: operationPointer(key, "security"),
          rationale: `The operation's requirement includes the anonymous alternative, so an unauthenticated call is allowed by the specification. Confirm that is intended.`,
          origin: originOf(operation),
          categoryId: "authentication",
        });
      }
    }

    if (anyNoneDeclared && !schemesDeclared) {
      drafts.push({
        ruleId: "effective-security-none-declared",
        classification: "not-measurable",
        elementPointer: "/securitySchemes",
        rationale:
          "The specification declares no security schemes and no operation or root requirement, so nothing can be concluded about authentication from it. Whether the API is protected is not measurable with the available input.",
        origin: "documented",
        categoryId: "authentication",
      });
    }
    return drafts;
  },
};
