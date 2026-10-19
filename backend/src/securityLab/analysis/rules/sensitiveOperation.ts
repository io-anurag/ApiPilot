import { describeOperationSensitivity, isStateChangingMethod } from "../sensitivity";
import { operationPointer, originOf, type DraftObservation, type ObservationRule } from "./types";

/**
 * `sensitive-operation` (contracts/generation-and-analysis-rules.md section 2). An operation looks sensitive
 * for named reasons only: a delete, a path segment from a fixed list, or a resource identifier parameter.
 * Looking sensitive is never a risk by itself. It matters only against the effective requirement: with one in
 * force it is informational; declared public or with nothing declared it needs context; a state-changing
 * operation declared public on purpose is a potential risk to confirm, never a vulnerability claim.
 */
export const sensitiveOperationRule: ObservationRule = {
  id: "sensitive-operation",
  run(context) {
    const drafts: DraftObservation[] = [];
    for (const { operation, key } of context.operations) {
      const sensitivity = describeOperationSensitivity(operation);
      if (sensitivity.bases.length === 0) continue;
      const effective = context.effective.get(key);
      const source = effective?.source ?? "unknown";
      let classification: DraftObservation["classification"] = "informational";
      let consequence = "A security requirement applies to it, so this is informational.";
      if (source === "explicit-public") {
        classification = isStateChangingMethod(operation.method) ? "potential-risk" : "requires-context";
        consequence =
          classification === "potential-risk"
            ? "It is declared public and changes state: confirm that is intended."
            : "It is declared public: confirm that is intended.";
      } else if (source === "none-declared") {
        classification = "requires-context";
        consequence = "No requirement is declared for it, so the specification cannot say whether it is protected.";
      } else if (source === "unknown") {
        classification = "not-measurable";
        consequence = "The input does not record security requirements, so protection cannot be assessed.";
      }
      drafts.push({
        ruleId: "sensitive-operation",
        classification,
        operationKey: key,
        elementPointer: operationPointer(key, "security"),
        rationale: `The operation looks sensitive because ${sensitivity.detail.join("; ")}. ${consequence}`,
        basis: sensitivity.bases[0],
        origin: originOf(operation),
      });
    }
    return drafts;
  },
};
