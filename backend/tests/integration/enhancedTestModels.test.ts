import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import {
  aiScenarioApiModel,
  aiScenarioBaseline,
} from "../fixtures/testDesign/aiScenarioDesignerFixtures";

const candidateResponse = JSON.stringify({
  responseVersion: 1,
  candidates: [
    {
      candidateId: "route-candidate",
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

function fixedProvider(content = candidateResponse): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    infer: async (input): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: input.requestId,
      status: "success",
      content,
      modelId: "integration-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

function errorProvider(errorCategory: "PROVIDER_UNAVAILABLE" | "TIMEOUT"): AIProvider {
  return {
    ...fixedProvider(),
    infer: async (input): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: input.requestId,
      status: "error",
      errorCategory,
      errorMessage: "provider diagnostic",
      modelId: "integration-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

describe("POST /api/test-models/enhance", () => {
  it("rejects a request without both normalized models", async () => {
    const response = await request(createApp()).post("/api/test-models/enhance").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_test_model_enhancement_request");
  });

  it("rejects non-POST methods", async () => {
    const response = await request(createApp()).get("/api/test-models/enhance");

    expect(response.status).toBe(405);
    expect(response.body.error).toBe("method_not_allowed");
  });

  it("returns a structured enhancement with AI provenance", async () => {
    const response = await request(createApp(fixedProvider()))
      .post("/api/test-models/enhance")
      .send({ apiModel: aiScenarioApiModel, testModel: aiScenarioBaseline });

    expect(response.status).toBe(200);
    expect(response.body.aiProviderOutcome).toBe("success");
    expect(response.body.aiCandidates.added).toHaveLength(1);
    expect(response.body.enhancedTestModel.scenarios[0].provenance).toMatchObject({
      source: "AI",
      aiModel: "integration-model",
      aiConfidence: 0.8,
    });
  });

  it("reports non-executable candidates without adding them", async () => {
    const response = await request(createApp(fixedProvider(JSON.stringify({
      responseVersion: 1,
      candidates: [{
        ...JSON.parse(candidateResponse).candidates[0],
        candidateId: "unknown-field",
        targetField: "missing",
      }],
    })))).post("/api/test-models/enhance")
      .send({ apiModel: aiScenarioApiModel, testModel: aiScenarioBaseline });

    expect(response.status).toBe(200);
    expect(response.body.aiCandidates.nonExecutable).toHaveLength(1);
    expect(response.body.enhancedTestModel).toEqual(aiScenarioBaseline);
    expect(response.body.aiCandidates.nonExecutable[0].findings[0].executable).toBe(false);
  });

  it("preserves the deterministic baseline during provider degradation", async () => {
    for (const [provider, outcome] of [
      [errorProvider("PROVIDER_UNAVAILABLE"), "unavailable"],
      [errorProvider("TIMEOUT"), "timeout"],
    ] as const) {
      const response = await request(createApp(provider))
        .post("/api/test-models/enhance")
        .send({ apiModel: aiScenarioApiModel, testModel: aiScenarioBaseline });

      expect(response.status).toBe(200);
      expect(response.body.aiProviderOutcome).toBe(outcome);
      expect(response.body.enhancedTestModel).toEqual(aiScenarioBaseline);
      expect(response.body.aiErrorMessage).not.toContain("provider diagnostic");
    }
  });

  it("deduplicates equivalent AI candidates and preserves their identities", async () => {
    const parsedCandidate = JSON.parse(candidateResponse).candidates[0];
    const response = await request(createApp(fixedProvider(JSON.stringify({
      responseVersion: 1,
      candidates: [parsedCandidate, { ...parsedCandidate, candidateId: "route-candidate-2" }],
    })))).post("/api/test-models/enhance")
      .send({ apiModel: aiScenarioApiModel, testModel: aiScenarioBaseline });

    expect(response.status).toBe(200);
    expect(response.body.enhancedTestModel.scenarios).toHaveLength(1);
    expect(response.body.aiCandidates.deduplicated[0].duplicateOfCandidateIds).toContain(
      "route-candidate",
    );
  });
});
