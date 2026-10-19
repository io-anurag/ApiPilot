import type { EvaluationCondition } from "@apipilot/shared-domain";
import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { classifyProperty, walkProperties } from "../../analysis/sensitivity";
import { ROLE_ANY, identityPrerequisite } from "../prerequisites";
import { productRuleStatement } from "../productRules";
import { suggestedSeverityFor } from "../suggestedSeverity";
import { NO_OUTPUT, makeContent, primaryScheme, requirementOf, type RuleOutput, type ScenarioRule } from "./support";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const MAX_PATHS = 5;

/**
 * Sensitive data exposure: a baseline request whose response must not contain a property classified sensitive
 * **with a recorded basis** (specs/057 FR-009, FR-025). A property flagged only by its name produces nothing. The
 * scenario judges the response schema by asking a real response for the property; it is limited to safe methods so
 * it can never change data.
 */
export const sensitiveDataExposureRule: ScenarioRule = {
  id: "sensitive-data-exposure",
  categoryId: "sensitive-data-exposure",
  run(context, operation): RuleOutput {
    if (!SAFE_METHODS.has(operation.method.toUpperCase())) return NO_OUTPUT;

    const found = new Map<string, "format-password" | "write-only" | "user-configured">();
    for (const response of operation.responses.filter((entry) => entry.statusCode.startsWith("2"))) {
      for (const schema of Object.values(response.contentTypes)) {
        for (const property of walkProperties(schema)) {
          const classification = classifyProperty(property.name, property.constraint, context.configuredSensitive);
          if (classification && classification.basis !== "name-match" && !found.has(property.path)) {
            found.set(property.path, classification.basis);
          }
        }
      }
    }
    if (found.size === 0) return NO_OUTPUT;

    const paths = [...found.keys()].sort().slice(0, MAX_PATHS);
    const key = operationKeyOf(operation);
    const declaredOnly = paths.every((path) => found.get(path) !== "user-configured");
    const conditions: EvaluationCondition[] = paths.map((path) => ({ kind: "body.field-absent", path }));
    const { requiresCredentials, schemes } = requirementOf(context, operation);
    const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;
    const bases = [...new Set(paths.map((path) => found.get(path)))].sort().join(", ");

    return {
      contents: [
        makeContent({
          context,
          operation,
          categoryId: "sensitive-data-exposure",
          ruleId: "sensitive-data-exposure.response-field",
          title: `${key} response must not contain ${paths.map((path) => `"${path}"`).join(", ")}`,
          objective: "Check that a real response does not contain a property classified as sensitive.",
          rationale: `The response schema contains ${paths.length === 1 ? "a property" : "properties"} classified as sensitive (basis: ${bases}). A real response should not include ${paths.length === 1 ? "it" : "them"}.`,
          impact: "A response that returns a sensitive property exposes it to every caller of the operation.",
          mutations: [],
          expected: declaredOnly
            ? {
                kind: "no-leak",
                statement: "The specification declares the property as write-only or as a password, so a response must not contain it.",
                basis: "documented",
                citation: `/operations/${key}/responses/${paths[0]}`,
              }
            : { kind: "no-leak", statement: productRuleStatement("SL-NO-SENSITIVE-FIELD"), basis: "product-rule", ruleId: "SL-NO-SENSITIVE-FIELD" },
          conditions,
          severity: suggestedSeverityFor("sensitive-data-exposure", "none", false),
          specElementPointer: `/operations/${key}/responses/${paths[0]}`,
          ...(scheme
            ? { prerequisites: [identityPrerequisite(ROLE_ANY, scheme)], requiredIdentities: [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }] }
            : {}),
          limitations: [
            ...(found.size > MAX_PATHS ? [`Only the first ${MAX_PATHS} of ${found.size} sensitive properties are checked.`] : []),
            "A response that does not return the property proves nothing about other responses or other data.",
          ],
        }),
      ],
      notes: [],
    };
  },
};
