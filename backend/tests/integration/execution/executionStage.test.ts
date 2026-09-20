import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { TargetServer } from "../../fixtures/execution/targetServer";
import {
  VALID_SPECIFICATION_FILENAME,
  validSpecificationBuffer,
} from "../../fixtures/testGenerationWorkflow/workflowFixtures";

/**
 * Integration coverage for the 2026-09-20 amendment (specs/009 Clarifications) that splits
 * `execution` out of the `postmanGeneration` screen into its own, explicitly skippable
 * guided-workflow stage.
 */
describe("execution stage (specs/009 Clarifications 2026-09-20)", () => {
  it("auto-advances to 'execution', active, the first time postmanGeneration completes", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const workflow = await driveToPostmanGenerationComplete(agent);

    expect(workflow.stages.postmanGeneration.status).toBe("complete");
    expect(workflow.stages.execution.status).toBe("active");
    expect(workflow.activeStageId).toBe("execution");
  });

  it("regenerating the collection again does not re-advance activeStageId away from wherever the user is", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    // Simulate the user having navigated back to review the collection, then regenerating.
    const response = await agent
      .post("/api/test-generation-workflow/postman-generation")
      .send({ options: {} });
    expect(response.status).toBe(200);
    expect(response.body.workflow.activeStageId).toBe("execution");
    expect(response.body.workflow.stages.execution.status).toBe("active");
  });

  it("skips execution without running anything", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent.post("/api/test-generation-workflow/execution/skip");
    expect(response.status).toBe(200);
    expect(response.body.workflow.stages.execution.status).toBe("skipped");
  });

  it("finishes execution explicitly", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent.post("/api/test-generation-workflow/execution/finish");
    expect(response.status).toBe(200);
    expect(response.body.workflow.stages.execution.status).toBe("complete");
  });

  it("refuses to skip or finish execution before postmanGeneration has completed", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent
      .post("/api/test-generation-workflow")
      .attach("file", validSpecificationBuffer(), VALID_SPECIFICATION_FILENAME);

    const skipResponse = await agent.post("/api/test-generation-workflow/execution/skip");
    expect(skipResponse.status).toBe(409);
    expect(skipResponse.body.error).toBe("stage_not_active");

    const finishResponse = await agent.post("/api/test-generation-workflow/execution/finish");
    expect(finishResponse.status).toBe(409);
    expect(finishResponse.body.error).toBe("stage_not_active");
  });

  it("refuses to skip execution a second time once already skipped", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);
    await agent.post("/api/test-generation-workflow/execution/skip");

    const response = await agent.post("/api/test-generation-workflow/execution/skip");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });

  describe("reactivation on run start", () => {
    let targetServer: TargetServer;

    beforeEach(() => {
      resetStore();
      targetServer = new TargetServer();
    });

    afterEach(async () => {
      await targetServer.stop();
    });

    it("reopens a skipped execution stage the moment a run actually starts", async () => {
      const baseUrl = await targetServer.start();
      targetServer.configure("GET", "/pets", { status: 200, body: [] });

      const app = createApp();
      const agent = request.agent(app);
      await driveToPostmanGenerationComplete(agent);
      await agent.post("/api/test-generation-workflow/execution/skip");

      const env = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Local",
        tier: "local",
        baseUrl,
        variableValues: { apiKey: "test-key" },
      });
      const started = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: env.body.environment.id, confirmed: true });
      expect(started.status).toBe(200);

      const current = await agent.get("/api/test-generation-workflow");
      expect(current.body.workflow.stages.execution.status).toBe("active");
    });

    it("reopens a finished execution stage the moment a run actually starts", async () => {
      const baseUrl = await targetServer.start();
      targetServer.configure("GET", "/pets", { status: 200, body: [] });

      const app = createApp();
      const agent = request.agent(app);
      await driveToPostmanGenerationComplete(agent);
      await agent.post("/api/test-generation-workflow/execution/finish");

      const env = await agent.post("/api/test-generation-workflow/environments").send({
        name: "Local",
        tier: "local",
        baseUrl,
        variableValues: { apiKey: "test-key" },
      });
      const started = await agent
        .post("/api/test-generation-workflow/execution/start")
        .send({ environmentId: env.body.environment.id, confirmed: true });
      expect(started.status).toBe(200);

      const current = await agent.get("/api/test-generation-workflow");
      expect(current.body.workflow.stages.execution.status).toBe("active");
    });
  });
});
