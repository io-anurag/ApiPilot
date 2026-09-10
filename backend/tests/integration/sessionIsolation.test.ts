import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { resetStore } from "../../src/testGenerationWorkflow/workflowStore";
import { forceExpireForTest, resetRegistryForTest } from "../../src/session/sessionRegistry";
import {
  SECOND_SPECIFICATION_FILENAME,
  VALID_SPECIFICATION_FILENAME,
  secondSpecificationBuffer,
  validSpecificationBuffer,
} from "../fixtures/testGenerationWorkflow/workflowFixtures";

/**
 * Covers specs/017-session-workflow-isolation's three user stories: concurrent sessions never
 * collide (US1), a single browser's own continuity is unchanged (US2), and a new/lost/expired
 * session is always handled safely (US3). See quickstart.md Scenarios 1-3, 5, 6.
 */

function fixedProvider(content: string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    infer: async (req) => ({
      contractVersion: 1,
      requestId: req.requestId,
      status: "success",
      content,
      modelId: "mock-model",
      provider: "mock",
      durationMs: 1,
    }),
  };
}

const emptyCandidates = JSON.stringify({ responseVersion: 1, candidates: [] });

/** Reads the `sessionId` cookie value the server just issued on this response. */
function extractSessionId(response: request.Response): string {
  const setCookie = response.headers["set-cookie"] as unknown as string[] | string | undefined;
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /sessionId=([^;]+)/.exec(header ?? "");
  if (!match) throw new Error("Response carried no sessionId cookie");
  return match[1];
}

describe("session isolation", () => {
  beforeEach(() => {
    resetStore();
    resetRegistryForTest();
  });

  it("US1: two concurrent sessions run independent workflows with zero cross-session visibility (FR-001, FR-003, FR-010)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    const startedA = await agentA
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    const startedB = await agentB
      .post("/api/test-generation-workflow")
      .attach("file", secondSpecificationBuffer(), SECOND_SPECIFICATION_FILENAME);
    expect(startedA.status).toBe(200);
    expect(startedB.status).toBe(200);
    expect(startedA.body.workflow.specificationFilename).toBe(VALID_SPECIFICATION_FILENAME);
    expect(startedB.body.workflow.specificationFilename).toBe(SECOND_SPECIFICATION_FILENAME);
    expect(startedA.body.workflow.id).not.toBe(startedB.body.workflow.id);

    // Interleaved: advance A, then B, re-checking each still reflects only its own spec.
    const afterReviewA = await agentA.post("/api/test-generation-workflow/api-review/continue");
    const afterReviewB = await agentB.post("/api/test-generation-workflow/api-review/continue");
    expect(afterReviewA.body.workflow.specificationFilename).toBe(VALID_SPECIFICATION_FILENAME);
    expect(afterReviewB.body.workflow.specificationFilename).toBe(SECOND_SPECIFICATION_FILENAME);

    const genA = await agentA.post("/api/test-generation-workflow/deterministic-generation");
    const genB = await agentB.post("/api/test-generation-workflow/deterministic-generation");
    expect(genA.body.workflow.specificationFilename).toBe(VALID_SPECIFICATION_FILENAME);
    expect(genB.body.workflow.specificationFilename).toBe(SECOND_SPECIFICATION_FILENAME);

    // A independently reviewing/advancing must never be visible to B, and vice versa.
    const getA = await agentA.get("/api/test-generation-workflow");
    const getB = await agentB.get("/api/test-generation-workflow");
    expect(getA.body.workflow.id).toBe(startedA.body.workflow.id);
    expect(getB.body.workflow.id).toBe(startedB.body.workflow.id);
    expect(getA.body.workflow.specificationFilename).toBe(VALID_SPECIFICATION_FILENAME);
    expect(getB.body.workflow.specificationFilename).toBe(SECOND_SPECIFICATION_FILENAME);
  });

  it("US1: a guessed/mutated session cookie never returns another live session's workflow (FR-004a, FR-010)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agentA = request.agent(app);
    const started = await agentA
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    expect(started.status).toBe(200);

    const real = extractSessionId(started);
    // Flip one character so it is not a session id the server ever issued.
    const guessed = real[0] === "0" ? `1${real.slice(1)}` : `0${real.slice(1)}`;

    const response = await request(app)
      .get("/api/test-generation-workflow")
      .set("Cookie", `sessionId=${guessed}`);

    expect(response.status).toBe(204);
  });

  it("US1: the shared AI provider serves both sessions' AI enhancement independently (FR-005, FR-009)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    await agentA
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await agentA.post("/api/test-generation-workflow/api-review/continue");
    await agentA.post("/api/test-generation-workflow/deterministic-generation");

    await agentB
      .post("/api/test-generation-workflow")
      .attach("file", secondSpecificationBuffer(), SECOND_SPECIFICATION_FILENAME);
    await agentB.post("/api/test-generation-workflow/api-review/continue");
    await agentB.post("/api/test-generation-workflow/deterministic-generation");

    const enhancedA = await agentA.post("/api/test-generation-workflow/ai-enhancement");
    const enhancedB = await agentB.post("/api/test-generation-workflow/ai-enhancement");

    expect(enhancedA.status).toBe(200);
    expect(enhancedB.status).toBe(200);
    expect(enhancedA.body.workflow.stages.aiEnhancement.status).toBe("complete");
    expect(enhancedB.body.workflow.stages.aiEnhancement.status).toBe("complete");
    expect(enhancedA.body.workflow.specificationFilename).toBe(VALID_SPECIFICATION_FILENAME);
    expect(enhancedB.body.workflow.specificationFilename).toBe(SECOND_SPECIFICATION_FILENAME);
  });

  it("US2: a reload and a second tab in the same browser both resume the same in-progress workflow unchanged (FR-002)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agent = request.agent(app);

    const started = await agent
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    await agent.post("/api/test-generation-workflow/api-review/continue");

    const reload = await agent.get("/api/test-generation-workflow");
    const secondTab = await agent.get("/api/test-generation-workflow");

    expect(reload.status).toBe(200);
    expect(secondTab.status).toBe(200);
    expect(reload.body.workflow.id).toBe(started.body.workflow.id);
    expect(secondTab.body.workflow.id).toBe(started.body.workflow.id);
    expect(reload.body.workflow.activeStageId).toBe(secondTab.body.workflow.activeStageId);
  });

  it("US3: an unrecognized/absent session always sees a clean 204, even while another session has an active workflow (FR-006)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agentA = request.agent(app);
    await agentA
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);

    const freshNoCookie = await request(app).get("/api/test-generation-workflow");

    expect(freshNoCookie.status).toBe(204);
  });

  it("US3: an idle-evicted session sees an explicit expiry notice, and a still-active second session is unaffected (FR-007, FR-007a)", async () => {
    const app = createApp(fixedProvider(emptyCandidates));
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    const startedA = await agentA
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);
    const startedB = await agentB
      .post("/api/test-generation-workflow")
      .attach("file", secondSpecificationBuffer(), SECOND_SPECIFICATION_FILENAME);

    forceExpireForTest(extractSessionId(startedA));

    const afterExpiryA = await agentA.get("/api/test-generation-workflow");
    expect(afterExpiryA.status).toBe(200);
    expect(afterExpiryA.body).toEqual({ workflow: null, sessionExpired: true });

    const stillB = await agentB.get("/api/test-generation-workflow");
    expect(stillB.status).toBe(200);
    expect(stillB.body.workflow.id).toBe(startedB.body.workflow.id);
  });
});
