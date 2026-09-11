import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { resetEnvironmentStore } from "../../../src/execution/environmentStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";

describe("environments routes", () => {
  beforeEach(() => {
    resetStore();
    resetEnvironmentStore();
  });

  it("refuses every environments route until postmanGeneration is complete (409 stage_not_active)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const response = await agent.get("/api/test-generation-workflow/environments");
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("stage_not_active");
  });

  it("creates, lists, and updates an environment once postmanGeneration is complete", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const created = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl: "http://localhost:4000",
      variableValues: { "apiKey": "test-key" },
      requestDelayMs: 0,
    });
    expect(created.status).toBe(200);
    expect(created.body.environment.name).toBe("Local");

    const list = await agent.get("/api/test-generation-workflow/environments");
    expect(list.status).toBe(200);
    expect(list.body.environments).toHaveLength(1);

    const updated = await agent
      .put(`/api/test-generation-workflow/environments/${created.body.environment.id}`)
      .send({
        name: "Local",
        tier: "local",
        baseUrl: "http://localhost:5000",
        variableValues: { "apiKey": "test-key" },
        requestDelayMs: 100,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.environment.baseUrl).toBe("http://localhost:5000");
  });

  it("rejects a duplicate environment name with 409 (FR-003)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl: "http://localhost:4000",
    });
    const conflict = await agent.post("/api/test-generation-workflow/environments").send({
      name: "Local",
      tier: "local",
      baseUrl: "http://localhost:4001",
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("duplicate_environment_name");
  });

  it("returns 404 environment_not_found for an unknown id", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent
      .put("/api/test-generation-workflow/environments/does-not-exist")
      .send({ name: "Local", tier: "local", baseUrl: "http://localhost:4000" });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("environment_not_found");
  });

  it("returns 400 invalid_request for a missing/invalid tier", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);

    const response = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "Local", tier: "not-a-real-tier", baseUrl: "http://localhost:4000" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });
});
