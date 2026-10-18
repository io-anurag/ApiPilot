import type { SchemaConstraint } from "@apipilot/shared-domain";
import { walkProperties } from "../sensitivity";
import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

/** Names that suggest the service may fetch or redirect to a location the caller supplies. */
const URL_NAME = /(^|[-_.])(url|uri|callback|webhook|redirect|endpoint|link)([-_.]|$)|(Url|Uri|Callback|Webhook|Redirect|Endpoint)$/;

function isUrlTyped(name: string, schema: SchemaConstraint): boolean {
  if (schema.type !== undefined && schema.type !== "string") return false;
  return schema.format === "uri" || schema.format === "url" || URL_NAME.test(name);
}

/**
 * `ssrf-candidate-input` (SSRF and unsafe API consumption, limited). It lists inputs that look like a URL the service
 * might fetch. It never claims detection: reliable server-side request forgery checks need controlled callback
 * verification, which does not exist here, so the observation says what is *not* being tested (specs/057 FR-014).
 */
export const ssrfCandidatesRule: ObservationRule = {
  id: "ssrf-candidates",
  run(context) {
    const drafts: DraftObservation[] = [];
    for (const { operation, key } of context.operations) {
      const names = new Set<string>();
      for (const parameter of operation.parameters) {
        if (isUrlTyped(parameter.name, parameter.schema)) names.add(parameter.name);
      }
      for (const schema of Object.values(operation.requestBody?.contentTypes ?? {})) {
        for (const property of walkProperties(schema)) {
          if (isUrlTyped(property.name, property.constraint)) names.add(property.path);
        }
      }
      if (names.size === 0) continue;
      const list = [...names].sort();
      drafts.push({
        ruleId: "ssrf-candidate-input",
        classification: "requires-context",
        operationKey: key,
        elementPointer: operationPointer(key, "parameters"),
        rationale: `The operation accepts ${list.length === 1 ? "an input that looks" : "inputs that look"} like a URL (${list.map((name) => `"${name}"`).join(", ")}). If the service fetches or redirects to it, it may be exposed to server-side request forgery. ApiPilot makes no detection claim here: it has no controlled callback verification, so this is only a place to look.`,
        origin: originOf(operation),
        categoryId: "ssrf-unsafe-consumption",
      });
    }
    return drafts;
  },
};
