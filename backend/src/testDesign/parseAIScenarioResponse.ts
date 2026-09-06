import type { AIScenarioCandidate, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { AI_SCENARIO_RESPONSE_VERSION } from "./aiScenarioPrompt";

interface ParsedResponse {
  responseVersion: number;
  candidates: unknown[];
}

/**
 * Strips a markdown code fence around an otherwise-valid JSON document.
 *
 * Instruction-tuned chat models very commonly wrap JSON in ```json fences regardless of being
 * asked not to — measured directly against the default model, which produced a correct document
 * inside a fence. Removing a wrapper is a safe repair in the sense constitution IV intends: it
 * discards no content and changes no value, it only unwraps. Anything beyond this stays a
 * rejection, because guessing at malformed content is how fabricated test data gets in.
 */
function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const closingIndex = withoutOpening.lastIndexOf("```");
  return (closingIndex === -1 ? withoutOpening : withoutOpening.slice(0, closingIndex)).trim();
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
    value = JSON.parse(stripCodeFence(response.content));
  } catch {
    throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response did not match the supported response shape",
    );
  }
  // An absent `responseVersion` is treated as the current one rather than rejected: small local
  // models routinely omit an echoed constant, and discarding an otherwise well-formed set of
  // candidates over a missing version field costs real output for no safety gain. An explicitly
  // *different* version is still refused — that signals a genuine contract mismatch rather than
  // an omission (constitution XXIII).
  const responseVersion = value.responseVersion ?? AI_SCENARIO_RESPONSE_VERSION;
  if (
    typeof responseVersion !== "number" ||
    (responseVersion !== AI_SCENARIO_RESPONSE_VERSION && responseVersion !== 1)
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response declared an unsupported response version",
    );
  }
  if (!value.candidates.every((candidate) => isRecord(candidate))) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response contained a malformed candidate",
    );
  }
  return { responseVersion, candidates: value.candidates };
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
