import type { SchemaConstraint } from "@apipilot/shared-domain";
import { classifyProperty, walkProperties } from "../sensitivity";
import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

/** At most this many property observations per operation and direction, so one large schema cannot bury the list. */
const MAX_PER_DIRECTION = 10;

/**
 * `sensitive-property` (contracts/generation-and-analysis-rules.md section 2, FR-009). A property is reported
 * with the **basis** of its classification. A declared basis (`format: password`, `writeOnly`, or a field the
 * user configured) is informational. A property flagged only by its name is reported as requiring context and
 * never as a confirmed sensitive field.
 */
export const sensitivePropertyRule: ObservationRule = {
  id: "sensitive-property",
  run(context) {
    const drafts: DraftObservation[] = [];
    for (const { operation, key } of context.operations) {
      const directions: Array<{ label: "request" | "response"; element: string; schemas: SchemaConstraint[] }> = [
        {
          label: "request",
          element: "requestBody",
          schemas: Object.values(operation.requestBody?.contentTypes ?? {}),
        },
        {
          label: "response",
          element: "responses",
          schemas: operation.responses.flatMap((response) => Object.values(response.contentTypes)),
        },
      ];
      for (const direction of directions) {
        const seen = new Set<string>();
        let emitted = 0;
        for (const schema of direction.schemas) {
          for (const property of walkProperties(schema)) {
            if (emitted >= MAX_PER_DIRECTION) break;
            const classification = classifyProperty(property.name, property.constraint, context.configuredSensitive);
            if (!classification || seen.has(property.path)) continue;
            seen.add(property.path);
            emitted += 1;
            const declared = classification.basis !== "name-match";
            drafts.push({
              ruleId: "sensitive-property",
              classification: declared ? "informational" : "requires-context",
              operationKey: key,
              elementPointer: operationPointer(key, `${direction.element}/${property.path}`),
              rationale: declared
                ? `The ${direction.label} property "${property.path}" is treated as sensitive because ${classification.detail}.`
                : `The ${direction.label} property "${property.path}" may be sensitive, but ${classification.detail}. It is not treated as a confirmed sensitive field.`,
              basis: classification.basis,
              origin: originOf(operation),
              categoryId: "sensitive-data-exposure",
            });
          }
        }
      }
    }
    return drafts;
  },
};
