import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { uploadQuick } from "../../fixtures/performance/quickAgent";

describe("environments routes", () => {
  beforeEach(() => {
    resetStore();
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

  describe("AP-032: open to a session with a quick performance test (FR-016 to FR-018, SC-006)", () => {
    beforeEach(() => resetQuickTestsForTest());

    const ENVIRONMENT = { name: "quick-local", tier: "local", baseUrl: "http://127.0.0.1:4600" };

    it("refuses every environments route with neither a completed Postman generation nor a quick test", async () => {
      const agent = request.agent(createApp());
      // A guided workflow that has only been uploaded does not open environments either.
      await agent.post("/api/test-generation-workflow").attach("file", Buffer.from("openapi: 3.0.3\ninfo:\n  title: t\n  version: '1'\npaths: {}\n"), "a.yaml");
      for (const response of [
        await agent.get("/api/test-generation-workflow/environments"),
        await agent.post("/api/test-generation-workflow/environments").send(ENVIRONMENT),
        await agent.put("/api/test-generation-workflow/environments/x").send(ENVIRONMENT),
      ]) {
        expect(response.status).toBe(409);
        expect(response.body.error).toBe("stage_not_active");
      }
    });

    it("creates, lists and edits environments with only a quick test", async () => {
      const agent = request.agent(createApp());
      expect((await uploadQuick(agent)).status).toBe(200);
      const created = await agent.post("/api/test-generation-workflow/environments").send(ENVIRONMENT);
      expect(created.status).toBe(200);
      expect((await agent.get("/api/test-generation-workflow/environments")).body.environments).toHaveLength(1);
      const updated = await agent
        .put(`/api/test-generation-workflow/environments/${created.body.environment.id}`)
        .send({ ...ENVIRONMENT, variableValues: { password: "p" } });
      expect(updated.status).toBe(200);
    });

    it("shares one set of environments between the quick test and the guided workflow, within the session only (US3 AS2)", async () => {
      const agent = request.agent(createApp());
      await uploadQuick(agent);
      await agent.post("/api/test-generation-workflow/environments").send(ENVIRONMENT);
      await driveToPostmanGenerationComplete(agent);
      await agent.post("/api/test-generation-workflow/environments").send({ ...ENVIRONMENT, name: "guided-local" });

      const names = (await agent.get("/api/test-generation-workflow/environments")).body.environments.map((entry: { name: string }) => entry.name).sort();
      expect(names).toEqual(["guided-local", "quick-local"]);

      const other = request.agent(createApp());
      await uploadQuick(other);
      expect((await other.get("/api/test-generation-workflow/environments")).body.environments).toEqual([]);
    });

    it("keeps the functional execution routes gated on Postman generation (FR-018)", async () => {
      const agent = request.agent(createApp());
      await uploadQuick(agent);
      const response = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId: "x" });
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("stage_not_active");
    });
  });
});
