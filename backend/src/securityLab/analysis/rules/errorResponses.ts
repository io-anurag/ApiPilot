import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

/** Status codes that already describe a rejected request, so no further 401 or 403 is needed. */
const COVERING = new Set(["401", "403", "default", "4XX", "4xx"]);

/**
 * `documented-error-responses`: an operation that requires credentials but documents no 401 or 403 (nor a
 * `default` or `4XX` response) gives a rejected request no documented shape. Informational only: the
 * specification being silent says nothing about what the service does.
 */
export const errorResponsesRule: ObservationRule = {
  id: "documented-error-responses",
  run(context) {
    const drafts: DraftObservation[] = [];
    for (const { operation, key } of context.operations) {
      const effective = context.effective.get(key);
      if (!effective || (effective.source !== "operation" && effective.source !== "root")) continue;
      if (effective.requirement.length === 0 || effective.requirement.some((entry) => entry.schemes.length === 0)) continue;
      if (operation.responses.some((response) => COVERING.has(response.statusCode))) continue;
      drafts.push({
        ruleId: "documented-error-responses",
        classification: "informational",
        operationKey: key,
        elementPointer: operationPointer(key, "responses"),
        rationale:
          "The operation requires credentials but documents no 401 or 403 response, so a rejected request has no documented shape. This only says what the specification leaves out, not how the service behaves.",
        origin: originOf(operation),
        categoryId: "authentication",
      });
    }
    return drafts;
  },
};
