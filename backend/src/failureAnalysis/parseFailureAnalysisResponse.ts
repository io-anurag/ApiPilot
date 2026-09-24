import type {
  FailureAnalysisConclusion,
  FailureCause,
  InferenceResponse,
} from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { extractJsonObjects, stripCodeFence } from "../ai/jsonResponseParsing";
import { FAILURE_ANALYSIS_RESPONSE_VERSION, FAILURE_CAUSE_LABELS } from "./failureAnalysisPrompt";

/**
 * Parse and validate one v4 failure-analysis explanation (specs/030-ai-failure-analysis research
 * D16; constitution IV). The cause is decided by rules (D15), so this only accepts or rejects the
 * AI's explanation of it. Messages are fixed strings: raw model output is never echoed into an
 * error or a log.
 */

export const SUMMARY_MAX_CHARS = 400;
export const STEP_MAX_CHARS = 200;
export const MAX_STEPS = 3;

const CAUSES = Object.keys(FAILURE_CAUSE_LABELS) as FailureCause[];

/**
 * Fixed, literal phrases per cause for the contradiction check (FR-008): the label without its
 * "Potential" prefix, and the enum key. Deliberately literal, so a negated mention of another cause
 * is rejected too; that costs an explanation, never correctness (research D16).
 */
const CAUSE_PHRASES: Readonly<Record<FailureCause, readonly string[]>> = {
  "specification-mismatch": ["specification mismatch", "specification-mismatch"],
  "environment-issue": ["environment issue", "environment-issue"],
  "downstream-service-issue": ["downstream service", "downstream-service"],
};

export interface ParsedFailureExplanation {
  summary: string;
  investigationSteps: string[];
  citedEvidenceIds: string[];
}

function invalid(message: string): AIProviderError {
  return new AIProviderError("INVALID_RESPONSE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(content: string): Record<string, unknown> {
  const candidates = [stripCodeFence(content), ...extractJsonObjects(content)];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && "summary" in parsed) return parsed;
    } catch {
      // Try the next candidate; an unparseable answer is rejected below.
    }
  }
  throw invalid("The model's answer was not a JSON failure explanation.");
}

function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit - 1);
  return `${text.slice(0, cut > 0 ? cut : limit - 1)}…`;
}

/** One to three trimmed, length-capped plain-text steps; objects or an empty list are rejected. */
function readSteps(steps: unknown): string[] {
  if (!Array.isArray(steps) || !steps.every((step) => typeof step === "string")) {
    throw invalid("The model's answer had no list of plain-text investigation steps.");
  }
  const normalized = (steps as string[])
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .slice(0, MAX_STEPS)
    .map((step) => truncateAtWord(step, STEP_MAX_CHARS));
  if (normalized.length === 0) throw invalid("The model's answer gave no investigation steps.");
  return normalized;
}

/** Causes the explanation must not name: every other cause, or all of them when none was decided. */
function forbiddenCauses(conclusion: FailureAnalysisConclusion): FailureCause[] {
  return conclusion.kind === "likely-cause" ? CAUSES.filter((cause) => cause !== conclusion.cause) : CAUSES;
}

/**
 * The contradiction check (FR-008, research D16): whether any text names a cause other than the
 * rule-decided one. Exported so the opt-in evaluation measures contradictions with this exact rule.
 */
export function namesDifferentCause(texts: readonly string[], conclusion: FailureAnalysisConclusion): boolean {
  const lowered = texts.map((text) => text.toLowerCase());
  return forbiddenCauses(conclusion).some((cause) =>
    CAUSE_PHRASES[cause].some((phrase) => lowered.some((text) => text.includes(phrase))),
  );
}

export function parseFailureAnalysisResponse(
  response: InferenceResponse,
  evidenceIds: ReadonlySet<string>,
  conclusion: FailureAnalysisConclusion,
): ParsedFailureExplanation {
  if (response.status === "error") {
    throw new AIProviderError(
      response.errorCategory ?? "PROVIDER_UNAVAILABLE",
      "The AI provider returned an error.",
    );
  }
  if (!response.content || response.content.trim().length === 0) {
    throw invalid("The model returned an empty answer.");
  }

  const answer = parseObject(response.content);
  if (answer.responseVersion !== undefined && answer.responseVersion !== FAILURE_ANALYSIS_RESPONSE_VERSION) {
    throw invalid("The model's answer used an unsupported response version.");
  }
  if (typeof answer.summary !== "string" || answer.summary.trim().length === 0) {
    throw invalid("The model's answer had no summary.");
  }
  const investigationSteps = readSteps(answer.steps);
  if (!Array.isArray(answer.evidenceIds) || !answer.evidenceIds.every((id) => typeof id === "string")) {
    throw invalid("The model's answer had no list of cited evidence ids.");
  }

  const citedEvidenceIds = [...new Set(answer.evidenceIds as string[])].filter((id) => evidenceIds.has(id));
  if (citedEvidenceIds.length === 0) {
    throw invalid("The model's answer cited none of the recorded evidence.");
  }

  const summary = truncateAtWord(answer.summary.trim(), SUMMARY_MAX_CHARS);
  if (namesDifferentCause([summary, ...investigationSteps], conclusion)) {
    throw invalid("The model's answer named a different cause from the one the rules decided.");
  }

  return { summary, investigationSteps, citedEvidenceIds };
}
