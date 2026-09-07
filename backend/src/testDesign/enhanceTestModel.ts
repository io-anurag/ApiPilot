import { createHash } from "node:crypto";
import type {
  AICandidateOutcomes,
  AIProvider,
  AIScenarioCandidate,
  ApiOperation,
  EnhancementResult,
  TestModel,
  TestScenario,
} from "@apipilot/shared-domain";
import {
  AI_SCENARIO_MAX_OUTPUT_TOKENS,
  buildAIScenarioRequest,
  buildAIScenarioPrompt,
} from "./aiScenarioPrompt";
import { estimateViability } from "../ai/viability";
import { parseAIScenarioResponse, isCandidateShape } from "./parseAIScenarioResponse";
import {
  validateAICandidateSemantics,
  validateAICandidateShape,
} from "./validateAICandidate";
import { candidateToScenario } from "./aiScenarioCandidate";
import { deduplicate, scenariosAreEquivalent } from "./deduplicate";
import {
  runBatchedInference,
  splitOperationsIntoBatches,
  type Batch,
  type BatchOutcome,
} from "../ai/requestBatching";
import { CHARS_PER_TOKEN_ESTIMATE, loadAIConfig } from "../ai/modelConfig";
import { createLogger } from "../logger";

const logger = createLogger("testDesign.enhanceTestModel");

type ApiModelArg = Parameters<typeof validateAICandidateSemantics>[1];

