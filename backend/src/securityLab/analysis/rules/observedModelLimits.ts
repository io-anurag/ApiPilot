import type { FactOrigin } from "@apipilot/shared-domain";
import type { DraftObservation, ObservationRule } from "./types";

/**
 * `observed-model-limits`: HAR and definition input record no security requirements (their operations have no
 * `securitySource`), so authentication cannot be assessed from them. One specification-wide observation says so
 * and carries the model's own origin label; no operation is called unauthenticated (FR-011).
 */
export const observedModelLimitsRule: ObservationRule = {
  id: "observed-model-limits",
  run(context) {
    const operations = context.operations;
    if (operations.length === 0 || !operations.every(({ operation }) => operation.securitySource === undefined)) return [];

    const origins = new Set(
      operations.map(({ operation }) => operation.provenance?.origin).filter((origin): origin is FactOrigin => origin !== undefined),
    );
    let origin: FactOrigin = "declared";
    if (origins.has("observed")) origin = "observed";
    else if (origins.has("inferred")) origin = "inferred";

    const draft: DraftObservation = {
      ruleId: "observed-model-limits",
      classification: "not-measurable",
      elementPointer: "/operations",
      rationale:
        origin === "declared"
          ? "This model comes from an API definition, which does not record where each security requirement was declared, so effective security cannot be assessed and no operation is called unprotected."
          : "This model was built from captured traffic. A capture shows what one session did, not what the API requires, so effective security cannot be assessed and no operation is called unauthenticated. Facts here are labelled observed or inferred, never documented.",
      origin,
      categoryId: "authentication",
    };
    return [draft];
  },
};
