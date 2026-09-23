import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

async function pollUntilSettled(agent: ReturnType<typeof request.agent>, id: string, runId: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${id}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return response;
    if (Date.now() > deadline) throw new Error(`Run ${runId} never settled.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("external collections: a missing variable value does not refuse the run", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("starts the run anyway and dispatches the request with the variable left unresolved", async () => {
    const baseUrl = await targetServer.start();

    const collection = {
      info: { name: "c" },
      item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets/{{widgetId}}" } }],
    };
    // The environment supplies baseUrl but not the also-referenced 'widgetId'.
    const environment = { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };

    const app = createApp();
    const agent = request.agent(app);

    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment)), "environment.json");
    expect(uploadResponse.status).toBe(201);
    const id = uploadResponse.body.uploadedCollection.id;

    const view = await agent.get(`/api/external-collections/${id}/collection`);
    expect(view.body.collectionView.items[0].unresolvedVariables).toEqual(["widgetId"]);

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(started.status).toBe(200);

    const finalResponse = await pollUntilSettled(agent, id, started.body.run.id);
    expect(finalResponse.body.run.status).toBe("completed");
    expect(finalResponse.body.run.results).toHaveLength(1);
    expect(finalResponse.body.run.results[0].outcome).not.toBe("not-attempted");
    expect(targetServer.requests).toHaveLength(1);
  }, 60_000);
});
