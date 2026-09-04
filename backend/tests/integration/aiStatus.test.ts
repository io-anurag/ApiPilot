import express from "express";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { AIProvider, ReadinessState } from "@apipilot/shared-domain";
import { createAiStatusRouter } from "../../src/api/aiStatus";

function fakeProvider(state: ReadinessState): AIProvider {
  return {
    mode: "local",
    getReadiness: () => state,
    getInputBudget: async () => undefined,
    infer: async () => {
      throw new Error("not used in this test");
    },
  };
}

function appWithProvider(provider: AIProvider) {
  const app = express();
  app.use("/api", createAiStatusRouter(provider));
  return app;
}

describe("GET /api/ai/status", () => {
  it("reports not-loaded", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "not-loaded",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.status).toBe(200);
    expect(response.body.state).toBe("not-loaded");
    expect(response.body.reason).toBeNull();
  });

  it("reports ready with the loaded modelId", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        modelId: "fake-model",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.status).toBe(200);
    expect(response.body.state).toBe("ready");
    expect(response.body.modelId).toBe("fake-model");
  });

  it("reports unavailable with a non-empty reason", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "unavailable",
        reason: "model cache is corrupted",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.status).toBe(200);
    expect(response.body.state).toBe("unavailable");
    expect(response.body.reason).toBe("model cache is corrupted");
  });

  it("returns 405 for unsupported methods", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    const response = await request(app).post("/api/ai/status");

    expect(response.status).toBe(405);
  });
});
