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

  const budgetChars = await provider.getInputBudget(AI_SCENARIO_MAX_OUTPUT_TOKENS);
  const batches = splitOperationsIntoBatches(
    apiModel.operations,
    (operations) =>
      buildAIScenarioPrompt(
        withOperations(apiModel, operations),
        scopeBaselineToOperations(testModel, operations),
      ),
    budgetChars,
  );

  // Per-batch results, populated as each batch's own `runBatch` closure resolves, so
  // `onBatchSettled` below (fired by runBatchedInference immediately afterward, before the
  // next batch starts, FR-003) can read this same batch's data without runBatchedInference
  // itself needing to carry TBatchData through its generic outcome-only hook.
  const batchScenariosByIndex: BatchScenarioResult[][] = [];
  const allAiScenariosSoFar: BatchScenarioResult[] = [];

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
      onBatchStart: options.onBatchStart,
      onBatchSettled: options.onBatchComplete
        ? (index, total, outcome) => {
            const thisBatchScenarios = batchScenariosByIndex[index] ?? [];
            if (thisBatchScenarios.length === 0) {
              options.onBatchComplete!(index, total, outcome, []);
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
            options.onBatchComplete!(index, total, outcome, newlyRetained);
          }
        : undefined,
    },
  );

  const aiScenarios = summary.runs.flatMap((run) => run.data ?? []);

  if (summary.successCount === 0) {
    // No batch succeeded: nothing was ever added to `outcomes` (runOneBatch only mutates it
    // once fully parsed), so the baseline passes through unchanged, exactly like a
    // single-batch failure did before batching existed.
    const category = summary.errorCategory ?? "INVALID_RESPONSE";
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
      ),
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
    ),
  };
}

function providerErrorMessage(
  category: string,
  outcome: EnhancementResult["aiProviderOutcome"],
  failedCount: number,
  totalBatchCount: number,
): string {
  const fraction = batchFraction(failedCount, totalBatchCount);
  const preserved =
    outcome === "partial"
      ? "deterministic scenarios and partial AI results were preserved"
      : "deterministic scenarios were preserved";
  if (category === "TIMEOUT") {
    return `AI provider timed out${fraction}; ${preserved}`;
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return `AI provider is unavailable${fraction}; ${preserved}`;
  }
  return `AI provider returned invalid output${fraction}; ${preserved}`;
}