function withOperations(apiModel: ApiModelArg, operations: ApiOperation[]): ApiModelArg {
  return { ...apiModel, operations };
}

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Scopes the deterministic baseline to the scenarios belonging to `operations`, so a batch's
 * prompt shrinks along with its operation subset instead of always embedding the full,
 * spec-wide baseline regardless of how far `splitOperationsIntoBatches` has split the
 * operations (specs/011-ai-prompt-batching/spec.md Key Entities: "Batch: ... and any other
 * context sent to the AI provider today, e.g. the deterministic baseline for enhancement").
 * Without this, a large specification's baseline dominates every batch's prompt size and
 * batching never actually reduces it below the provider's budget.
 */
function scopeBaselineToOperations(
  testModel: TestModel,
  operations: readonly ApiOperation[],
): TestModel {
  const keys = new Set(operations.map((op) => operationKey(op.path, op.method)));
  return {
    scenarios: testModel.scenarios.filter((scenario) =>
      keys.has(operationKey(scenario.operationPath, scenario.operationMethod)),
    ),
  };
}

/** Fraction-of-batches suffix (e.g. " for 1 of 3 batches"), omitted entirely for a single batch. */
function batchFraction(failedCount: number, totalBatchCount: number): string {
  return totalBatchCount > 1 ? ` for ${failedCount} of ${totalBatchCount} batches` : "";
}

interface BatchScenarioResult {
  candidate: AIScenarioCandidate;
  scenario: ReturnType<typeof candidateToScenario>;
}

/** Runs one batch's inference call and returns its validated, executable AI scenario candidates. */
async function runOneBatch(
  batch: Batch<ApiOperation>,
  apiModel: ApiModelArg,
  testModel: TestModel,
  requestId: string,
  provider: AIProvider,
  outcomes: AICandidateOutcomes,
  candidateIds: Set<string>,
): Promise<BatchScenarioResult[]> {
  const response = await provider.infer(
    buildAIScenarioRequest(
      requestId,
      withOperations(apiModel, batch.operations),
      testModel,
    ),
  );
  const parsed = parseAIScenarioResponse(response);
  const aiScenarios: BatchScenarioResult[] = [];
  for (const rawCandidate of parsed.candidates) {
    const shapeFindings = validateAICandidateShape(rawCandidate);
    if (shapeFindings.length > 0) {
      outcomes.rejected.push({ candidate: rawCandidate, findings: shapeFindings });
      continue;
    }
    if (!isCandidateShape(rawCandidate)) continue;
    if (candidateIds.has(rawCandidate.candidateId)) {
      outcomes.rejected.push({
        candidate: rawCandidate,
        findings: [
          {
            code: "duplicate",
            message: "Candidate ID must be unique within a provider response",
            candidateId: rawCandidate.candidateId,
            path: "candidateId",
            executable: false,
          },
        ],
      });
      continue;
    }
    candidateIds.add(rawCandidate.candidateId);
    const semanticFindings = validateAICandidateSemantics(rawCandidate, apiModel);
    if (semanticFindings.length > 0) {
      outcomes.nonExecutable.push({
        candidate: rawCandidate,
        findings: semanticFindings,
      });
      continue;
    }
    const operation = apiModel.operations.find(
      (item) =>
        item.path === rawCandidate.operationPath &&
        item.method.toUpperCase() === rawCandidate.operationMethod.toUpperCase(),
    );
    if (!operation) continue;
    aiScenarios.push({
      candidate: rawCandidate,
      scenario: candidateToScenario(
        rawCandidate,
        operation,
        response.modelId,
        response.provider,
      ),
    });
  }
  return aiScenarios;
}

/** Optional progress hooks for one `enhanceTestModel` run (specs/012-ai-enhancement-progress). */
export interface EnhanceTestModelOptions {
  /**
   * Operations per AI request, overriding the configured default. Test-facing seam
   * (specs/014-ai-batching-policy FR-001) so unit sizing can be exercised without touching env.
   */
  operationsPerUnit?: number;
  /**
   * Per-request time budget the pre-flight estimate is compared against, overriding the configured
   * inference timeout. Test-facing seam (FR-013).
   */
  perRequestBudgetMs?: number;
  /**
   * Wall-clock ceiling for the whole run, overriding the configured default (FR-009). Once
   * exceeded, no further unit is started; remaining units are recorded `not-attempted` and the run
   * settles `partial` with everything already produced retained.
   */
  runBudgetMs?: number;
  /**
   * Fires once the provider is loaded and ready, immediately before batch planning
   * (specs/013-ai-enhancement-viability FR-018). Lets a caller distinguish time spent preparing
   * the model — which on a first run includes a large download — from time spent generating.
   */
  onPrepared?: () => void;
  /**
   * Checked before each batch; once it returns true, that batch and every remaining one are
   * recorded as `not-attempted` without calling the provider (FR-020). Cancellation is precise
   * between batches only: an in-flight generation cannot be interrupted, so scenarios already
   * retained from completed batches are kept (research.md Decision 7).
   */
  isCancelled?: () => boolean;
  /** Fires immediately before a batch's inference call starts. */
  onBatchStart?: (index: number, total: number) => void;
  /**
   * Fires immediately after a batch settles, with exactly the scenarios newly retained by
   * that batch (empty for a failed/not-attempted batch) — never the whole accumulated set.
   * Computed by recomputing the same `deduplicate()` used for the final merge over the
   * deterministic baseline plus every AI scenario from batches completed so far
   * (research.md Decision 4): because `deduplicate()` is a stable first-seen-wins left-fold
   * over scenarios in a fixed, deterministic batch order, a scenario already retained for an
   * earlier batch's prefix is never later revoked, so this incremental computation always
   * agrees with the final one-shot result.
   */
  onBatchComplete?: (
    index: number,
    total: number,
    outcome: BatchOutcome,
    newlyRetainedScenarios: TestScenario[],
  ) => void;
}

/**
 * Enhances a deterministic baseline `TestModel` with AI-suggested scenarios (FR-*, AP-005):
 * batches the ApiModel's operations, runs inference through `AIProvider` for each batch, then
 * validates, deduplicates, and merges the resulting candidates into the baseline. Always
 * falls back to returning the unmodified deterministic `testModel` (with an empty
 * `aiCandidates` set) when every batch fails, so AI failures never remove or block
 * deterministically-generated scenarios.
 */
export async function enhanceTestModel(
  apiModel: ApiModelArg,
  testModel: TestModel,
  provider: AIProvider,
  options: EnhanceTestModelOptions = {},
): Promise<EnhancementResult> {
  const requestId = `enhance-${createHash("sha256").update(buildAIScenarioPrompt(apiModel, testModel)).digest("hex").slice(0, 24)}`;
  const emptyOutcomes = (): AICandidateOutcomes => ({
    added: [],
    deduplicated: [],
    rejected: [],
    nonExecutable: [],
  });
  const outcomes = emptyOutcomes();
  const candidateIds = new Set<string>();

  // `getInputBudget()` loads the engine if it is not already loaded, so this await is where a
  // first run's model download and load actually happen. Signalling afterwards lets the caller
  // report "preparing" separately from "generating" (specs/013-ai-enhancement-viability FR-018).
  const budgetChars = await provider.getInputBudget(AI_SCENARIO_MAX_OUTPUT_TOKENS);
  options.onPrepared?.();

  // The run ceiling is measured from here — the moment preparation ends — and not from this
  // function's entry, so a first run's model download and load are not charged to it
  // (specs/014-ai-batching-policy contracts/run-budget.md, the `generatingSince` distinction
  // specs/012-ai-enhancement-progress established).
  const generationStartedAt = Date.now();

  // Work-bounded sizing (specs/014-ai-batching-policy FR-001): a unit covers a small fixed number
  // of operations rather than however many happen to fit the remaining context. `budgetChars`
  // remains the upper bound, so the work bound can never produce a request the model cannot accept.
  const batches = splitOperationsIntoBatches(
    apiModel.operations,
    (operations) =>
      buildAIScenarioPrompt(
        withOperations(apiModel, operations),
        scopeBaselineToOperations(testModel, operations),
      ),
    budgetChars,
    options.operationsPerUnit ?? loadAIConfig().planning.enhancementOperationsPerUnit,
  );

  // Pre-flight refusal (FR-013). Uniform, work-bounded units are what make a single estimate
  // representative of the whole run: every unit costs roughly the same, so if the most expensive one
  // cannot fit the per-request budget, none of them can and the run is hopeless before it starts.
  //
  // This exists because the alternative is what a user actually experienced: a 39-operation
  // specification producing 39 units that each ran to the full timeout and failed, ~40 minutes to
  // reach an outcome that was knowable in seconds. The estimator itself has been implemented and
  // tested since specs/013-ai-enhancement-viability but was never called from anywhere.
  const config = loadAIConfig();
  const worstPromptChars = batches.reduce((worst, batch) => {
    const chars = buildAIScenarioPrompt(
      withOperations(apiModel, batch.operations),
      scopeBaselineToOperations(testModel, batch.operations),
    ).length;
    return Math.max(worst, chars);
  }, 0);
  const estimate = estimateViability({
    promptTokens: Math.ceil(worstPromptChars / CHARS_PER_TOKEN_ESTIMATE),
    maxOutputTokens: AI_SCENARIO_MAX_OUTPUT_TOKENS,
    rates: {
      prefillMsPerToken: config.planning.prefillMsPerToken,
      decodeMsPerToken: config.planning.decodeMsPerToken,
    },
    budgetMs: options.perRequestBudgetMs ?? config.model.inferenceTimeoutMs,
    safetyFactor: config.planning.viabilitySafetyFactor,
  });
  if (!estimate.viable) {
    logger.warn("run_refused_not_viable", {
      promptTokens: estimate.promptTokens,
      maxOutputTokens: estimate.maxOutputTokens,
      projectedMs: Math.round(estimate.projectedMs),
      budgetMs: estimate.budgetMs,
      totalUnits: batches.length,
    });
    return {
      requestId,
      enhancedTestModel: testModel,
      aiCandidates: emptyOutcomes(),
      aiProviderOutcome: "unavailable",
      notViable: { projectedMs: estimate.projectedMs, budgetMs: estimate.budgetMs },
    };
  }

  // Per-batch results, populated as each batch's own `runBatch` closure resolves, so
  // `onBatchSettled` below (fired by runBatchedInference immediately afterward, before the
  // next batch starts, FR-003) can read this same batch's data without runBatchedInference
  // itself needing to carry TBatchData through its generic outcome-only hook.
  const batchScenariosByIndex: BatchScenarioResult[][] = [];
  const allAiScenariosSoFar: BatchScenarioResult[] = [];

  // Run ceiling (FR-009/FR-010). Checked at unit boundaries only, so a unit already in flight when
  // the ceiling elapses runs to completion and its scenarios are kept: the ceiling governs what is
  // *started*, never what is discarded. `runBudgetExhausted` records that the ceiling — rather than
  // a user cancellation, the other producer of `not-attempted` — is what stopped the run.
  const runBudgetMs = options.runBudgetMs ?? config.planning.enhancementRunBudgetMs;
  let runBudgetExhausted = false;
  const isRunBudgetExhausted = (): boolean => {
    if (Date.now() - generationStartedAt < runBudgetMs) return false;
    runBudgetExhausted = true;
    return true;
  };

  let nextBatchIndex = 0;
  const summary = await runBatchedInference(
    batches,
    (batch) => {
      const index = nextBatchIndex++;
      const batchRequestId = batches.length > 1 ? `${requestId}-batch${index}` : requestId;
      return runOneBatch(
        batch,
        apiModel,
        scopeBaselineToOperations(testModel, batch.operations),
        batchRequestId,
        provider,
        outcomes,
        candidateIds,
      ).then((result) => {
        batchScenariosByIndex[index] = result;
        return result;
      });
    },
    {
      isTimedOut: isRunBudgetExhausted,
      isCancelled: options.isCancelled,
      onBatchStart: options.onBatchStart,
      onBatchSettled: (index, total, outcome) => {
        // Per-unit diagnostics (specs/014-ai-batching-policy FR-018, constitution XX). Without
        // this, a run where every unit failed logged nothing at all about why: the
        // `successCount === 0` path below returns before `enhancement_complete` is reached, so the
        // only trace was a provider-level `inference_success` followed by an unexplained
        // `INVALID_RESPONSE`. Categories and counts only — never prompt or reply content.
        logger.info("unit_settled", {
          unitIndex: index,
          totalUnits: total,
          operationCount: batches[index]?.operations.length,
          status: outcome.status,
          errorCategory: outcome.status === "failed" ? outcome.errorCategory : undefined,
          retainedCount: (batchScenariosByIndex[index] ?? []).length,
        });

        if (!options.onBatchComplete) return;
        const thisBatchScenarios = batchScenariosByIndex[index] ?? [];
        if (thisBatchScenarios.length === 0) {
          options.onBatchComplete(index, total, outcome, []);
          return;
        }
        allAiScenariosSoFar.push(...thisBatchScenarios);
        const mergedSoFar = deduplicate([
          ...testModel.scenarios,
          ...allAiScenariosSoFar.map((item) => item.scenario),
        ]);
        const newlyRetained = thisBatchScenarios
          .map((item) => item.scenario)
          .filter((scenario) => mergedSoFar.some((m) => m.id === scenario.id));
        options.onBatchComplete(index, total, outcome, newlyRetained);
      },
    },
  );

  const aiScenarios = summary.runs.flatMap((run) => run.data ?? []);

  /**
   * The ceiling report for this run, or `undefined` when the ceiling was never reached.
   *
   * Reported on every post-run return rather than only the `partial` one: a run where the ceiling
   * elapsed *and* every started unit failed is still a truncated run, and saying so is what
   * distinguishes "this specification produced nothing" from "this specification was only
   * partly attempted".
   */
  const ceilingReport = runBudgetExhausted
    ? { budgetMs: runBudgetMs, notStartedCount: summary.notAttemptedCount }
    : undefined;

  if (summary.successCount === 0) {
    // No batch succeeded: nothing was ever added to `outcomes` (runOneBatch only mutates it
    // once fully parsed), so the baseline passes through unchanged, exactly like a
    // single-batch failure did before batching existed.
    const category = summary.errorCategory ?? "INVALID_RESPONSE";
    // Logged here as well as per-unit above, because this early return skips the
    // `enhancement_complete` line at the end — which is precisely why a total failure previously
    // left no diagnostic trace at all.
    logger.error("enhancement_failed", {
      outcome: summary.outcome,
      errorCategory: category,
      totalUnits: summary.totalCount,
      failureCount: summary.failureCount,
      notAttemptedCount: summary.notAttemptedCount,
      runBudgetExhausted,
    });
    return {
      requestId,
      enhancedTestModel: testModel,
      aiCandidates: emptyOutcomes(),
      aiProviderOutcome: summary.outcome,
      aiErrorCategory: category as EnhancementResult["aiErrorCategory"],
      aiErrorMessage: providerErrorMessage(
        category,
        summary.outcome,
        summary.failureCount,
        summary.totalCount,
        ceilingReport,
      ),
      runBudgetExhausted: ceilingReport,
    };
  }

  const merged = deduplicate([
    ...testModel.scenarios,
    ...aiScenarios.map((item) => item.scenario),
  ]);
  for (const item of aiScenarios) {
    const retained = merged.find((scenario) =>
      scenariosAreEquivalent(scenario, item.scenario),
    );
    if (!retained) continue;
    if (retained.id === item.scenario.id) {
      outcomes.added.push({ candidate: item.candidate, scenarioId: item.scenario.id });
    } else {
      outcomes.deduplicated.push({
        candidate: item.candidate,
        retainedScenarioId: retained.id,
        duplicateOfCandidateIds:
          retained.provenance.source === "AI" && retained.provenance.aiCandidateId
            ? [retained.provenance.aiCandidateId]
            : [],
      });
    }
  }

  logger.info("enhancement_complete", {
    outcome: summary.outcome,
    addedCount: outcomes.added.length,
    rejectedCount: outcomes.rejected.length,
    deduplicatedCount: outcomes.deduplicated.length,
    totalBatches: summary.totalCount,
    notAttemptedCount: summary.notAttemptedCount,
    runBudgetExhausted,
  });

  if (summary.outcome === "success") {
    return {
      requestId,
      enhancedTestModel: { scenarios: merged },
      aiCandidates: outcomes,
      aiProviderOutcome: "success",
    };
  }

  const category = summary.errorCategory ?? "INVALID_RESPONSE";
  return {
    requestId,
    enhancedTestModel: { scenarios: merged },
    aiCandidates: outcomes,
    aiProviderOutcome: "partial",
    aiErrorCategory: category as EnhancementResult["aiErrorCategory"],
    aiErrorMessage: providerErrorMessage(
      category,
      "partial",
      summary.failureCount,
      summary.totalCount,
      ceilingReport,
    ),
    runBudgetExhausted: ceilingReport,
  };
}

function providerErrorMessage(
  category: string,
  outcome: EnhancementResult["aiProviderOutcome"],
  failedCount: number,
  totalBatchCount: number,
  ceiling?: { budgetMs: number; notStartedCount: number },
): string {
  const fraction = batchFraction(failedCount, totalBatchCount);
  const preserved =
    outcome === "partial"
      ? "deterministic scenarios and partial AI results were preserved"
      : "deterministic scenarios were preserved";
  // A ceiling-truncated run must not be attributed to the provider. `failedCount` includes the
  // units the ceiling never started, so the ordinary messages below would report a count of
  // provider failures that never happened — reading, for a 39-unit plan stopped after seven, as
  // "the AI provider returned invalid output for 32 of 39 batches".
  if (ceiling) {
    return (
      `AI enhancement reached its run time limit with ${ceiling.notStartedCount} of ` +
      `${totalBatchCount} batches not started; ${preserved}`
    );
  }
  if (category === "TIMEOUT") {
    return `AI provider timed out${fraction}; ${preserved}`;
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return `AI provider is unavailable${fraction}; ${preserved}`;
  }
  return `AI provider returned invalid output${fraction}; ${preserved}`;
}
