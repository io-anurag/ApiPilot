import type { AIScenarioCandidate, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";

interface ParsedResponse {
  responseVersion: 1;
  candidates: unknown[];
}

/** Parses and structurally validates a raw AIProvider inference response into a candidate list; throws `AIProviderError` for a provider error, empty content, invalid JSON, or an unsupported response shape. */
export function parseAIScenarioResponse(response: InferenceResponse): ParsedResponse {
  if (response.status === "error") {
    throw new AIProviderError(
      response.errorCategory ?? "INVALID_RESPONSE",
      response.errorMessage ?? "AI provider returned an error",
    );
  }
  if (!response.content)
    throw new AIProviderError("INVALID_RESPONSE", "AI response was empty");

  let value: unknown;
  try {
    value = JSON.parse(response.content);
  } catch {
    throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
  }
  if (
    !isRecord(value) ||
    value.responseVersion !== 1 ||
    !Array.isArray(value.candidates)
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response did not match the supported response shape",
    );
  }
  if (!value.candidates.every((candidate) => isRecord(candidate))) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response contained a malformed candidate",
    );
  }
  return { responseVersion: 1, candidates: value.candidates };
}

/** Type guard confirming `value` has every field an `AIScenarioCandidate` requires, without checking whether they reference real operation/schema content. */
export function isCandidateShape(value: unknown): value is AIScenarioCandidate {
  if (!isRecord(value)) return false;
  return (
    typeof value.candidateId === "string" &&
    value.candidateId.trim().length > 0 &&
    typeof value.operationPath === "string" &&
    typeof value.operationMethod === "string" &&
    typeof value.category === "string" &&
    isRecord(value.request) &&
    Array.isArray(value.assertions) &&
    typeof value.rationale === "string" &&
    typeof value.confidence === "number" &&
    Array.isArray(value.assumptions)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
