import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import { buildLargeApiModel } from "../../fixtures/dependencies/dependencyFixtures";

function mockProvider(): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async () => undefined,
    infer: async (input): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: input.requestId,
      status: "success",
      content: JSON.stringify({ responseVersion: 1, candidates: [] }),
      modelId: "performance-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

describe("analyzeDependencies performance (SC-008)", () => {
  it("completes full analysis over a 200-operation ApiModel, including one mock AI call, in under 15 seconds", async () => {
    const largeModel = buildLargeApiModel(200);
    const startedAt = Date.now();

    const result = await analyzeDependencies(largeModel, mockProvider());

    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(result.aiOutcome).toBe("success");
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });
});
