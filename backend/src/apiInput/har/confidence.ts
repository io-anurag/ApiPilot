import { OBSERVED_EVIDENCE_MIN_OBSERVATIONS, type FactConfidence, type FactProvenance } from "@apipilot/shared-domain";

/**
 * The confidence indication of an observed or inferred fact (specs/056 FR-028, research R7). A pure
 * function of how often the fact was observed and whether the observations agreed: `high` at the
 * evidence threshold (3) or more and consistent, `medium` at 2, `low` at 1 or whenever they conflict.
 */
export function confidenceOf(observationCount: number, consistent = true): FactConfidence {
  if (!consistent || observationCount < 2) return "low";
  if (observationCount >= OBSERVED_EVIDENCE_MIN_OBSERVATIONS) return "high";
  return "medium";
}

/** Provenance for a fact that was seen (`observed`) or derived from what was seen (`inferred`). */
export function provenanceOf(origin: "observed" | "inferred", observationCount: number, consistent = true): FactProvenance {
  return { origin, observationCount, confidence: confidenceOf(observationCount, consistent) };
}
