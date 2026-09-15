import type { AIDependencyCandidate, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { AI_DEPENDENCY_RESPONSE_VERSION } from "./aiDependencyPrompt";

interface ParsedResponse {
  responseVersion: typeof AI_DEPENDENCY_RESPONSE_VERSION;
  candidates: unknown[];
}

/** Parses a raw InferenceResponse into a candidate list, distinguishing a parse failure from an empty list. */
export function parseAIDependencyResponse(response: InferenceResponse): ParsedResponse {
  if (response.status === "error") {
    throw new AIProviderError(
      response.errorCategory ?? "INVALID_RESPONSE",
      response.errorMessage ?? "AI provider returned an error",
    );
  }
  if (!response.content) throw new AIProviderError("INVALID_RESPONSE", "AI response was empty");

  let value: unknown;
  try {
    value = JSON.parse(response.content);
  } catch {
    throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    throw new AIProviderError("INVALID_RESPONSE", "AI response did not match the supported response shape");
  }
  // An absent `responseVersion` is treated as the current one rather than rejected: the prompt
  // (aiDependencyPrompt.ts's `output` field) never actually asks the model to echo the version
  // back, and small local models routinely omit a field they were not shown an example of —
  // discarding an otherwise well-formed candidate list over a missing constant costs real output
  // for no safety gain. An explicitly *different* version is still refused, since that signals a
  // genuine contract mismatch rather than an omission (mirrors parseAIScenarioResponse.ts).
  if (
    value.responseVersion !== undefined &&
    value.responseVersion !== AI_DEPENDENCY_RESPONSE_VERSION
  ) {
    throw new AIProviderError("INVALID_RESPONSE", "AI response declared an unsupported response version");
  }
  if (!value.candidates.every((candidate) => isRecord(candidate))) {
    throw new AIProviderError("INVALID_RESPONSE", "AI response contained a malformed candidate");
  }
  return { responseVersion: AI_DEPENDENCY_RESPONSE_VERSION, candidates: value.candidates };
}

/** Type guard for one raw candidate's structural shape; does not validate against the ApiModel (see `validateAIDependencyCandidate.ts`). */
export function isDependencyCandidateShape(value: unknown): value is AIDependencyCandidate {
  if (!isRecord(value)) return false;
  const producer = value.producer;
  const consumer = value.consumer;
  return (
    typeof value.candidateId === "string" &&
    value.candidateId.trim().length > 0 &&
    isRecord(producer) &&
    typeof producer.operationPath === "string" &&
    typeof producer.operationMethod === "string" &&
    typeof producer.field === "string" &&
    isRecord(consumer) &&
    typeof consumer.operationPath === "string" &&
    typeof consumer.operationMethod === "string" &&
    typeof consumer.field === "string" &&
    ["path", "query", "header", "body"].includes(consumer.location as string) &&
    typeof value.rationale === "string" &&
    typeof value.confidence === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
