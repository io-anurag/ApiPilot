import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import {
  aiScenarioApiModel,
  aiScenarioBaseline,
} from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";

function provider(content: string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    infer: async (request): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: request.requestId,
      status: "success",
      content,
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

describe("enhanceTestModel", () => {
  it("adds valid candidates, withholds unsafe references, and preserves the baseline", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({
          responseVersion: 1,
          candidates: [
            {
              candidateId: "valid-1",
              operationPath: "/accounts",
              operationMethod: "POST",
              category: "invalid-format",
              targetLocation: "body",
              targetField: "email",
              request: {
                pathParameters: {},
                queryParameters: {},
                headers: {},
                body: { email: "bad" },
              },
              assertions: [{ type: "status-code", expectedStatusCode: "409" }],
              rationale: "Exercise a malformed email value.",
              confidence: 0.8,
              assumptions: [],
            },
            {
              candidateId: "unsafe-1",
              operationPath: "/missing",
              operationMethod: "POST",
              category: "positive",
              request: { pathParameters: {}, queryParameters: {}, headers: {} },
              assertions: [],
              rationale: "Unknown operation should not execute.",
              confidence: 0.8,
              assumptions: [],
            },
          ],
        }),
      ),
    );

    expect(result.aiProviderOutcome).toBe("success");
    expect(result.enhancedTestModel.scenarios).toHaveLength(1);
    expect(result.enhancedTestModel.scenarios[0].provenance.source).toBe("AI");
    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.nonExecutable[0].findings[0].code).toBe(
      "operation-not-found",
    );
  });

  it.each([
    ["PROVIDER_UNAVAILABLE", "unavailable"],
    ["TIMEOUT", "timeout"],
  ] as const)(
    "preserves the baseline for %s provider failures",
    async (category, outcome) => {
      const result = await enhanceTestModel(aiScenarioApiModel, aiScenarioBaseline, {
        ...provider(""),
        infer: async (request) => ({
          contractVersion: 1,
          requestId: request.requestId,
          status: "error",
          errorCategory: category,
          errorMessage: "internal provider detail",
          modelId: "test-model",
          provider: "mock",
          durationMs: 0,
        }),
      });

      expect(result.aiProviderOutcome).toBe(outcome);
      expect(result.enhancedTestModel).toEqual(aiScenarioBaseline);
      expect(result.aiErrorMessage).not.toContain("internal provider detail");
    },
  );

  it("preserves the baseline for malformed provider output", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider("{}"),
    );

    expect(result.aiProviderOutcome).toBe("invalid-response");
    expect(result.enhancedTestModel).toEqual(aiScenarioBaseline);
  });

  it("partitions duplicate AI candidates and preserves their identities", async () => {
    const candidate = {
      candidateId: "duplicate-1",
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
      assumptions: [],
    };
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({
          responseVersion: 1,
          candidates: [candidate, { ...candidate, candidateId: "duplicate-2" }],
        }),
      ),
    );

    expect(result.enhancedTestModel.scenarios).toHaveLength(1);
    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.deduplicated).toHaveLength(1);
    expect(result.enhancedTestModel.scenarios[0].provenance).toMatchObject({
      source: "AI",
      aiCandidateId: "duplicate-1",
      duplicateOfAICandidates: ["duplicate-2"],
    });
  });

  it("rejects repeated candidate IDs without adding the repeated candidate", async () => {
    const candidate = {
      candidateId: "same-id",
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
      assumptions: [],
    };
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({ responseVersion: 1, candidates: [candidate, candidate] }),
      ),
    );

    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.rejected).toHaveLength(1);
    expect(result.aiCandidates.rejected[0].findings[0].code).toBe("duplicate");
  });

  it("produces stable identities and ordering for equivalent repeated enhancement", async () => {
    const content = JSON.stringify({
      responseVersion: 1,
      candidates: [
        {
          candidateId: "stable-id",
          operationPath: "/accounts",
          operationMethod: "POST",
          category: "invalid-format",
          targetLocation: "body",
          targetField: "email",
          request: {
            pathParameters: {},
            queryParameters: {},
            headers: {},
            body: { email: "bad" },
          },
          assertions: [{ type: "status-code", expectedStatusCode: "409" }],
          rationale: "Exercise a malformed email value.",
          confidence: 0.8,
          assumptions: [],
        },
      ],
    });
    const first = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(content),
    );
    const second = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(content),
    );

    expect(second).toEqual(first);
  });
});
