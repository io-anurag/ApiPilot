import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import {
  aiDerivedScenario,
  deterministicScenario,
  reviewApiModel,
  reviewBaselineTestModel,
} from "../fixtures/testDesign/reviewScenarioFixtures";

function provider(content: string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    infer: async (req): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: req.requestId,
      status: "success",
      content,
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

describe("POST /api/test-models/reviews/edit", () => {
  it("applies a supported edit and returns a pending replacement", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews/edit")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        scenarioId: aiDerivedScenario.id,
        revision: 0,
        edit: {
          request: {
            pathParameters: {},
            queryParameters: {},
            headers: {},
            body: { name: "Widget", quantity: 500 },
          },
          assertions: [{ type: "status-code", expectedStatusCode: "400" }],
          targetLocation: "body",
          targetField: "quantity",
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.outcomes[0]).toMatchObject({ applied: true, state: "pending" });
    const edited = response.body.review.scenarios.find(
      (s: { scenarioId: string }) => s.scenarioId === aiDerivedScenario.id,
    );
    expect(edited.isUserModified).toBe(true);
    expect(edited.scenario.provenance.source).toBe("AI");
  });

  it("leaves the current scenario unchanged for an invalid edit", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews/edit")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        scenarioId: aiDerivedScenario.id,
        revision: 0,
        edit: {
          request: {
            pathParameters: {},
            queryParameters: {},
            headers: {},
            body: { unknownField: true },
          },
          assertions: [],
        },
      });

    expect(response.body.outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "invalid-edit" },
    });
  });
});

describe("POST /api/test-models/reviews/regenerate", () => {
  it("replaces an AI-derived scenario with a valid AI regeneration result", async () => {
    const app = createApp(
      provider(
        JSON.stringify({
          responseVersion: 1,
          candidates: [
            {
              candidateId: "regenerated-1",
              operationPath: "/widgets",
              operationMethod: "POST",
              category: "numeric-boundary",
              targetLocation: "body",
              targetField: "quantity",
              request: {
                pathParameters: {},
                queryParameters: {},
                headers: {},
                body: { name: "Widget", quantity: 101 },
              },
              assertions: [{ type: "status-code", expectedStatusCode: "400" }],
              rationale: "Quantity above the documented maximum.",
              confidence: 0.7,
              assumptions: [],
            },
          ],
        }),
      ),
    );

    const response = await request(app).post("/api/test-models/reviews/regenerate").send({
      apiModel: reviewApiModel,
      testModel: reviewBaselineTestModel,
      scenarioId: aiDerivedScenario.id,
      revision: 0,
    });

    expect(response.status).toBe(200);
    expect(response.body.outcomes[0]).toMatchObject({ applied: true, state: "pending" });
    const regenerated = response.body.review.scenarios.find(
      (s: { scenarioId: string }) => s.scenarioId === aiDerivedScenario.id,
    );
    expect(regenerated.revision).toBe(1);
    expect(regenerated.history).toHaveLength(1);
    expect(regenerated.history[0].type).toBe("regeneration");
  });

  it("preserves the current scenario when the provider is unavailable", async () => {
    const app = createApp({
      ...provider(""),
      infer: async (req) => ({
        contractVersion: 1,
        requestId: req.requestId,
        status: "error",
        errorCategory: "PROVIDER_UNAVAILABLE",
        errorMessage: "unavailable",
        modelId: "test-model",
        provider: "mock",
        durationMs: 0,
      }),
    });

    const response = await request(app).post("/api/test-models/reviews/regenerate").send({
      apiModel: reviewApiModel,
      testModel: reviewBaselineTestModel,
      scenarioId: aiDerivedScenario.id,
      revision: 0,
    });

    expect(response.status).toBe(200);
    expect(response.body.outcomes[0].applied).toBe(false);
    const unchanged = response.body.review.scenarios.find(
      (s: { scenarioId: string }) => s.scenarioId === aiDerivedScenario.id,
    );
    expect(unchanged.revision).toBe(0);
  });

  it("rejects regeneration of a rule-derived (non-AI) scenario", async () => {
    const app = createApp(provider(""));
    const response = await request(app).post("/api/test-models/reviews/regenerate").send({
      apiModel: reviewApiModel,
      testModel: reviewBaselineTestModel,
      scenarioId: deterministicScenario.id,
      revision: 0,
    });

    expect(response.body.outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "invalid-edit" },
    });
  });
});
