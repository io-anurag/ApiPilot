import { createHash } from "node:crypto";
import type {
  AIScenarioCandidate,
  ApiOperation,
  TestScenario,
} from "@apipilot/shared-domain";

export function candidateScenarioId(candidate: AIScenarioCandidate): string {
  return `ai-${createHash("sha256").update(JSON.stringify(candidate)).digest("hex").slice(0, 24)}`;
}

export function candidateToScenario(
  candidate: AIScenarioCandidate,
  operation: ApiOperation,
  modelId: string,
  provider: "local" | "mock",
): TestScenario {
  return {
    id: candidateScenarioId(candidate),
    operationPath: operation.path,
    operationMethod: operation.method,
    category: candidate.category,
    targetLocation: candidate.targetLocation,
    targetField: candidate.targetField,
    request: candidate.request,
    assertions: candidate.assertions,
    provenance: {
      source: "AI",
      aiCandidateId: candidate.candidateId,
      description: candidate.rationale,
      duplicateOfRules: [],
      duplicateOfAICandidates: [],
      aiModel: modelId,
      aiProvider: provider,
      aiRationale: candidate.rationale,
      aiConfidence: candidate.confidence,
      aiAssumptions: candidate.assumptions,
    },
  };
}
