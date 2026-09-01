import { describe, expect, it } from "vitest";
import { aiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import {
  candidateScenarioId,
  candidateToScenario,
} from "../../../src/testDesign/aiScenarioCandidate";

const candidate = {
  candidateId: "candidate-1",
  operationPath: "/accounts",
  operationMethod: "POST",
  category: "invalid-format" as const,
  targetLocation: "body" as const,
  targetField: "email",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: {},
    body: { email: "bad" },
  },
  assertions: [{ type: "status-code" as const, expectedStatusCode: "409" }],
  rationale: "Exercise a malformed email value.",
  confidence: 0.8,
  assumptions: ["The service treats malformed email as a conflict candidate."],
};

describe("AI scenario conversion", () => {
  it("creates stable AI provenance and identity", () => {
    const operation = aiScenarioApiModel.operations[0];
    const scenario = candidateToScenario(candidate, operation, "test-model", "mock");

    expect(scenario.id).toBe(candidateScenarioId(candidate));
    expect(scenario.provenance).toMatchObject({
      source: "AI",
      aiCandidateId: "candidate-1",
      aiModel: "test-model",
      aiProvider: "mock",
      aiConfidence: 0.8,
      aiAssumptions: candidate.assumptions,
    });
  });
});
