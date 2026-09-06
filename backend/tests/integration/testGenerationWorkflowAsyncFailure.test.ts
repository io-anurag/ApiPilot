import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import {
  VALID_SPECIFICATION_FILENAME,
  validSpecificationBuffer,
} from "../fixtures/testGenerationWorkflow/workflowFixtures";

/**
 * Regression coverage for unexpected failures inside the workflow's **async** route handlers.
 *
 * Express 4 does not catch a rejected promise returned by an async handler, so a route that
 * re-threw an unexpected error produced an unhandled rejection — which terminates the process
 * under Node's default policy. Because a workflow lives only in memory, that discarded the
 * user's entire session (specification, generated scenarios, every review decision) and the
 * client saw a dropped connection rather than any response at all.
 *
 * These tests assert the contract that replaced it: the error reaches `app.ts`'s centralized
 * handler, the client gets a safe 500, and the process survives to serve the next request.
 */

/** A provider that fails the way an unexpected internal fault does: by rejecting, not by returning an error response. */
function throwingProvider(): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => {
      throw new Error("engine exploded");
    },
    infer: async () => {
      throw new Error("engine exploded");
    },
  };
}

async function driveToAiEnhancement(app: ReturnType<typeof createApp>): Promise<void> {
  await request(app)
    .post("/api/test-generation-workflow?discardExisting=true")
    .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
  await request(app).post("/api/test-generation-workflow/api-review/continue");
  await request(app).post("/api/test-generation-workflow/deterministic-generation");
}

describe("async workflow routes surface unexpected failures as a safe 500", () => {
  beforeEach(() => resetStore());

  it("returns 500 from POST /ai-enhancement instead of escaping the handler as an unhandled rejection", async () => {
    const app = createApp(throwingProvider());
    await driveToAiEnhancement(app);

    const response = await request(app).post("/api/test-generation-workflow/ai-enhancement");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal_server_error" });
  });

  it("leaks no diagnostic detail in the 500 body (constitution XX)", async () => {
    const app = createApp(throwingProvider());
    await driveToAiEnhancement(app);

    const response = await request(app).post("/api/test-generation-workflow/ai-enhancement");

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("engine exploded");
    expect(serialized).not.toContain("stack");
    expect(response.body).not.toHaveProperty("message");
  });

  it("keeps serving after the failure, so the workflow is not lost with the process", async () => {
    const app = createApp(throwingProvider());
    await driveToAiEnhancement(app);

    await request(app).post("/api/test-generation-workflow/ai-enhancement");

    // The same workflow is still readable, with its deterministic scenarios intact — the
    // behaviour a terminated process could not provide.
    const after = await request(app).get("/api/test-generation-workflow");
    expect(after.status).toBe(200);
    expect(after.body.workflow.deterministicTestModel.scenarios.length).toBeGreaterThan(0);
  });
});
