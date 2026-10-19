import type { SecuritySchemeDefinition } from "@apipilot/shared-domain";
import { schemeNamesOf } from "../effectiveSecurity";
import { operationPointer, originOf, type ObservationRule } from "./types";

function describeScheme(definition: SecuritySchemeDefinition): string {
  const parts: string[] = [definition.type];
  if (definition.scheme) parts.push(definition.scheme);
  if (definition.bearerFormat) parts.push(`${definition.bearerFormat} format`);
  if (definition.in && definition.name) parts.push(`in ${definition.in} as "${definition.name}"`);
  return parts.join(" ");
}

/**
 * `auth-scheme-declared`, `auth-scheme-unused` and `operation-uses-undeclared-scheme`
 * (contracts/generation-and-analysis-rules.md section 2). An undeclared scheme is a specification
 * inconsistency, not a runtime claim.
 */
export const authSchemesRule: ObservationRule = {
  id: "auth-schemes",
  run(context) {
    const drafts: ReturnType<ObservationRule["run"]> = [];
    const usage = new Map<string, number>();
    for (const { key } of context.operations) {
      const effective = context.effective.get(key);
      if (!effective) continue;
      for (const name of schemeNamesOf(effective.requirement)) usage.set(name, (usage.get(name) ?? 0) + 1);
    }

    for (const name of Object.keys(context.apiModel.securitySchemes).sort()) {
      const definition = context.apiModel.securitySchemes[name];
      const used = usage.get(name) ?? 0;
      drafts.push({
        ruleId: "auth-scheme-declared",
        classification: "informational",
        elementPointer: `/securitySchemes/${name}`,
        rationale: `The specification declares the scheme "${name}" (${describeScheme(definition)}). ${
          used === 0 ? "No operation's effective requirement uses it." : `${used} operation(s) have an effective requirement that uses it.`
        }`,
        origin: "documented",
        categoryId: "authentication",
      });
      if (used === 0) {
        drafts.push({
          ruleId: "auth-scheme-unused",
          classification: "informational",
          elementPointer: `/securitySchemes/${name}`,
          rationale: `The scheme "${name}" is declared but no operation's effective security requirement refers to it, so declaring it protects nothing.`,
          origin: "documented",
          categoryId: "authentication",
        });
      }
    }

    for (const { operation, key } of context.operations) {
      const effective = context.effective.get(key);
      if (!effective) continue;
      const undeclared = schemeNamesOf(effective.requirement).filter((name) => !(name in context.apiModel.securitySchemes));
      if (undeclared.length > 0) {
        drafts.push({
          ruleId: "operation-uses-undeclared-scheme",
          classification: "potential-risk",
          operationKey: key,
          elementPointer: operationPointer(key, "security"),
          rationale: `The operation's security requirement refers to ${undeclared.map((name) => `"${name}"`).join(", ")}, which the specification does not declare. This is an inconsistency inside the specification, not evidence about the running service.`,
          origin: originOf(operation),
          categoryId: "authentication",
        });
      }
    }
    return drafts;
  },
};
