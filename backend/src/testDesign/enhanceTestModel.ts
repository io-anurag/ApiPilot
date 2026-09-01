import { createHash } from "node:crypto";
import type {
  AICandidateOutcomes,
  AIProvider,
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

export async function enhanceTestModel(
  apiModel: Parameters<typeof validateAICandidateSemantics>[1],
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
  try {
    const response = await provider.infer(
      buildAIScenarioRequest(requestId, apiModel, testModel),
    );
    const parsed = parseAIScenarioResponse(response);
    const outcomes = emptyOutcomes();
    const candidates = parsed.candidates;
    const aiScenarios = [];
    const candidateIds = new Set<string>();
    for (const rawCandidate of candidates) {
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
    return {
      requestId,
      enhancedTestModel: { scenarios: merged },
      aiCandidates: outcomes,
      aiProviderOutcome: "success",
    };
  } catch (error) {
    const category =
      error && typeof error === "object" && "category" in error
        ? String(error.category)
        : "INVALID_RESPONSE";
    const outcome =
      category === "TIMEOUT"
        ? "timeout"
        : category === "PROVIDER_UNAVAILABLE" ||
            category === "NOT_READY" ||
            category === "LOAD_FAILED"
          ? "unavailable"
          : "invalid-response";
    return {
      requestId,
      enhancedTestModel: testModel,
      aiCandidates: emptyOutcomes(),
      aiProviderOutcome: outcome,
      aiErrorCategory: category as EnhancementResult["aiErrorCategory"],
      aiErrorMessage: providerErrorMessage(category),
    };
  }
}

function providerErrorMessage(category: string): string {
  if (category === "TIMEOUT") {
    return "AI provider timed out; deterministic scenarios were preserved";
  }
  if (["PROVIDER_UNAVAILABLE", "NOT_READY", "LOAD_FAILED"].includes(category)) {
    return "AI provider is unavailable; deterministic scenarios were preserved";
  }
  return "AI provider returned invalid output; deterministic scenarios were preserved";
}
