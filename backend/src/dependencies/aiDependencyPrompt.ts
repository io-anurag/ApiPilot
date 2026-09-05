import type { ApiModel, InferenceRequest } from "@apipilot/shared-domain";

/** Response-shape version the AI is asked to produce and `parseAIDependencyResponse` validates against. */
export const AI_DEPENDENCY_RESPONSE_VERSION = 1;

/**
 * Feature-specific AI timeout (research.md): shorter than the global 60s default so a slow or
 * unavailable provider cannot blow the SC-008 15-second analysis budget.
 */
export const AI_DEPENDENCY_TIMEOUT_MS = 8000;

/** Builds the JSON prompt string sent to the AI provider for one dependency-analysis batch. */
export function buildAIDependencyPrompt(apiModel: ApiModel): string {
  return JSON.stringify({
    responseVersion: AI_DEPENDENCY_RESPONSE_VERSION,
    task:
      "Suggest additional API dependency relationships (a producer operation's response field " +
      "feeding a consumer operation's request field) that field-name matching alone cannot find, " +
      "such as semantically related fields with dissimilar names. Do not invent operations or " +
      "fields that are not present in apiModel.",
    apiModel,
    output: {
      candidates: "array of structured candidates",
      requiredFields: ["candidateId", "producer", "consumer", "rationale", "confidence"],
    },
  });
}

/** Builds the single batched inference request for one dependency-analysis run (research.md). */
export function buildAIDependencyRequest(requestId: string, apiModel: ApiModel): InferenceRequest {
  return {
    contractVersion: 1,
    requestId,
    input: buildAIDependencyPrompt(apiModel),
    expectedOutputFormat: "json",
    timeoutMs: AI_DEPENDENCY_TIMEOUT_MS,
  };
}
