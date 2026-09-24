import type {
  AIErrorCategory,
  AIProvider,
  FailureAnalysis,
  FailureAnalysisAttempt,
  FailureAnalysisConclusion,
  FailureAnalysisExplanation,
  SpecificationContext,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { AIProviderError } from "../ai/errors";
import { CHARS_PER_TOKEN_ESTIMATE } from "../ai/modelConfig";
import { estimateViability, formatDuration, type ViabilityRates } from "../ai/viability";
import { createLogger } from "../logger";
import { buildEvidence, trimEvidenceForPrompt, type EvidenceBuild, type PromptTrimOptions } from "./buildEvidence";
import { FAILURE_CLASSIFICATION_RULESET_VERSION, classifyFailure } from "./classifyFailure";
import { FailureAnalysisInProgressError, ResultNotFailedError, ResultNotFoundError } from "./errors";
import type { FailureAnalysisStore } from "./failureAnalysisStore";
import {
  FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS,
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
 * Orchestrates one on-demand failure analysis (specs/030-ai-failure-analysis FR-001..FR-018).
 * Reads an already-recorded result and never sends a request to the target API (FR-009). The
 * cause is decided by rules on the full evidence (research D15); the AI only writes the
 * explanation, and an AI failure never blocks the rule result (FR-006, research D17, D18). Logs
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
      return "The local AI model is not available right now, so no explanation was written. Check the AI status and try again.";
    case "LOAD_FAILED":
      return "The local AI model could not be loaded, so no explanation was written.";
    case "TIMEOUT":
      return `The local AI model did not finish within ${formatDuration(budgetMs)}, so no explanation was written. You can try again.`;
    case "INVALID_REQUEST":
      return "This failure's evidence is too large for the local AI model, even after trimming, so no explanation was written.";
    case "INVALID_RESPONSE":
      return "The local AI model's answer could not be used, so no explanation was written. You can try again.";
    case "PROVIDER_UNAVAILABLE":
      return "The local AI provider is unavailable, so no explanation was written.";
  }
}

/** Prompt-only trim steps (research D8 revision): bodies first, then header lists. */
const TRIM_STEPS: readonly PromptTrimOptions[] = [{}, { omitBodies: true }, { omitBodies: true, omitHeaders: true }];

function unavailableFromError(category: AIErrorCategory, budgetMs: number): FailureAnalysisExplanation {
  return {
    status: "unavailable",
    reason: { kind: "ai-error", aiErrorCategory: category },
    message: plainMessage(category, budgetMs),
  };
}

interface ExplainInput {
  sessionId: string;
  result: UploadedRequestResult;
  specificationContext: SpecificationContext;
  built: EvidenceBuild;
  conclusion: FailureAnalysisConclusion;
}

