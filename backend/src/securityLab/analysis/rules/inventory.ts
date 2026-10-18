import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

const VERSION_SEGMENT = /^v\d+(\.\d+)?$/i;

/**
 * `inventory-duplicate-operation`, `inventory-deprecated` and `inventory-version-marker` (API inventory,
 * analysis only). They concern the specification itself. ApiPilot does not discover undocumented deployed
 * endpoints or versions, and these observations never claim to (FR-010).
 */
export const inventoryRule: ObservationRule = {
  id: "inventory",
  run(context) {
    const drafts: DraftObservation[] = [];

    for (const issue of context.apiModel.summary.issues.filter((entry) => entry.kind === "duplicate-operation")) {
      drafts.push({
        ruleId: "inventory-duplicate-operation",
        classification: "potential-risk",
        elementPointer: `/issues/${issue.location}`,
        rationale: `${issue.message}. Two definitions for the same operation make it unclear which one the service implements. This is an inconsistency inside the specification.`,
        origin: "documented",
        categoryId: "api-inventory",
      });
    }

    const versionTokens = new Set<string>();
    for (const { operation, key } of context.operations) {
      if (operation.deprecated === true) {
        drafts.push({
          ruleId: "inventory-deprecated",
          classification: "informational",
          operationKey: key,
          elementPointer: operationPointer(key, "deprecated"),
          rationale:
            "The specification marks the operation deprecated. Deprecated operations that stay deployed enlarge the attack surface, so confirm whether it is still needed.",
          origin: originOf(operation),
          categoryId: "api-inventory",
        });
      }
      for (const segment of operation.path.split("/")) {
        if (VERSION_SEGMENT.test(segment)) versionTokens.add(segment.toLowerCase());
      }
    }

    if (versionTokens.size > 1) {
      const tokens = [...versionTokens].sort();
      drafts.push({
        ruleId: "inventory-version-marker",
        classification: "informational",
        elementPointer: "/paths",
        rationale: `Paths in the specification carry more than one version marker (${tokens.join(", ")}). Confirm which versions are deployed and supported. The specification cannot show versions it does not describe.`,
        origin: "documented",
        categoryId: "api-inventory",
      });
    }
    return drafts;
  },
};
