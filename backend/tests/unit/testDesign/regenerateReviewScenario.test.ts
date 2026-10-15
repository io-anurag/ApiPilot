import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  InferenceRequest,
  InferenceResponse,
  ReviewScenario,
} from "@apipilot/shared-domain";
import { regenerateReviewScenario } from "../../../src/testDesign/regenerateReviewScenario";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { aiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";

/**
 * Regenerating a scenario asks for a replacement, not for something extra (specs/013 T071 follow-up).
 * Measured on the default model, the enhancement wording ("suggest one more scenario, prefer something
 * not already covered") got a replacement for 1 of 7 operations and the replacement wording for 3 of 7.
 */

const scenario = generateTestModel(aiScenarioApiModel).scenarios[0];
const reviewScenario: ReviewScenario = {
  scenarioId: scenario.id,
  revision: 0,
  scenario: { ...scenario, provenance: { ...scenario.provenance, source: "AI" } } as never,
  state: "pending",
  isUserModified: false,
  history: [],
};

const candidate = {
  candidateId: "c-1",
  operationPath: "/accounts",
  operationMethod: "POST",
  category: "invalid-format",
  targetLocation: "body",
  targetField: "email",
  request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { email: "bad" } },
  assertions: [{ type: "status-code", expectedStatusCode: "409" }],
  rationale: "A malformed email should be refused.",
  confidence: 0.8,
  assumptions: [],
};

function capturingProvider(seen: InferenceRequest[]): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    infer: async (request): Promise<InferenceResponse> => {
      seen.push(request);
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content: JSON.stringify({ candidates: [candidate] }),
        modelId: "m",
        provider: "mock",
        durationMs: 1,
      };
    },
  };
}

describe("regenerateReviewScenario wording", () => {
  it("asks the model for a replacement that differs from the current scenario", async () => {
    const seen: InferenceRequest[] = [];
    const result = await regenerateReviewScenario(
      aiScenarioApiModel,
      reviewScenario,
      capturingProvider(seen),
    );

    expect(result.ok).toBe(true);
    const task = (JSON.parse(seen[0].input) as { task: string }).task;
    expect(task).toMatch(/^Write exactly 1 replacement test scenario/);
    expect(task).toMatch(/different scenario from the one in existingCoverage/);
    expect(task).not.toMatch(/Suggest exactly/);
    expect(task).not.toMatch(/Prefer something existingCoverage does not already cover/);
  });

  it("still says an empty list is not an answer, and still ends with the status-code instruction", async () => {
    const seen: InferenceRequest[] = [];
    await regenerateReviewScenario(aiScenarioApiModel, reviewScenario, capturingProvider(seen));

    const task = (JSON.parse(seen[0].input) as { task: string }).task;
    expect(task).toMatch(/never return an empty list/i);
    expect(task.endsWith("expectedStatusCode must be one of allowedStatusCodes.")).toBe(true);
  });

  it("puts the scenario being replaced in existingCoverage, so the model can differ from it", async () => {
    const seen: InferenceRequest[] = [];
    await regenerateReviewScenario(aiScenarioApiModel, reviewScenario, capturingProvider(seen));

    const prompt = JSON.parse(seen[0].input) as { existingCoverage: Record<string, unknown> };
    expect(Object.keys(prompt.existingCoverage)).toEqual(["POST /accounts"]);
  });
});
