import type {
  AIErrorCategory,
  AIProvider,
  ApiModel,
  ApiOperation,
  DependencyAIOutcome,
  DependencyAnalysisResult,
} from "@apipilot/shared-domain";
import { buildAIDependencyPrompt, buildAIDependencyRequest } from "./aiDependencyPrompt";
import {
  runBatchedInference,
  splitOperationsIntoBatches,
  type Batch,
} from "../ai/requestBatching";
import { assembleWorkflows } from "./assembleWorkflows";
import { computeDeterministicRelationships } from "./deterministicMatching";
import { analysisRequestId } from "./identifiers";
import { candidateToAIRelationship, mergeDeterministicAndAI } from "./mergeRelationships";
import {
  isDependencyCandidateShape,
  parseAIDependencyResponse,
} from "./parseAIDependencyResponse";
import {
  validateAIDependencyCandidateSemantics,
  validateAIDependencyCandidateShape,
} from "./validateAIDependencyCandidate";
import { createLogger } from "../logger";

const logger = createLogger("dependencies.analyze");

/** Thrown when analysis and workflow assembly cannot complete within the performance budget (SC-008). */
export class DependencyAnalysisTimeoutError extends Error {
  constructor() {
    super("Dependency analysis did not complete within the performance budget.");
    this.name = "DependencyAnalysisTimeoutError";
  }
}

/** Default wall-clock budget for the deterministic-analysis-plus-workflow-assembly pipeline (SC-008). */
export const ANALYSIS_TIMEOUT_MS = 15_000;

/** Options for one `analyzeDependencies` call. */
export interface AnalyzeDependenciesOptions {
  /** Overrides `ANALYSIS_TIMEOUT_MS` for this call only; test-only hook (T026). */
  timeoutMs?: number;
}

/** Fraction-of-batches suffix (e.g. " for 1 of 3 batches"), omitted entirely for a single batch. */
function batchFraction(
  failedOrNotAttemptedCount: number,
  totalBatchCount: number,
): string {
  return totalBatchCount > 1
    ? ` for ${failedOrNotAttemptedCount} of ${totalBatchCount} batches`
    : "";
}

function providerErrorMessage(
  category: string,
  outcome: DependencyAIOutcome,
  failedOrNotAttemptedCount: number,
  totalBatchCount: number,
): string {
  const fraction = batchFraction(failedOrNotAttemptedCount, totalBatchCount);
  const preserved =
    outcome === "partial"
      ? "deterministic relationships and partial AI results were preserved"
      : "deterministic relationships were preserved";
  if (category === "TIMEOUT") {
    return `AI provider timed out${fraction}; ${preserved}`;
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return `AI provider is unavailable${fraction}; ${preserved}`;
  }
  return `AI provider returned invalid output${fraction}; ${preserved}`;
}

function withOperations(apiModel: ApiModel, operations: ApiOperation[]): ApiModel {
  return { ...apiModel, operations };
}

/** Runs one batch's inference call and returns its validated, executable AI relationships. */
async function runOneBatch(
  batch: Batch<ApiOperation>,
  apiModel: ApiModel,
  requestId: string,
  provider: AIProvider,
): Promise<DependencyAnalysisResult["graph"]["relationships"]> {
  const response = await provider.infer(
    buildAIDependencyRequest(requestId, withOperations(apiModel, batch.operations)),
  );
  const parsed = parseAIDependencyResponse(response);
  const seenCandidateIds = new Set<string>();
  const aiRelationships: DependencyAnalysisResult["graph"]["relationships"] = [];
  for (const rawCandidate of parsed.candidates) {
    const shapeFindings = validateAIDependencyCandidateShape(rawCandidate);
    if (shapeFindings.length > 0) continue;
    if (!isDependencyCandidateShape(rawCandidate)) continue;
    if (seenCandidateIds.has(rawCandidate.candidateId)) continue;
    seenCandidateIds.add(rawCandidate.candidateId);
    const semanticFindings = validateAIDependencyCandidateSemantics(
      rawCandidate,
      apiModel,
    );
    if (semanticFindings.length > 0) continue;
    aiRelationships.push(
      candidateToAIRelationship(rawCandidate, {
        modelId: response.modelId,
        provider: response.provider,
      }),
    );
  }
  return aiRelationships;
}

