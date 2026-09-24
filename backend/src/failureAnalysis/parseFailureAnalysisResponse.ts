import type {
  FailureAnalysisConclusion,
  FailureCause,
  InferenceResponse,
} from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { extractJsonObjects, stripCodeFence } from "../ai/jsonResponseParsing";
import {
  FAILURE_ANALYSIS_MIN_CONFIDENCE,
  FAILURE_ANALYSIS_RESPONSE_VERSION,
} from "./failureAnalysisPrompt";

/**
 * Parse, shape-validate, semantically validate and conclude one failure-analysis answer
 * (specs/030-ai-failure-analysis research D7; constitution IV). Messages are fixed strings: raw
 * model output is never echoed into an error or a log.
 */

export const SUMMARY_MAX_CHARS = 400;
export const STEP_MAX_CHARS = 200;
export const MAX_STEPS = 3;

const CAUSES: readonly FailureCause[] = [
  "specification-mismatch",
  "environment-issue",
  "downstream-service-issue",
];

export interface ParsedFailureAnalysis {
  conclusion: FailureAnalysisConclusion;
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
      if (isRecord(parsed) && "cause" in parsed) return parsed;
    } catch {
      // Try the next candidate; an unparseable answer is rejected below.
    }
  }
  throw invalid("The model's answer was not a JSON failure analysis.");
}

function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(" ", limit - 1);
  return `${text.slice(0, cut > 0 ? cut : limit - 1)}…`;
}

export function parseFailureAnalysisResponse(
  response: InferenceResponse,
  evidenceIds: ReadonlySet<string>,
): ParsedFailureAnalysis {
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

  const cause = answer.cause;
  const modelReportedInsufficient = cause === "insufficient-evidence";
  if (!modelReportedInsufficient && !CAUSES.includes(cause as FailureCause)) {
    throw invalid("The model's answer named an unknown cause.");
  }
  const confidence = answer.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw invalid("The model's answer had no valid confidence between 0 and 1.");
  }
  if (typeof answer.summary !== "string" || answer.summary.trim().length === 0) {
    throw invalid("The model's answer had no summary.");
  }
  if (!Array.isArray(answer.steps) || !answer.steps.every((step) => typeof step === "string")) {
    throw invalid("The model's answer had no list of investigation steps.");
  }
  if (!Array.isArray(answer.evidenceIds) || !answer.evidenceIds.every((id) => typeof id === "string")) {
    throw invalid("The model's answer had no list of cited evidence ids.");
  }

  const investigationSteps = (answer.steps as string[])
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
    .slice(0, MAX_STEPS)
    .map((step) => truncateAtWord(step, STEP_MAX_CHARS));
  if (!modelReportedInsufficient && investigationSteps.length === 0) {
    throw invalid("The model named a cause but gave no investigation steps.");
  }

  const citedEvidenceIds = [...new Set(answer.evidenceIds as string[])].filter((id) => evidenceIds.has(id));
  const summary = truncateAtWord(answer.summary.trim(), SUMMARY_MAX_CHARS);

  let conclusion: FailureAnalysisConclusion;
  if (modelReportedInsufficient) {
    conclusion = { kind: "insufficient-evidence", reason: "model-reported", confidence };
  } else if (confidence < FAILURE_ANALYSIS_MIN_CONFIDENCE) {
    conclusion = { kind: "insufficient-evidence", reason: "below-confidence-threshold", confidence };
  } else if (citedEvidenceIds.length === 0) {
    conclusion = { kind: "insufficient-evidence", reason: "no-valid-evidence-cited", confidence };
  } else {
    conclusion = { kind: "likely-cause", cause: cause as FailureCause, confidence };
  }

  return { conclusion, summary, investigationSteps, citedEvidenceIds };
}
