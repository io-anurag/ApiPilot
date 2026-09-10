import type {
  AIErrorCategory,
  AIProvider,
  ApiModel,
  ApiOperation,
  DependencyAIOutcome,
  DependencyAnalysisResult,
} from "@apipilot/shared-domain";
import {
  AI_DEPENDENCY_MAX_OUTPUT_TOKENS,
  AI_DEPENDENCY_TIMEOUT_MS,
  buildAIDependencyPrompt,
  buildAIDependencyRequest,
} from "./aiDependencyPrompt";
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
import { loadAIConfig, CHARS_PER_TOKEN_ESTIMATE } from "../ai/modelConfig";
import { estimateViability } from "../ai/viability";
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
  /**
   * Overrides `ANALYSIS_TIMEOUT_MS` for this call only; test-only hook (T026). Governs only
   * deterministic matching and workflow assembly (FR-033) — see `aiRunBudgetMs` for the
   * AI-assisted pass's own ceiling, which this no longer shares.
   */
  timeoutMs?: number;
  /**
   * Overrides the configured dependency-analysis AI run ceiling
   * (`InferencePlanningConfig.dependencyRunBudgetMs`) for this call only; test-only hook
   * (specs/014-ai-batching-policy FR-033, T056).
   */
  aiRunBudgetMs?: number;
  /**
   * Overrides the configured dependency-analysis unit size
   * (`InferencePlanningConfig.dependencyOperationsPerUnit`) for this call only; test-only hook
   * (specs/014-ai-batching-policy FR-029, T054/T055).
   */
  maxOperationsPerBatch?: number;
  /**
   * Overrides `AI_DEPENDENCY_TIMEOUT_MS` — the per-request budget the pre-flight viability check
   * compares a unit's projected cost against — for this call only; test-only hook (T059).
   */
  perRequestBudgetMs?: number;
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

/** Mirrors enhanceTestModel.ts's own batch-request-id scheme, extended with a retry suffix. */
function createBatchRequestId(
  requestId: string,
  batchCount: number,
  batchIndex: number,
  retryAttempt: number,
): string {
  if (batchCount === 1) {
    return retryAttempt > 0 ? `${requestId}-retry${retryAttempt}` : requestId;
  }
  const retrySuffix = retryAttempt > 0 ? `-retry${retryAttempt}` : "";
  return `${requestId}-batch${batchIndex}${retrySuffix}`;
}

/**
 * Runs one batch's inference call and returns its validated, executable AI relationships.
 * `retryAttempt > 0` (the retry `runBatchedInference`'s `retryFailedBatches` triggers after a
 * malformed reply) appends the same corrective instruction `enhanceTestModel.ts` uses on its own
 * retry — the first attempt's failure is otherwise invisible to the model, so it has no reason to
 * behave differently the second time.
 */
