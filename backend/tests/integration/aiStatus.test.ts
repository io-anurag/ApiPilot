import express from "express";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { AIProvider, ReadinessState } from "@apipilot/shared-domain";
import { MockProvider } from "../../src/ai/mockProvider";
import { createAiStatusRouter } from "../../src/api/aiStatus";
import { getAiDiagnosticsRepository } from "../../src/persistence/aiDiagnosticsRepository";

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

  it("includes lastKnownReadiness/latestBenchmarkRun from persisted history (specs/025-local-persistence-layer)", async () => {
    getAiDiagnosticsRepository().recordReadinessTransition({
      state: "unavailable",
      reason: "model cache is corrupted",
      modelId: "fake-model",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-09-15T08:00:00.000Z",
    });
    getAiDiagnosticsRepository().recordBenchmarkRun({
      runAt: "2026-08-20T00:00:00.000Z",
      workloadSetId: "set-1",
      candidates: [{ modelId: "fake-model", structuredOutputSuccessRate: 1, averageLatencyMs: 10 }],
      selectedModelId: "fake-model",
      selectionRationale: "best of the candidates evaluated",
    });

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
    expect(response.body.lastKnownReadiness).toMatchObject({
      state: "unavailable",
      reason: "model cache is corrupted",
    });
    expect(response.body.latestBenchmarkRun).toMatchObject({
      selectedModelId: "fake-model",
      selectionRationale: "best of the candidates evaluated",
    });
  });

  it("reports null lastKnownReadiness/latestBenchmarkRun when no history has been recorded", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "not-loaded",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date().toISOString(),
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.body.lastKnownReadiness).toBeNull();
    expect(response.body.latestBenchmarkRun).toBeNull();
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

// Additive fields from specs/055-accelerator-canary-check (contracts/ai-status-api-amendment.md).
describe("GET /api/ai/status accelerator verification fields", () => {
  const now = () => new Date().toISOString();

  it("reports the accelerator, its label, a null adapter and a passed verification", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        modelId: "fake-model",
        acceleratorRequested: true,
        acceleratorActive: true,
        updatedAt: now(),
        inferenceDevice: "accelerator",
        acceleratorLabel: "DirectML",
        acceleratorVerification: {
          outcome: "passed",
          durationMs: 1348,
          tokensPerSecond: 3,
          canaryVersion: 1,
        },
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      inferenceDevice: "accelerator",
      acceleratorLabel: "DirectML",
      acceleratorAdapter: null,
      acceleratorVerification: {
        outcome: "passed",
        failureCategory: null,
        durationMs: 1348,
        tokensPerSecond: 3,
        canaryVersion: 1,
      },
    });
  });

  it("reports CPU with no accelerator label and no verification", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        modelId: "fake-model",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: now(),
        inferenceDevice: "cpu",
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.body).toMatchObject({
      inferenceDevice: "cpu",
      acceleratorLabel: null,
      acceleratorAdapter: null,
      acceleratorVerification: null,
    });
  });

  it("reports a failed verification with its category, no throughput, and the fallback reason", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        modelId: "fake-model",
        acceleratorRequested: true,
        acceleratorActive: false,
        updatedAt: now(),
        reason: "Accelerator loaded but failed verification (unusable-reply); using CPU inference instead",
        inferenceDevice: "cpu",
        acceleratorVerification: {
          outcome: "failed",
          failureCategory: "unusable-reply",
          durationMs: 9120,
          canaryVersion: 1,
        },
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.body.reason).toContain("failed verification (unusable-reply)");
    expect(response.body.acceleratorActive).toBe(false);
    expect(response.body.acceleratorVerification).toEqual({
      outcome: "failed",
      failureCategory: "unusable-reply",
      durationMs: 9120,
      tokensPerSecond: null,
      canaryVersion: 1,
    });
  });

  it("reports every new field as null when the provider supplies none of them", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "not-loaded",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: now(),
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(response.body).toMatchObject({
      inferenceDevice: null,
      acceleratorLabel: null,
      acceleratorAdapter: null,
      acceleratorVerification: null,
    });
  });

  it("reports all new fields as null for the mock provider", async () => {
    const response = await request(appWithProvider(new MockProvider())).get("/api/ai/status");

    expect(response.body).toMatchObject({
      provider: "mock",
      inferenceDevice: null,
      acceleratorLabel: null,
      acceleratorAdapter: null,
      acceleratorVerification: null,
    });
  });

  it("never exposes the verification input", async () => {
    const app = appWithProvider(
      fakeProvider({
        state: "ready",
        modelId: "fake-model",
        acceleratorRequested: true,
        acceleratorActive: true,
        updatedAt: now(),
        inferenceDevice: "accelerator",
        acceleratorLabel: "Accelerator",
        acceleratorVerification: { outcome: "passed", durationMs: 10, tokensPerSecond: 2, canaryVersion: 1 },
      }),
    );

    const response = await request(app).get("/api/ai/status");

    expect(JSON.stringify(response.body)).not.toContain("Reply with exactly");
  });
});
