import { createHash } from "node:crypto";
import type {
  AICandidateOutcomes,
  AIProvider,
  AIScenarioCandidate,
  ApiOperation,
  EnhancementResult,
  TestModel,
} from "@apipilot/shared-domain";
import { buildAIScenarioRequest, buildAIScenarioPrompt } from "./aiScenarioPrompt";
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
} from "../ai/requestBatching";

type ApiModelArg = Parameters<typeof validateAICandidateSemantics>[1];

function withOperations(apiModel: ApiModelArg, operations: ApiOperation[]): ApiModelArg {
  return { ...apiModel, operations };
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

export async function enhanceTestModel(
  apiModel: ApiModelArg,
  testModel: TestModel,
  provider: AIProvider,
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

  const budgetChars = await provider.getInputBudget();
  const batches = splitOperationsIntoBatches(
    apiModel.operations,
    (operations) =>
      buildAIScenarioPrompt(withOperations(apiModel, operations), testModel),
    budgetChars,
  );

  let nextBatchIndex = 0;
  const summary = await runBatchedInference(batches, (batch) => {
    const index = nextBatchIndex++;
    const batchRequestId = batches.length > 1 ? `${requestId}-batch${index}` : requestId;
    return runOneBatch(
      batch,
      apiModel,
      testModel,
      batchRequestId,
      provider,
      outcomes,
      candidateIds,
    );
  });

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
