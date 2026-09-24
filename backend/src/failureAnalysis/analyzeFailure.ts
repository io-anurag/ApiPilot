import type {
  AIErrorCategory,
  AIProvider,
  FailureAnalysis,
  FailureAnalysisAttempt,
  UploadedCollectionExecutionRun,
} from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { CHARS_PER_TOKEN_ESTIMATE } from "../ai/modelConfig";
import { estimateViability, formatDuration, type ViabilityRates } from "../ai/viability";
import { createLogger } from "../logger";
import { buildEvidence, type EvidenceBuild, type EvidenceOptions } from "./buildEvidence";
import { FailureAnalysisInProgressError, ResultNotFailedError, ResultNotFoundError } from "./errors";
import type { FailureAnalysisStore } from "./failureAnalysisStore";
import {
  FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS,
  FAILURE_ANALYSIS_MIN_CONFIDENCE,
  FAILURE_ANALYSIS_RESPONSE_VERSION,
  FAILURE_ANALYSIS_SYSTEM_PROMPT,
  buildFailureAnalysisPrompt,
  buildFailureAnalysisRequest,
} from "./failureAnalysisPrompt";
import type { InProgressRegistry } from "./inProgressRegistry";
import { matchSpecificationContext, type SpecificationContextSource } from "./matchSpecificationContext";
import { parseFailureAnalysisResponse } from "./parseFailureAnalysisResponse";
import { scanOutput, sensitiveVariableValues } from "./redaction";

/**
 * Orchestrates one on-demand failure analysis (specs/030-ai-failure-analysis FR-001..FR-016).
 * Reads an already-recorded result and never sends a request to the target API (FR-009). Logs
 * carry identifiers, counts and categories only — never evidence, prompt, answer or summary text
 * (constitution XX).
 */

const logger = createLogger("failureAnalysis");

export interface ViabilitySettings {
  rates: ViabilityRates;
  safetyFactor: number;
  /** The per-inference time budget, i.e. the provider's configured timeout. */
  budgetMs: number;
}

export interface AnalyzeFailureDeps {
  provider: AIProvider;
  store: FailureAnalysisStore;
  registry: InProgressRegistry;
  now: () => Date;
  getWorkflow: () => SpecificationContextSource | undefined;
  /** The originating uploaded collection's variables, or `undefined` once it has been removed. */
  getCollectionVariableValues: () => Readonly<Record<string, string>> | undefined;
  viability: ViabilitySettings;
}

export interface AnalyzeFailureInput {
  sessionId: string;
  run: UploadedCollectionExecutionRun;
  resultIndex: number;
}

function plainMessage(category: AIErrorCategory, budgetMs: number): string {
  switch (category) {
    case "NOT_READY":
      return "The local AI model is not available right now. Check the AI status and try again.";
    case "LOAD_FAILED":
      return "The local AI model could not be loaded, so no analysis was produced.";
    case "TIMEOUT":
      return `The local AI model did not finish within ${formatDuration(budgetMs)}. You can try again.`;
    case "INVALID_REQUEST":
      return "This failure's evidence is too large for the local AI model, even after trimming.";
    case "INVALID_RESPONSE":
      return "The local AI model's answer could not be understood, so nothing was stored. You can try again.";
    case "PROVIDER_UNAVAILABLE":
      return "The local AI provider is unavailable, so no analysis was produced.";
  }
}

const TRIM_STEPS: readonly EvidenceOptions[] = [{}, { omitBodies: true }, { omitBodies: true, omitHeaders: true }];