/** Asks the AI to explain the rule-decided conclusion. Never throws for an AI outcome. */
async function explain(deps: AnalyzeFailureDeps, input: ExplainInput): Promise<FailureAnalysisExplanation> {
  const { result, specificationContext, built, conclusion } = input;
  try {
    const budgetChars = await deps.provider.getInputBudget(FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS);
    let prompt: string | undefined;
    let promptEvidenceIds: ReadonlySet<string> = new Set();
    for (const options of TRIM_STEPS) {
      const trimmed = trimEvidenceForPrompt(built.evidence, options);
      const candidate = buildFailureAnalysisPrompt({
        requestMethod: result.requestMethod,
        requestName: result.requestName,
        evidence: trimmed.evidence,
        specificationContext,
        conclusion,
        ...(trimmed.note ? { note: trimmed.note } : {}),
      });
      if (budgetChars === undefined || candidate.length <= budgetChars) {
        prompt = candidate;
        promptEvidenceIds = new Set(trimmed.evidence.map((item) => item.id));
        break;
      }
    }
    if (prompt === undefined) return unavailableFromError("INVALID_REQUEST", deps.viability.budgetMs);

    const estimate = estimateViability({
      promptTokens: Math.ceil((prompt.length + FAILURE_ANALYSIS_SYSTEM_PROMPT.length) / CHARS_PER_TOKEN_ESTIMATE),
      maxOutputTokens: FAILURE_ANALYSIS_MAX_OUTPUT_TOKENS,
      rates: deps.viability.rates,
      budgetMs: deps.viability.budgetMs,
      safetyFactor: deps.viability.safetyFactor,
    });
    if (!estimate.viable) {
      return {
        status: "unavailable",
        reason: { kind: "not-viable", projectedMs: estimate.projectedMs, budgetMs: estimate.budgetMs },
        message:
          `This explanation is projected to take ${formatDuration(estimate.projectedMs)}, but one local AI ` +
          `request is limited to ${formatDuration(estimate.budgetMs)}, so it was not attempted.`,
      };
    }

    const response = await deps.provider.infer(buildFailureAnalysisRequest(prompt), {
      onStarted: () => deps.registry.markGenerating(input.sessionId),
    });
    const parsed = parseFailureAnalysisResponse(response, promptEvidenceIds, conclusion);
    const sensitiveValues = [...built.sensitiveValues, ...sensitiveVariableValues(deps.getCollectionVariableValues())];
    return {
      status: "available",
      summary: scanOutput(parsed.summary, sensitiveValues),
      investigationSteps: parsed.investigationSteps.map((step) => scanOutput(step, sensitiveValues)),
      citedEvidenceIds: parsed.citedEvidenceIds,
      provenance: {
        source: "AI",
        aiModel: response.modelId,
        aiProvider: response.provider,
        responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
      },
    };
  } catch (error) {
    if (!(error instanceof AIProviderError)) throw error;
    return unavailableFromError(error.category, deps.viability.budgetMs);
  }
}

/** The deciding rule id, or `no-rule-matched`, for the settled log line. */
function ruleLabel(conclusion: FailureAnalysisConclusion): string {
  return conclusion.kind === "likely-cause" ? conclusion.ruleId : conclusion.reason;
}

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
    const specificationContext = matchSpecificationContext(result, deps.getWorkflow(), run.results, resultIndex);
    // Built once, in full: the rules read it and it is stored, whatever the input budget (C1).
    const built = buildEvidence(result, specificationContext);
    evidenceCount = built.evidence.length;
    const conclusion = classifyFailure(result, specificationContext, built.evidence);
    const explanation = await explain(deps, { sessionId, result, specificationContext, built, conclusion });

    const analysis: FailureAnalysis = {
      analysisVersion: 2,
      runId: run.id,
      resultIndex,
      requestName: result.requestName,
      requestMethod: result.requestMethod,
      conclusion,
      classificationProvenance: { source: "RULE", ruleSetVersion: FAILURE_CLASSIFICATION_RULESET_VERSION },
      explanation,
      evidence: built.evidence,
      specificationContext,
      analyzedAt: deps.now().toISOString(),
    };

    // A failed re-explanation never overwrites a stored explanation (FR-015, research D18).
    if (explanation.status === "unavailable" && previousAnalysis?.explanation.status === "available") {
      outcome = {
        status: "kept-previous",
        analysis,
        previousAnalysis,
        message: `${explanation.message} The earlier explanation was kept.`,
      };
      return outcome;
    }
    deps.store.saveAnalysis(analysis);
    outcome = { status: "analyzed", analysis };
    return outcome;
  } finally {
    deps.registry.end(sessionId);
    const settled = outcome?.analysis;
    logger.info("failure_analysis_settled", {
      runId: run.id,
      resultIndex,
      status: outcome?.status ?? "error",
      ruleId: settled ? ruleLabel(settled.conclusion) : undefined,
      explanationStatus: settled?.explanation.status,
      errorCategory:
        settled?.explanation.status === "unavailable" && settled.explanation.reason.kind === "ai-error"
          ? settled.explanation.reason.aiErrorCategory
          : undefined,
      evidenceCount,
      durationMs: Date.now() - startedAt,
    });
  }
}
