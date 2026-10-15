import { createHash } from "node:crypto";
import type {
  AIScenarioCandidate,
  AIStrippedAssertion,
  ApiOperation,
  TestScenario,
} from "@apipilot/shared-domain";

/** Deterministic scenario ID derived from the full candidate content, so re-parsing the same AI response yields the same scenario ID. */
export function candidateScenarioId(candidate: AIScenarioCandidate): string {
  return `ai-${createHash("sha256").update(JSON.stringify(candidate)).digest("hex").slice(0, 24)}`;
}

/**
 * Converts a validated AI scenario candidate into an executable TestScenario, attaching AI
 * provenance (model, provider, rationale, confidence, assumptions). `batchIndex`, when supplied,
 * tags the scenario with the batch that produced it (specs/015-ai-batch-retry FR-010), so a
 * later retry of that same batch can be scoped correctly. `strippedAssertions`, when non-empty, is
 * recorded on the provenance so a reviewer can see what the model proposed and what was removed
 * (specs/005 amendment 2026-10-15).
 */
export function candidateToScenario(
  candidate: AIScenarioCandidate,
  operation: ApiOperation,
  modelId: string,
  provider: "local" | "mock",
  batchIndex?: number,
  strippedAssertions: readonly AIStrippedAssertion[] = [],
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
      aiBatchIndex: batchIndex,
      ...(strippedAssertions.length > 0
        ? { aiStrippedAssertions: [...strippedAssertions] }
        : {}),
    },
  };
}
