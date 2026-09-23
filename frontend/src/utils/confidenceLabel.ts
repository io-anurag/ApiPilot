/**
 * Confidence presentation for AP-031 failure analysis (specs/030-ai-failure-analysis Clarifications
 * 2026-09-23). A likely cause always has confidence ≥ 0.5 (the analysis threshold), so two labels
 * cover it; the exact value is shown alongside because a small local model's self-reported
 * confidence is not calibrated enough to stand alone.
 */
export type ConfidenceLabel = "Moderate" | "High";

export function confidenceLabel(confidence: number): ConfidenceLabel {
  return confidence < 0.75 ? "Moderate" : "High";
}

export function formatConfidence(confidence: number): string {
  return `${confidenceLabel(confidence)} (${confidence.toFixed(2)})`;
}
