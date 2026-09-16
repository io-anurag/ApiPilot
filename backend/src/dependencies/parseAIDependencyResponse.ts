import type { AIDependencyCandidate, InferenceResponse } from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { AI_DEPENDENCY_RESPONSE_VERSION } from "./aiDependencyPrompt";

interface ParsedResponse {
  responseVersion: typeof AI_DEPENDENCY_RESPONSE_VERSION;
  candidates: unknown[];
}

/**
 * Strips a markdown code fence around an otherwise-valid JSON document (mirrors
 * parseAIScenarioResponse.ts): instruction-tuned chat models commonly wrap JSON in ```json fences
 * regardless of the system prompt's explicit "no backticks" instruction. Removing a wrapper
 * discards no content and changes no value, it only unwraps.
 */
function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*\n?/, "");
  const closingIndex = withoutOpening.lastIndexOf("```");
  return (
    closingIndex === -1 ? withoutOpening : withoutOpening.slice(0, closingIndex)
  ).trim();
}

/** Returns a balanced JSON object beginning at `start`, if one exists. */
function balancedObjectAt(content: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}" && --depth === 0) {
      return content.slice(start, index + 1);
    }
  }
  return undefined;
}

/** Extracts every balanced JSON object from a model response with surrounding prose. */
function extractJsonObjects(content: string): string[] {
  const objects: string[] = [];
  for (
    let start = content.indexOf("{");
    start >= 0;
    start = content.indexOf("{", start + 1)
  ) {
    const object = balancedObjectAt(content, start);
    if (object) objects.push(object);
  }
  return objects;
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

  const normalized = stripCodeFence(response.content);
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    // Salvages a well-formed JSON object surrounded by prose the model added despite being asked
    // not to (mirrors parseAIScenarioResponse.ts); a genuinely truncated/unterminated document
    // still has no balanced object to find and correctly falls through to INVALID_RESPONSE.
    const extractedObjects = extractJsonObjects(normalized);
    const parsedObject = extractedObjects
      .map((object) => {
        try {
          return JSON.parse(object) as unknown;
        } catch {
          return undefined;
        }
      })
      .find((candidate) => candidate !== undefined && isRecord(candidate) && Array.isArray(candidate.candidates));
    if (parsedObject === undefined) {
      throw new AIProviderError("INVALID_RESPONSE", "AI response was not valid JSON");
    }
    value = parsedObject;
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
