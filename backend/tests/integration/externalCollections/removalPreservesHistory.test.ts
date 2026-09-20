import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

function validCollection() {
  return {
    info: { name: "c" },
    item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets/1" } }],
  };
}

function validEnvironment(baseUrl: string) {
  return { name: "env", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] };
}

async function pollUntilSettled(
  agent: ReturnType<typeof request.agent>,
  uploadedCollectionId: string,
  runId: string,
  timeoutMs = POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${uploadedCollectionId}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") return response;
    if (Date.now() > deadline) throw new Error(`Run ${runId} was still "in-progress" after ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("external collections: removal does not alter run history (US3, FR-017, quickstart.md Scenario 6)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("a run remains fully retrievable by its own id after its UploadedCollectionSet is deleted", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });

    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(validCollection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(validEnvironment(baseUrl))), "environment.json");
    const uploadedCollectionId = uploaded.body.uploadedCollection.id;

    const started = await agent
      .post(`/api/external-collections/${uploadedCollectionId}/execution/start`)
      .send({ confirmed: true });
    const settled = await pollUntilSettled(agent, uploadedCollectionId, started.body.run.id);
    expect(settled.body.run.status).toBe("completed");
    const snapshotBeforeDeletion = settled.body.run.uploadedCollectionSnapshot;

    const removed = await agent.delete(`/api/external-collections/${uploadedCollectionId}`);
    expect(removed.status).toBe(204);

    const afterDeletion = await agent.get(
      `/api/external-collections/${uploadedCollectionId}/execution/runs/${started.body.run.id}`,
    );
    expect(afterDeletion.status).toBe(200);
    expect(afterDeletion.body.run.uploadedCollectionSnapshot).toEqual(snapshotBeforeDeletion);
    expect(afterDeletion.body.run.results).toEqual(settled.body.run.results);
  }, 60_000);
});
