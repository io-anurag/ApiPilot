import type { FailureStrength } from "@apipilot/shared-domain";

/**
 * Strength presentation for AP-031 failure analysis (specs/030-ai-failure-analysis Clarifications
 * 2026-09-24). A rule-decided cause carries its rule's fixed, documented strength. It is shown as a
 * label only, with no number, because a rule has no measured probability.
 */
export function strengthLabel(strength: FailureStrength): "High" | "Moderate" {
  return strength === "high" ? "High" : "Moderate";
}
