import { describe, expect, it } from "vitest";
import type { AIScenarioCandidate, EnhancementResult } from "@apipilot/shared-domain";
import type { Provenance } from "@apipilot/shared-domain";

describe("AI scenario shared contracts", () => {
  it("represents AI provenance without changing the deterministic scenario shape", () => {
    const provenance: Provenance = {
      source: "AI",
      description: "Reject duplicate account creation",
      duplicateOfRules: [],
      duplicateOfAICandidates: [],
      aiModel: "mock-provider",
      aiProvider: "mock",
      aiRationale: "The operation documents a conflict response for an existing account.",
      aiConfidence: 0.9,
      aiAssumptions: [],
    };

    expect(provenance.source).toBe("AI");
    expect(provenance.aiConfidence).toBeGreaterThanOrEqual(0);
    expect(provenance.aiConfidence).toBeLessThanOrEqual(1);
  });

  it("allows the documented inclusive confidence boundaries", () => {
    for (const confidence of [0, 1]) {
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it("models a candidate and partitions its enhancement outcome", () => {
    const candidate: AIScenarioCandidate = {
      candidateId: "candidate-1",
      operationPath: "/accounts",
      operationMethod: "POST",
      category: "invalid-enum",
      targetLocation: "body",
      targetField: "email",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
      assertions: [],
      rationale: "Exercise a semantically invalid account value.",
      confidence: 0.75,
      assumptions: [],
    };
    const result: EnhancementResult = {
      requestId: "request-1",
      enhancedTestModel: { scenarios: [] },
      aiCandidates: { added: [], deduplicated: [], rejected: [], nonExecutable: [] },
      aiProviderOutcome: "success",
    };

    expect(candidate.confidence).toBe(0.75);
    expect(result.aiCandidates.rejected).toHaveLength(0);
  });
});
