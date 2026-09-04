import type {
  AIErrorCategory,
  AIProvider,
  ApiModel,
  DependencyAIOutcome,
  DependencyAnalysisResult,
} from "@apipilot/shared-domain";
import { buildAIDependencyRequest } from "./aiDependencyPrompt";
import { AIProviderError } from "../ai/errors";
import { assembleWorkflows } from "./assembleWorkflows";
import { computeDeterministicRelationships } from "./deterministicMatching";
import { analysisRequestId } from "./identifiers";
import { candidateToAIRelationship, mergeDeterministicAndAI } from "./mergeRelationships";
import { isDependencyCandidateShape, parseAIDependencyResponse } from "./parseAIDependencyResponse";
import {
  validateAIDependencyCandidateSemantics,
  validateAIDependencyCandidateShape,
} from "./validateAIDependencyCandidate";

/** Thrown when analysis and workflow assembly cannot complete within the performance budget (SC-008). */
export class DependencyAnalysisTimeoutError extends Error {
  constructor() {
    super("Dependency analysis did not complete within the performance budget.");
    this.name = "DependencyAnalysisTimeoutError";
  }
}

/** Default wall-clock budget for the deterministic-analysis-plus-workflow-assembly pipeline (SC-008). */
export const ANALYSIS_TIMEOUT_MS = 15_000;

export interface AnalyzeDependenciesOptions {
  /** Overrides `ANALYSIS_TIMEOUT_MS` for this call only; test-only hook (T026). */
  timeoutMs?: number;
}

function providerErrorMessage(category: string): string {
  if (category === "TIMEOUT") {
    return "AI provider timed out; deterministic relationships were preserved";
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return "AI provider is unavailable; deterministic relationships were preserved";
  }
  return "AI provider returned invalid output; deterministic relationships were preserved";
}

/**
 * Runs the AI-assisted pass (FR-005): one batched inference call, validated candidate by
 * candidate (shape then semantics, mirroring `enhanceTestModel.ts`'s pipeline), merged with the
 * deterministic relationships. Never throws — an unavailable, slow, or invalid provider degrades
 * to the deterministic-only result with an explicit outcome (FR-018).
 */
async function runAIAssistedPass(
  apiModel: ApiModel,
  deterministicRelationships: DependencyAnalysisResult["graph"]["relationships"],
  provider: AIProvider,
  requestId: string,
): Promise<{
  relationships: DependencyAnalysisResult["graph"]["relationships"];
  aiOutcome: DependencyAIOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
}> {
  try {
    const response = await provider.infer(buildAIDependencyRequest(requestId, apiModel));
    const parsed = parseAIDependencyResponse(response);
    const seenCandidateIds = new Set<string>();
    const aiRelationships: DependencyAnalysisResult["graph"]["relationships"] = [];
    for (const rawCandidate of parsed.candidates) {
      const shapeFindings = validateAIDependencyCandidateShape(rawCandidate);
      if (shapeFindings.length > 0) continue;
      if (!isDependencyCandidateShape(rawCandidate)) continue;
      if (seenCandidateIds.has(rawCandidate.candidateId)) continue;
      seenCandidateIds.add(rawCandidate.candidateId);
      const semanticFindings = validateAIDependencyCandidateSemantics(rawCandidate, apiModel);
      if (semanticFindings.length > 0) continue;
      aiRelationships.push(
        candidateToAIRelationship(rawCandidate, { modelId: response.modelId, provider: response.provider }),
      );
    }
    return {
      relationships: mergeDeterministicAndAI(deterministicRelationships, aiRelationships),
      aiOutcome: "success",
    };
  } catch (error) {
    const category =
      error instanceof AIProviderError
        ? error.category
        : "INVALID_RESPONSE";
    const outcome: DependencyAIOutcome =
      category === "TIMEOUT"
        ? "timeout"
        : category === "PROVIDER_UNAVAILABLE" || category === "NOT_READY" || category === "LOAD_FAILED"
          ? "unavailable"
          : "invalid-response";
    return {
      relationships: deterministicRelationships,
      aiOutcome: outcome,
      aiErrorCategory: category,
      aiErrorMessage: providerErrorMessage(category),
    };
  }
}

/**
 * Orchestrates dependency analysis for one ApiModel (FR-001): deterministic matching, an optional
 * AI-assisted pass, then workflow assembly over the resulting CONFIRMED/LIKELY relationships.
 */
export async function analyzeDependencies(
  apiModel: ApiModel,
  provider?: AIProvider,
  options: AnalyzeDependenciesOptions = {},
): Promise<DependencyAnalysisResult> {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  const startedAt = Date.now();
  const requestId = analysisRequestId(apiModel);
  const deterministicRelationships = computeDeterministicRelationships(apiModel);
  if (Date.now() - startedAt > timeoutMs) throw new DependencyAnalysisTimeoutError();

  let relationships = deterministicRelationships;
  let aiOutcome: DependencyAIOutcome = "skipped";
  let aiErrorCategory: AIErrorCategory | undefined;
  let aiErrorMessage: string | undefined;

  if (provider) {
    const aiResult = await runAIAssistedPass(apiModel, deterministicRelationships, provider, requestId);
    relationships = aiResult.relationships;
    aiOutcome = aiResult.aiOutcome;
    aiErrorCategory = aiResult.aiErrorCategory;
    aiErrorMessage = aiResult.aiErrorMessage;
  }

  const { workflows, manualConfirmationCandidates, cycles } = assembleWorkflows(relationships);
  if (Date.now() - startedAt > timeoutMs) throw new DependencyAnalysisTimeoutError();

  return {
    requestId,
    graph: { relationships },
    workflows,
    manualConfirmationCandidates,
    cycles,
    aiOutcome,
    aiErrorCategory,
    aiErrorMessage,
  };
}
