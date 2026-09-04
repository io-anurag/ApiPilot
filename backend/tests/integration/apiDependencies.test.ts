import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import {
  crudChainApiModel,
  cyclicApiModel,
  dissimilarNameAiApiModel,
} from "../fixtures/dependencies/dependencyFixtures";

const dependencyCandidateResponse = JSON.stringify({
  responseVersion: 1,
  candidates: [
    {
      candidateId: "ai-candidate-1",
      producer: {
        operationPath: "/accounts",
        operationMethod: "POST",
        field: "accountId",
      },
      consumer: {
        operationPath: "/transfers",
        operationMethod: "POST",
        field: "accountRef",
        location: "body",
      },
      rationale:
        "accountRef semantically refers to the account identifier returned by account creation.",
      confidence: 0.9,
    },
  ],
});

function fixedProvider(content = dependencyCandidateResponse): AIProvider {
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

describe("POST /api/api-models/dependencies", () => {
  it("rejects a request without an apiModel", async () => {
    const response = await request(createApp())
      .post("/api/api-models/dependencies")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("rejects non-POST methods", async () => {
    const response = await request(createApp()).get("/api/api-models/dependencies");

    expect(response.status).toBe(405);
    expect(response.body.error).toBe("method_not_allowed");
  });

  it("returns the CRUD-chain relationship at 200 with the contract's response shape", async () => {
    const response = await request(createApp())
      .post("/api/api-models/dependencies")
      .send({ apiModel: crudChainApiModel });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("requestId");
    expect(response.body).toHaveProperty("graph.relationships");
    expect(response.body).toHaveProperty("workflows");
    expect(response.body).toHaveProperty("manualConfirmationCandidates");
    expect(response.body).toHaveProperty("cycles");
    expect(response.body.aiOutcome).toBe("skipped");

    const created = response.body.graph.relationships.find(
      (r: { producer: { operationPath: string }; consumer: { operationPath: string } }) =>
        r.producer.operationPath === "/users" &&
        r.consumer.operationPath === "/users/{userId}",
    );
    expect(created).toMatchObject({ confidence: "CONFIRMED", source: "deterministic" });
  });

  it("returns an identical response body for a repeated identical request", async () => {
    const app = createApp();
    const first = await request(app)
      .post("/api/api-models/dependencies")
      .send({ apiModel: crudChainApiModel });
    const second = await request(app)
      .post("/api/api-models/dependencies")
      .send({ apiModel: crudChainApiModel });

    expect(second.body).toEqual(first.body);
  });

  it("assembles a workflow from POST /users to each of its dependent operations, correctly ordered", async () => {
    const response = await request(createApp())
      .post("/api/api-models/dependencies")
      .send({ apiModel: crudChainApiModel });

    expect(response.status).toBe(200);
    expect(response.body.workflows.length).toBeGreaterThan(0);
    for (const workflow of response.body.workflows) {
      expect(workflow.steps[0]).toMatchObject({
        operationPath: "/users",
        operationMethod: "POST",
      });
      for (const variable of workflow.variables) {
        expect(variable.producerStepIndex).toBeLessThan(variable.consumerStepIndex);
      }
    }
    const targets = response.body.workflows.map(
      (w: { steps: { operationMethod: string }[] }) => w.steps.at(-1)?.operationMethod,
    );
    expect(targets).toEqual(expect.arrayContaining(["GET", "PUT", "DELETE"]));
  });

  it("reports the cyclic fixture's relationships under cycles with no workflow spanning them", async () => {
    const response = await request(createApp())
      .post("/api/api-models/dependencies")
      .send({ apiModel: cyclicApiModel });

    expect(response.status).toBe(200);
    expect(response.body.cycles.length).toBeGreaterThan(0);
    expect(response.body.workflows).toEqual([]);
  });

  it("merges a valid AI-suggested dissimilar-name relationship with aiOutcome 'success'", async () => {
    const response = await request(createApp(fixedProvider()))
      .post("/api/api-models/dependencies")
      .send({ apiModel: dissimilarNameAiApiModel });

    expect(response.status).toBe(200);
    expect(response.body.aiOutcome).toBe("success");
    const aiRelationship = response.body.graph.relationships.find(
      (r: { producer: { field: string } }) => r.producer.field === "accountId",
    );
    expect(aiRelationship).toMatchObject({ source: "ai", confidence: "LIKELY" });
  });

  it("preserves deterministic relationships and reports the failure when the AI provider degrades", async () => {
    for (const [provider, outcome] of [
      [errorProvider("PROVIDER_UNAVAILABLE"), "unavailable"],
      [errorProvider("TIMEOUT"), "timeout"],
    ] as const) {
      const response = await request(createApp(provider))
        .post("/api/api-models/dependencies")
        .send({ apiModel: crudChainApiModel });

      expect(response.status).toBe(200);
      expect(response.body.aiOutcome).toBe(outcome);
      expect(response.body.graph.relationships.length).toBeGreaterThan(0);
      expect(response.body.aiErrorMessage).not.toContain("provider diagnostic");
    }
  });

  it("never surfaces an AI candidate that references a nonexistent field (FR-008)", async () => {
    const invalidCandidateResponse = JSON.stringify({
      responseVersion: 1,
      candidates: [
        {
          candidateId: "bad-candidate",
          producer: {
            operationPath: "/accounts",
            operationMethod: "POST",
            field: "accountId",
          },
          consumer: {
            operationPath: "/transfers",
            operationMethod: "POST",
            field: "doesNotExist",
            location: "body",
          },
          rationale: "invalid",
          confidence: 0.9,
        },
      ],
    });

    const response = await request(createApp(fixedProvider(invalidCandidateResponse)))
      .post("/api/api-models/dependencies")
      .send({ apiModel: dissimilarNameAiApiModel });

    expect(response.status).toBe(200);
    expect(response.body.graph.relationships).toEqual([]);
  });
});
