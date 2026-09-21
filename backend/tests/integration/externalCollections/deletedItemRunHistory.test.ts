import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

function collectionWithOneRequest() {
  return {
    info: { name: "c" },
    item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } }],
  };
}

function environment(baseUrl: string) {
  return { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };
}

async function pollUntilSettled(agent: ReturnType<typeof request.agent>, id: string, runId: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${id}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return response;
    if (Date.now() > deadline) throw new Error(`Run ${runId} never settled.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("AP-028: deleting a request does not alter a past run's own recorded snapshot", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("keeps the original request name/result in run history after the request is deleted", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets", { status: 200, body: {} });

    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithOneRequest())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const requestId = view.items[0].id;

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    const settled = await pollUntilSettled(agent, id, started.body.run.id);
    expect(settled.body.run.results[0]).toMatchObject({ requestName: "Get widget", outcome: "passed" });

    const deleteResponse = await agent.delete(`/api/external-collections/${id}/items/${requestId}`);
    expect(deleteResponse.status).toBe(200);

    const runAfterDeletion = await agent.get(`/api/external-collections/${id}/execution/runs/${started.body.run.id}`);
    expect(runAfterDeletion.status).toBe(200);
    expect(runAfterDeletion.body.run.results[0]).toMatchObject({ requestName: "Get widget", outcome: "passed" });
  }, 60_000);
});