async function runOneBatch(
  batch: Batch<ApiOperation>,
  apiModel: ApiModel,
  requestId: string,
  provider: AIProvider,
  retryAttempt: number,
): Promise<DependencyAnalysisResult["graph"]["relationships"]> {
  const request = buildAIDependencyRequest(requestId, withOperations(apiModel, batch.operations));
  if (retryAttempt > 0) {
    request.input +=
      "\nIMPORTANT: Your previous response was invalid. Return only one compact, valid JSON " +
      "object with a candidates array. Do not include markdown, explanations, or trailing text.";
  }
  const response = await provider.infer(request);
  const parsed = parseAIDependencyResponse(response);
  const seenCandidateIds = new Set<string>();
  const aiRelationships: DependencyAnalysisResult["graph"]["relationships"] = [];
  for (const rawCandidate of parsed.candidates) {
    const shapeFindings = validateAIDependencyCandidateShape(rawCandidate);
    if (shapeFindings.length > 0) continue;
    if (!isDependencyCandidateShape(rawCandidate)) continue;
    if (seenCandidateIds.has(rawCandidate.candidateId)) continue;
    seenCandidateIds.add(rawCandidate.candidateId);
    // Validated against the full, untouched `apiModel` — never `withOperations(apiModel,
    // batch.operations)` — so narrowing the prompt (T051) narrows only the model's *view*; a
    // candidate is still rejected on exactly the same evidence as before if it references
    // anything outside the real contract (T053, constitution XV).
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
 * Explains why a relationship spanning a unit boundary cannot be inferred by this pass (FR-034,
 * T057): batching this specification into more than one unit means a producer and consumer whose
 * operations landed in different units were never shown to the model together, so their absence
 * from the result must not be read as a confirmed absence — only deterministic matching and
 * within-unit AI pairing were actually checked.
 */
function batchingLimitationMessage(batchCount: number): string | undefined {
  if (batchCount <= 1) return undefined;
  return (
    `The AI-assisted pass ran across ${batchCount} separate units. A relationship whose producer ` +
    "and consumer operations landed in different units could not be checked by AI and is not " +
    "confirmed absent — only deterministic matching and within-unit AI pairing were checked."
  );
}

/** The median of `values`, robust to a single outlier in either direction; 0 for an empty input. */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Runs the AI-assisted pass (FR-005): the specification's operations are split into one or
 * more work-and-character-bounded batches (FR-004, FR-009, FR-012 via `provider.getInputBudget()`,
 * FR-028/FR-029 via `maxOperationsPerBatch`), each sent sequentially through `provider.infer()`
 * (FR-003), validated candidate by candidate (shape then semantics, mirroring
 * `enhanceTestModel.ts`'s pipeline), and merged with the deterministic relationships. Never
 * throws — an unavailable, slow, or invalid provider degrades to the deterministic-only result
 * with an explicit outcome (FR-018); a partially-successful run retains every successful batch's
 * relationships (FR-007, FR-030).
 *
 * `isTimedOut` enforces this pass's own run ceiling (FR-033) rather than the overall analysis
 * budget: once it reports true, remaining batches are "not-attempted" rather than run unbounded,
 * and `ANALYSIS_TIMEOUT_MS` remains free to govern only deterministic matching and workflow
 * assembly, undisturbed by however long this pass takes.
 */
async function runAIAssistedPass(
  apiModel: ApiModel,
  deterministicRelationships: DependencyAnalysisResult["graph"]["relationships"],
  provider: AIProvider,
  requestId: string,
  isTimedOut: () => boolean,
  maxOperationsPerBatch: number | undefined,
  viability: {
    perRequestBudgetMs: number;
    prefillMsPerToken: number;
    decodeMsPerToken: number;
    safetyFactor: number;
  },
): Promise<{
  relationships: DependencyAnalysisResult["graph"]["relationships"];
  aiOutcome: DependencyAIOutcome;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
  aiBatchingLimitation?: string;
  notViable?: { projectedMs: number; budgetMs: number };
}> {
  const budgetChars = await provider.getInputBudget(AI_DEPENDENCY_MAX_OUTPUT_TOKENS);
  const batches = splitOperationsIntoBatches(
    apiModel.operations,
    (operations) => buildAIDependencyPrompt(withOperations(apiModel, operations)),
    budgetChars,
    maxOperationsPerBatch,
  );

  // Pre-flight refusal (specs/014-ai-batching-policy, mirroring enhanceTestModel.ts's own
  // viability check): a *typical* unit's cost represents the whole run, so if it cannot fit a
  // single request's budget, none of the others can either, and running each one anyway just
  // spends real minutes rediscovering what the projection already knows (AI_DEPENDENCY_TIMEOUT_MS's
  // own doc comment: even a single-operation unit's prefill alone measures ~9.9s on the reference
  // hardware).
  //
  // Uses the *median* batch's prompt size rather than the worst, unlike enhancement: enhancement's
  // units are uniform by construction, so its max and its typical unit are the same thing.
  // Dependency analysis's units are not — FR-011 deliberately isolates one oversized operation into
  // its own batch rather than dropping it, specifically so that operation can fail on its own via
  // the provider's fast, synchronous exact-fit guard without blocking every other batch. Sizing the
  // whole-run estimate by that one outlier's batch would refuse the entire pass over a single
  // anomalous operation — exactly what FR-011 exists to prevent — and an outlier can still land in
  // an undersized batch for other reasons (a tight `budgetChars`, an odd remainder at the end), so
  // filtering by batch size alone cannot reliably tell "the outlier's batch" apart from "every
  // batch, including the outlier's." The median is robust to a single such outlier in either
  // direction without needing to identify it explicitly.
  const promptCharsPerBatch = batches.map(
    (batch) => buildAIDependencyPrompt(withOperations(apiModel, batch.operations)).length,
  );
  const medianPromptChars = medianOf(promptCharsPerBatch);
  const estimate = estimateViability({
    promptTokens: Math.ceil(medianPromptChars / CHARS_PER_TOKEN_ESTIMATE),
    maxOutputTokens: AI_DEPENDENCY_MAX_OUTPUT_TOKENS,
    rates: {
      prefillMsPerToken: viability.prefillMsPerToken,
      decodeMsPerToken: viability.decodeMsPerToken,
    },
    budgetMs: viability.perRequestBudgetMs,
    safetyFactor: viability.safetyFactor,
  });
  if (!estimate.viable) {
    logger.warn("ai_pass_refused_not_viable", {
      promptTokens: estimate.promptTokens,
      maxOutputTokens: estimate.maxOutputTokens,
      projectedMs: Math.round(estimate.projectedMs),
      budgetMs: estimate.budgetMs,
      totalUnits: batches.length,
    });
    return {
      relationships: deterministicRelationships,
      aiOutcome: "unavailable",
      aiErrorMessage:
        `The local AI model would need about ${Math.ceil(estimate.projectedMs / 1000)}s per ` +
        `unit, more than the configured ${Math.ceil(estimate.budgetMs / 1000)}s budget. ` +
        "Deterministic relationships were used instead; nothing was run, so no time was spent waiting.",
      notViable: { projectedMs: estimate.projectedMs, budgetMs: estimate.budgetMs },
    };
  }

  const aiBatchingLimitation = batchingLimitationMessage(batches.length);

  const summary = await runBatchedInference(
    batches,
    (batch, attempt) => {
      const index = batches.indexOf(batch);
      const batchRequestId = createBatchRequestId(requestId, batches.length, index, attempt);
      return runOneBatch(batch, apiModel, batchRequestId, provider, attempt);
    },
    // One immediate retry per failed batch, matching enhanceTestModel.ts's own batch loop: a
    // unit that comes back as malformed JSON (INVALID_RESPONSE) is far more common here than for
    // enhancement, since a unit's reply must describe relationships across several operations at
    // once rather than one operation in isolation — a single retry absorbs a one-off bad
    // generation without masking a genuinely broken/unavailable provider (still only 1 retry per
    // batch, not a blanket doubling of every call).
    { isTimedOut, retryFailedBatches: 1 },
  );

  const aiRelationships = summary.runs.flatMap((run) => run.data ?? []);
  const relationships = mergeDeterministicAndAI(
    deterministicRelationships,
    aiRelationships,
  );
  if (summary.outcome === "success") {
    return { relationships, aiOutcome: "success", aiBatchingLimitation };
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
    aiBatchingLimitation,
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
  let aiBatchingLimitation: string | undefined;
  let notViable: { projectedMs: number; budgetMs: number } | undefined;
  /** Wall-clock spent inside the AI-assisted pass, excluded from the budget guard below. */
  let aiElapsedMs = 0;

  if (provider) {
    const planning = loadAIConfig().planning;
    const aiRunBudgetMs = options.aiRunBudgetMs ?? planning.dependencyRunBudgetMs;
    const maxOperationsPerBatch =
      options.maxOperationsPerBatch ?? planning.dependencyOperationsPerUnit;
    const perRequestBudgetMs = options.perRequestBudgetMs ?? AI_DEPENDENCY_TIMEOUT_MS;
    const aiStartedAt = Date.now();
    const aiResult = await runAIAssistedPass(
      apiModel,
      deterministicRelationships,
      provider,
      requestId,
      // This pass's own run ceiling (FR-033) — independent of `timeoutMs` above, which governs
      // only deterministic matching and workflow assembly.
      () => Date.now() - aiStartedAt > aiRunBudgetMs,
      maxOperationsPerBatch,
      {
        perRequestBudgetMs,
        prefillMsPerToken: planning.prefillMsPerToken,
        decodeMsPerToken: planning.decodeMsPerToken,
        safetyFactor: planning.viabilitySafetyFactor,
      },
    );
    aiElapsedMs = Date.now() - aiStartedAt;
    relationships = aiResult.relationships;
    aiOutcome = aiResult.aiOutcome;
    aiErrorCategory = aiResult.aiErrorCategory;
    aiErrorMessage = aiResult.aiErrorMessage;
    aiBatchingLimitation = aiResult.aiBatchingLimitation;
    notViable = aiResult.notViable;
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
    aiBatchingLimitation,
    notViable,
  };
}
