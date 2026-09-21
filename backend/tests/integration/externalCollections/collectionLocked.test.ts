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

describe("AP-028 collection locked while a run is in progress (US4 FR-017, quickstart.md Scenario 6)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("refuses every mutating endpoint with 409 collection_locked while a run is in progress, and allows them again once it settles", async () => {
    const baseUrl = await targetServer.start();
    // A slow endpoint keeps the run "in-progress" long enough to observe the lock.
    targetServer.configure("GET", "/widgets", { status: 200, body: {}, delayMs: 500 });

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
    expect(started.body.run.status).toBe("in-progress");

    const lockedVariables = await agent.put(`/api/external-collections/${id}/variables`).send({ variableValues: {} });
    expect(lockedVariables.status).toBe(409);
    expect(lockedVariables.body.error).toBe("collection_locked");

    const lockedEdit = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ method: "GET", url: "https://example.test", headers: [] });
    expect(lockedEdit.status).toBe(409);
    expect(lockedEdit.body.error).toBe("collection_locked");

    const lockedAdd = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: null, name: "x", method: "GET", url: "https://example.test", headers: [] });
    expect(lockedAdd.status).toBe(409);

    const lockedDelete = await agent.delete(`/api/external-collections/${id}/items/${requestId}`);
    expect(lockedDelete.status).toBe(409);

    const lockedRename = await agent.put(`/api/external-collections/${id}/items/${requestId}/rename`).send({ name: "x" });
    expect(lockedRename.status).toBe(409);

    const lockedOrder = await agent
      .put(`/api/external-collections/${id}/containers/root/order`)
      .send({ orderedIds: [requestId] });
    expect(lockedOrder.status).toBe(409);

    await pollUntilSettled(agent, id, started.body.run.id);

    const afterCompletion = await agent
      .put(`/api/external-collections/${id}/items/${requestId}/rename`)
      .send({ name: "Now allowed" });
    expect(afterCompletion.status).toBe(200);
  }, 60_000);
});