export async function analyzeFailure(
  deps: AnalyzeFailureDeps,
  input: AnalyzeFailureInput,
): Promise<FailureAnalysisAttempt> {
  const { run, resultIndex, sessionId } = input;
  const result = run.results[resultIndex];
  if (!result) throw new ResultNotFoundError(resultIndex);
  if (result.outcome !== "failed") throw new ResultNotFailedError(result.outcome);

  // Check-and-set before the first await, so two requests can never both pass (FR-016).
  if (!deps.registry.tryBegin(sessionId, { runId: run.id, resultIndex, requestName: result.requestName })) {
    const current = deps.registry.get(sessionId);
    throw new FailureAnalysisInProgressError(current?.runId ?? run.id, current?.resultIndex ?? resultIndex);
  }

  const startedAt = Date.now();
  let evidenceCount = 0;
  let outcome: FailureAnalysisAttempt | undefined;
  try {
    const previousAnalysis = deps.store.getAnalysis(run.id, resultIndex);
    const withPrevious = previousAnalysis ? { previousAnalysis } : {};
    const specificationContext = matchSpecificationContext(result, deps.getWorkflow(), run.results, resultIndex);
    const budgetChars = await deps.provider.getInputBudget(FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS);

    let built: EvidenceBuild | undefined;
    let prompt = "";
    for (const options of TRIM_STEPS) {
      built = buildEvidence(result, specificationContext, options);
      prompt = buildFailureAnalysisPrompt({
        requestMethod: result.requestMethod,
        requestName: result.requestName,
        evidence: built.evidence,
        specificationContext,
      });
      if (budgetChars === undefined || prompt.length <= budgetChars) break;
    }
    if (!built || (budgetChars !== undefined && prompt.length > budgetChars)) {
      outcome = {
        status: "ai-failed",
        aiErrorCategory: "INVALID_REQUEST",
        message: plainMessage("INVALID_REQUEST", deps.viability.budgetMs),
        ...withPrevious,
      };
      return outcome;
    }
    evidenceCount = built.evidence.length;

    const estimate = estimateViability({
      promptTokens: Math.ceil((prompt.length + FAILURE_ANALYSIS_SYSTEM_PROMPT.length) / CHARS_PER_TOKEN_ESTIMATE),
      maxOutputTokens: FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS,
      rates: deps.viability.rates,
      budgetMs: deps.viability.budgetMs,
      safetyFactor: deps.viability.safetyFactor,
    });
    if (!estimate.viable) {
      outcome = {
        status: "not-viable",
        notViable: { projectedMs: estimate.projectedMs, budgetMs: estimate.budgetMs },
        message:
          `This analysis is projected to take ${formatDuration(estimate.projectedMs)}, but one local AI ` +
          `request is limited to ${formatDuration(estimate.budgetMs)}.`,
        ...withPrevious,
      };
      return outcome;
    }

    const response = await deps.provider.infer(buildFailureAnalysisRequest(prompt), {
      onStarted: () => deps.registry.markGenerating(sessionId),
    });
    const parsed = parseFailureAnalysisResponse(response, new Set(built.evidence.map((item) => item.id)));

    const sensitiveValues = [
      ...built.sensitiveValues,
      ...sensitiveVariableValues(deps.getCollectionVariableValues()),
    ];
    const analysis: FailureAnalysis = {
      runId: run.id,
      resultIndex,
      requestName: result.requestName,
      requestMethod: result.requestMethod,
      conclusion: parsed.conclusion,
      summary: scanOutput(parsed.summary, sensitiveValues),
      investigationSteps: parsed.investigationSteps.map((step) => scanOutput(step, sensitiveValues)),
      citedEvidenceIds: parsed.citedEvidenceIds,
      evidence: built.evidence,
      specificationContext,
      provenance: {
        source: "AI",
        aiModel: response.modelId,
        aiProvider: response.provider,
        responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
        confidenceThreshold: FAILURE_ANALYSIS_MIN_CONFIDENCE,
        generatedAt: deps.now().toISOString(),
      },
    };
    deps.store.saveAnalysis(analysis);
    outcome = { status: "analyzed", analysis };
    return outcome;
  } catch (error) {
    if (!(error instanceof AIProviderError)) throw error;
    const previousAnalysis = deps.store.getAnalysis(run.id, resultIndex);
    outcome = {
      status: "ai-failed",
      aiErrorCategory: error.category,
      message: plainMessage(error.category, deps.viability.budgetMs),
      ...(previousAnalysis ? { previousAnalysis } : {}),
    };
    return outcome;
  } finally {
    deps.registry.end(sessionId);
    logger.info("failure_analysis_settled", {
      runId: run.id,
      resultIndex,
      status: outcome?.status ?? "error",
      errorCategory: outcome?.status === "ai-failed" ? outcome.aiErrorCategory : undefined,
      conclusion: outcome?.status === "analyzed" ? outcome.analysis.conclusion.kind : undefined,
      evidenceCount,
      durationMs: Date.now() - startedAt,
    });
  }
}
