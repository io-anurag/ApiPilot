import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { driveToPostmanGenerationComplete } from "../../fixtures/execution/driveWorkflow";
import { TargetServer } from "../../fixtures/execution/targetServer";

function slowCollection() {
  return {
    info: { name: "c" },
    item: [{ name: "Slow request", request: { method: "GET", url: "{{baseUrl}}/slow" } }],
  };
}

function environment(baseUrl: string) {
  return { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };
}

describe("external collections: shared execution slot (US3, FR-015, research.md D7, quickstart.md Scenario 5)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    resetStore();
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("an in-progress uploaded run blocks a second uploaded run, and blocks a generated-collection run", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/slow", { status: 200, body: {}, delayMs: 2000 });

    const app = createApp();
    const uploadedAgent = request.agent(app);

    const uploaded = await uploadedAgent
      .post("/api/external-collections")
      .field("name", "uc-1")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(slowCollection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const uploadedId = uploaded.body.uploadedCollection.id;

    const started = await uploadedAgent
      .post(`/api/external-collections/${uploadedId}/execution/start`)
      .send({ confirmed: true });
    expect(started.status).toBe(200);
    expect(started.body.run.status).toBe("in-progress");

    // A second uploaded collection, same session, refused while the first is still running.
    const secondUpload = await uploadedAgent
      .post("/api/external-collections")
      .field("name", "uc-2")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(slowCollection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const secondBlocked = await uploadedAgent
      .post(`/api/external-collections/${secondUpload.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true });
    expect(secondBlocked.status).toBe(409);
    expect(secondBlocked.body.error).toBe("execution_in_progress");
    expect(secondBlocked.body.runId).toBe(started.body.run.id);

    // The same session's generated-workflow execution/start is also refused (FR-015, D7).
    await driveToPostmanGenerationComplete(uploadedAgent);
    const env = await uploadedAgent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "Local", tier: "local", baseUrl, variableValues: {} });
    const generatedBlocked = await uploadedAgent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(generatedBlocked.status).toBe(409);
    expect(generatedBlocked.body.error).toBe("execution_in_progress");
    expect(generatedBlocked.body.runId).toBe(started.body.run.id);
  }, 30_000);

  it("an in-progress generated-collection run blocks starting a new uploaded-collection run", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/pets", { status: 200, body: [], delayMs: 2000 });
    targetServer.configure("POST", "/pets", { status: 201, body: {}, delayMs: 2000 });
    targetServer.configure("GET", "/pets/1", { status: 200, body: {}, delayMs: 2000 });

    const app = createApp();
    const agent = request.agent(app);
    await driveToPostmanGenerationComplete(agent);
    const env = await agent
      .post("/api/test-generation-workflow/environments")
      .send({ name: "Local", tier: "local", baseUrl, variableValues: { apiKey: "test-key" } });
    const generatedStarted = await agent
      .post("/api/test-generation-workflow/execution/start")
      .send({ environmentId: env.body.environment.id, confirmed: true });
    expect(generatedStarted.status).toBe(200);
    expect(generatedStarted.body.run.status).toBe("in-progress");

    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc-1")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(slowCollection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const blocked = await agent
      .post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("execution_in_progress");
  }, 30_000);
});
