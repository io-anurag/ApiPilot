import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { crudChainApiModel, dissimilarNameAiApiModel } from "../fixtures/dependencies/dependencyFixtures";

const ENDPOINT = "/api/api-models/dependencies";
const AI_RATIONALE_MARKER = "unique-ai-rationale-marker-for-diagnostics-test";

function providerThatLeaksIfLogged(): AIProvider {
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
      status: "error",
      errorCategory: "PROVIDER_UNAVAILABLE",
      errorMessage: AI_RATIONALE_MARKER,
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`${ENDPOINT} diagnostics`, () => {
  it("keeps ApiModel content out of the log during a successful analysis", async () => {
    await request(createApp()).post(ENDPOINT).send({ apiModel: crudChainApiModel });

    expect(logged.join("\n")).not.toContain("createUser");
  });

  it("keeps the AI provider's raw error message out of the log and response when it degrades", async () => {
    const response = await request(createApp(providerThatLeaksIfLogged()))
      .post(ENDPOINT)
      .send({ apiModel: dissimilarNameAiApiModel });

    expect(response.status).toBe(200);
    expect(response.body.aiOutcome).toBe("unavailable");
    expect(JSON.stringify(response.body)).not.toContain(AI_RATIONALE_MARKER);
    expect(logged.join("\n")).not.toContain(AI_RATIONALE_MARKER);
  });

  it("returns a safe 400 error body carrying no stack trace or filesystem path", async () => {
    const response = await request(createApp()).post(ENDPOINT).send({});

    expect(response.status).toBe(400);
    expect(response.body.stack).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Za-z]:\\|\/src\/|node_modules/);
  });
});
