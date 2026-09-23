import type { AIScenarioCandidate, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { extractJsonObjects, stripCodeFence } from "../ai/jsonResponseParsing";
import { AI_SCENARIO_RESPONSE_VERSION } from "./aiScenarioPrompt";

interface ParsedResponse {
  responseVersion: number;
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

  const normalized = stripCodeFence(response.content);
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    const extractedObjects = extractJsonObjects(normalized);
    if (extractedObjects.length === 0) {
      throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
    }
    const parsedObject = extractedObjects
      .map((object) => {
        try {
          return JSON.parse(object) as unknown;
        } catch {
          return undefined;
        }
      })
      .find((candidate) => candidate !== undefined && isResponseValue(candidate));
    if (parsedObject === undefined) {
      throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
    }
    value = parsedObject;
  }
  let candidates: unknown[];
  let declaredVersion: unknown;
  if (Array.isArray(value)) {
    candidates = value;
    declaredVersion = undefined;
  } else if (isRecord(value) && Array.isArray(value.candidates)) {
    candidates = value.candidates;
    declaredVersion = value.responseVersion;
  } else if (isCandidateShape(value)) {
    // Small instruction models sometimes omit the outer document and emit the one candidate
    // directly. It is safe to repair this shape because the candidate still goes through the
    // normal structural and semantic validation pipeline in enhanceTestModel.
    candidates = [value];
    declaredVersion = undefined;
  } else {
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
  const responseVersion = declaredVersion ?? AI_SCENARIO_RESPONSE_VERSION;
  if (
    typeof responseVersion !== "number" ||
    (responseVersion !== AI_SCENARIO_RESPONSE_VERSION && responseVersion !== 1)
  ) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response declared an unsupported response version",
    );
  }
  if (!candidates.every((candidate) => isRecord(candidate))) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI response contained a malformed candidate",
    );
  }
  return { responseVersion, candidates };
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

function isResponseValue(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.every((candidate) => isRecord(candidate))) ||
    (isRecord(value) && Array.isArray(value.candidates)) ||
    isCandidateShape(value)
  );
}
