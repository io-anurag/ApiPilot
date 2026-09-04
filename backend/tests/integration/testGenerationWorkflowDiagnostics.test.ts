import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, InferenceResponse } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import {
  VALID_SPECIFICATION_FILENAME,
  validSpecificationBuffer,
} from "../fixtures/testGenerationWorkflow/workflowFixtures";

const AI_RATIONALE_MARKER = "unique-ai-rationale-marker-for-workflow-diagnostics-test";
const SPEC_MARKER = "listPets"; // an operationId present in valid.yaml

function providerThatLeaksIfLogged(): AIProvider {
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
  resetStore();
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

describe("test generation workflow diagnostics", () => {
  it("keeps the AI provider's raw error message out of the log and response when AI enhancement degrades (FR-016)", async () => {
    const app = createApp(providerThatLeaksIfLogged());
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");

    const response = await request(app).post(
      "/api/test-generation-workflow/ai-enhancement",
    );

    expect(response.status).toBe(200);
    expect(response.body.workflow.stages.aiEnhancement.status).toBe("skipped");
    expect(JSON.stringify(response.body)).not.toContain(AI_RATIONALE_MARKER);
    expect(logged.join("\n")).not.toContain(AI_RATIONALE_MARKER);
  });

  it("keeps specification content out of the log during a normal sequence", async () => {
    const app = createApp();
    await request(app)
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await request(app).post("/api/test-generation-workflow/api-review/continue");
    await request(app).post("/api/test-generation-workflow/deterministic-generation");

    expect(logged.join("\n")).not.toContain(SPEC_MARKER);
  });

  it("returns a safe error body with no stack trace or filesystem path for a bad request", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-generation-workflow/scenario-review/decisions")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.stack).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Za-z]:\\|\/src\/|node_modules/);
  });
});
