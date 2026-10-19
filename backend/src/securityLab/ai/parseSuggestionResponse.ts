import { AIProviderError } from "../../ai/errors";
import { extractJsonObjects, stripCodeFence } from "../../ai/jsonResponseParsing";
import { SECURITY_SUGGESTION_RESPONSE_VERSION } from "./suggestionPrompt";

/**
 * Parses a model's answer into candidate suggestions, one at a time (specs/057 research R17, constitution IV). The
 * answer as a whole must be a JSON object of the right version with a `suggestions` array, or it is rejected with a
 * fixed message (raw model output is never echoed into an error or a log). Each suggestion is then checked only for
 * the *shape* the validator needs; a malformed one is rejected on its own and never affects a valid one beside it.
 * Whether a candidate is safe and grounded is decided by `validateSuggestion`, not here.
 */

export const MAX_SUGGESTIONS = 20;
const MAX_TEXT = 500;
const MAX_ASSUMPTIONS = 10;

export interface SuggestionCandidate {
  readonly operationKey: string;
  readonly categoryId: string;
  readonly title: string;
  readonly objective: string;
  readonly rationale: string;
  readonly impact: string;
  readonly mutations: readonly unknown[];
  readonly expected: { readonly kind: string; readonly ruleId?: string; readonly documentedStatusCodes?: readonly unknown[] };
  readonly conditions: readonly unknown[];
  readonly confidence: number;
  readonly assumptions: readonly string[];
}

export type ParsedSuggestion = { readonly ok: true; readonly index: number; readonly candidate: SuggestionCandidate } | { readonly ok: false; readonly index: number; readonly reason: string };

export interface ParsedSuggestions {
  readonly suggestions: readonly ParsedSuggestion[];
  /** How many suggestions beyond the cap were ignored. */
  readonly ignored: number;
}

const invalid = (message: string) => new AIProviderError("INVALID_RESPONSE", message);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseObject(content: string): Record<string, unknown> {
  for (const candidate of [stripCodeFence(content), ...extractJsonObjects(content)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  throw invalid("The AI answer was not a JSON object.");
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`'${field}' must be a non-empty string.`);
  if (value.length > MAX_TEXT) throw new Error(`'${field}' is longer than ${MAX_TEXT} characters.`);
  return value.trim();
}

function candidateOf(value: unknown): SuggestionCandidate {
  if (!isRecord(value)) throw new Error("A suggestion must be an object.");
  const expected = value.expected;
  if (!isRecord(expected) || typeof expected.kind !== "string") throw new Error("'expected.kind' must be a string.");
  if (!Array.isArray(value.mutations)) throw new Error("'mutations' must be an array.");
  if (!Array.isArray(value.conditions)) throw new Error("'conditions' must be an array.");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("'confidence' must be a number from 0 to 1.");
  const assumptions = value.assumptions ?? [];
  if (!Array.isArray(assumptions) || assumptions.length > MAX_ASSUMPTIONS || assumptions.some((entry) => typeof entry !== "string" || entry.length > MAX_TEXT)) {
    throw new Error("'assumptions' must be a short array of short strings.");
  }
  if (expected.ruleId !== undefined && typeof expected.ruleId !== "string") throw new Error("'expected.ruleId' must be a string.");
  if (expected.documentedStatusCodes !== undefined && !Array.isArray(expected.documentedStatusCodes)) throw new Error("'expected.documentedStatusCodes' must be an array.");
  return {
    operationKey: text(value.operationKey, "operationKey"),
    categoryId: text(value.categoryId, "categoryId"),
    title: text(value.title, "title"),
    objective: text(value.objective, "objective"),
    rationale: text(value.rationale, "rationale"),
    impact: text(value.impact, "impact"),
    mutations: value.mutations,
    expected: { kind: expected.kind, ...(expected.ruleId === undefined ? {} : { ruleId: expected.ruleId }), ...(expected.documentedStatusCodes === undefined ? {} : { documentedStatusCodes: expected.documentedStatusCodes }) },
    conditions: value.conditions,
    confidence: value.confidence,
    assumptions: assumptions as string[],
  };
}

export function parseSuggestionResponse(content: string): ParsedSuggestions {
  const root = parseObject(content);
  if (root.responseVersion !== SECURITY_SUGGESTION_RESPONSE_VERSION) throw invalid("The AI answer was not in the expected format version.");
  if (!Array.isArray(root.suggestions)) throw invalid("The AI answer had no suggestions list.");
  const considered = root.suggestions.slice(0, MAX_SUGGESTIONS);
  const suggestions = considered.map((entry, index): ParsedSuggestion => {
    try {
      return { ok: true, index, candidate: candidateOf(entry) };
    } catch (error) {
      return { ok: false, index, reason: error instanceof Error ? error.message : "The suggestion was malformed." };
    }
  });
  return { suggestions, ignored: root.suggestions.length - considered.length };
}