/**
 * Runs the AI-assisted pass (FR-005): the specification's operations are split into one or
 * more character-bounded batches (FR-004, FR-009, FR-012 via `provider.getInputBudget()`),
 * each sent sequentially through `provider.infer()` (FR-003), validated candidate by
 * candidate (shape then semantics, mirroring `enhanceTestModel.ts`'s pipeline), and merged
 * with the deterministic relationships. Never throws — an unavailable, slow, or invalid
 * provider degrades to the deterministic-only result with an explicit outcome (FR-018); a
 * partially-successful run retains every successful batch's relationships (FR-007).
 * `isTimedOut` enforces the existing `ANALYSIS_TIMEOUT_MS` budget between batches (FR-010,
 * research.md Decision 5): once it reports true, remaining batches are "not-attempted"
 * rather than run unbounded.
 */
async function runAIAssistedPass(
  apiModel: ApiModel,
  deterministicRelationships: DependencyAnalysisResult["graph"]["relationships"],
  provider: AIProvider,
  requestId: string,
  isTimedOut: () => boolean,
): Promise<{
  relationships: DependencyAnalysisResult["graph"]["relationships"];
  aiOutcome: DependencyAIOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
}> {
  const budgetChars = await provider.getInputBudget();
  const batches = splitOperationsIntoBatches(
    apiModel.operations,
    (operations) => buildAIDependencyPrompt(withOperations(apiModel, operations)),
    budgetChars,
  );

  let nextBatchIndex = 0;
  const summary = await runBatchedInference(
    batches,
    (batch) => {
      const index = nextBatchIndex++;
      const batchRequestId =
        batches.length > 1 ? `${requestId}-batch${index}` : requestId;
      return runOneBatch(batch, apiModel, batchRequestId, provider);
    },
    { isTimedOut },
  );

  const aiRelationships = summary.runs.flatMap((run) => run.data ?? []);
  const relationships = mergeDeterministicAndAI(
    deterministicRelationships,
    aiRelationships,
  );
  if (summary.outcome === "success") {
    return { relationships, aiOutcome: "success" };
  }

  const category: AIErrorCategory = summary.errorCategory ?? "INVALID_RESPONSE";
  return {
    relationships,
    aiOutcome: summary.outcome,
    aiErrorCategory: category,
    aiErrorMessage: providerErrorMessage(
      category,
      summary.outcome,
      summary.failureCount,
      summary.totalCount,
    ),
  };
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
  logger.info("analysis_start", { operationCount: apiModel.operations.length });
  const deterministicRelationships = computeDeterministicRelationships(apiModel);
  if (Date.now() - startedAt > timeoutMs) {
    logger.error("analysis_error", {
      errorCategory: "timeout",
      durationMs: Date.now() - startedAt,
    });
    throw new DependencyAnalysisTimeoutError();
  }

  let relationships = deterministicRelationships;
  let aiOutcome: DependencyAIOutcome = "skipped";
  let aiErrorCategory: AIErrorCategory | undefined;
  let aiErrorMessage: string | undefined;
  /** Wall-clock spent inside the AI-assisted pass, excluded from the budget guard below. */
  let aiElapsedMs = 0;

  if (provider) {
    const aiStartedAt = Date.now();
    const aiResult = await runAIAssistedPass(
      apiModel,
      deterministicRelationships,
      provider,
      requestId,
      () => Date.now() - startedAt > timeoutMs,
    );
    aiElapsedMs = Date.now() - aiStartedAt;
    relationships = aiResult.relationships;
    aiOutcome = aiResult.aiOutcome;
    aiErrorCategory = aiResult.aiErrorCategory;
    aiErrorMessage = aiResult.aiErrorMessage;
  }

  const { workflows, manualConfirmationCandidates, cycles } =
    assembleWorkflows(relationships);
  // Measures only the deterministic-matching + workflow-assembly work this guard exists to
  // protect (SC-008); the AI pass's own wall-clock is excluded.
  //
  // It previously charged the AI pass's duration to this budget and threw unless a batch had
  // been skipped, which was wrong in both directions: a *successful* AI pass slower than the
  // budget had its result discarded, and — because `withTimeout` cannot preempt a synchronous
  // local inference, so `AI_DEPENDENCY_TIMEOUT_MS` reports lateness rather than preventing it —
  // a single-batch run routinely overran by 3x with nothing skipped, turning the AI pass's
  // deliberate graceful degradation (FR-007/FR-008/FR-018, "never throws") back into a throw
  // that no configuration could avoid.
  const deterministicElapsedMs = Date.now() - startedAt - aiElapsedMs;
  if (deterministicElapsedMs > timeoutMs) {
    logger.error("analysis_error", {
      errorCategory: "timeout",
      durationMs: deterministicElapsedMs,
      totalDurationMs: Date.now() - startedAt,
    });
    throw new DependencyAnalysisTimeoutError();
  }

  logger.info("analysis_finish", {
    relationshipCount: relationships.length,
    aiOutcome,
    durationMs: Date.now() - startedAt,
  });

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
