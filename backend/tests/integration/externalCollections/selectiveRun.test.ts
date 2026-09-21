import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

function collectionWithTwoRequests() {
  return {
    info: { name: "c" },
    item: [
      { name: "GET ping", request: { method: "GET", url: "{{baseUrl}}/ping" } },
      { name: "POST auth", request: { method: "POST", url: "{{baseUrl}}/auth" } },
    ],
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

describe("POST /api/external-collections/:id/execution/start with selectedRequestIds (Postman-Runner-style selective run)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("runs only the selected request, and the run's results/summary reflect only that subset", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/ping", { status: 200, body: {} });

    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithTwoRequests())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const collectionView = await agent.get(`/api/external-collections/${id}/collection`);
    const pingId = collectionView.body.collectionView.items.find((i: { name: string }) => i.name === "GET ping").id;

    // Selecting only the non-destructive GET means gate 2 (destructive/risk-tier) never fires for
    // this run, even though the collection as a whole also contains a destructive POST — proving
    // the gate is scoped to the selection, not the whole collection.
    const started = await agent
      .post(`/api/external-collections/${id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: [pingId] });
    expect(started.status).toBe(200);

    const finalResponse = await pollUntilSettled(agent, id, started.body.run.id);
    const run = finalResponse.body.run;
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ requestName: "GET ping", outcome: "passed" });
    expect(run.summary).toMatchObject({ total: 1, passed: 1 });
  }, 60_000);

  it("400s no_requests_selected when selectedRequestIds matches nothing in the collection", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithTwoRequests())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment("http://localhost"))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const started = await agent
      .post(`/api/external-collections/${id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: ["does-not-exist"] });
    expect(started.status).toBe(400);
    expect(started.body.error).toBe("no_requests_selected");
  });

  it("omitting selectedRequestIds still runs every request, unchanged from before this field existed", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/ping", { status: 200, body: {} });
    targetServer.configure("POST", "/auth", { status: 200, body: {} });

    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithTwoRequests())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    // The destructive POST is present and unfiltered, so gate 2 fires exactly as it always has.
    const firstAttempt = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(firstAttempt.status).toBe(409);
    expect(firstAttempt.body.error).toBe("confirmation_required");

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(started.status).toBe(200);
    const finalResponse = await pollUntilSettled(agent, id, started.body.run.id);
    expect(finalResponse.body.run.results).toHaveLength(2);
  }, 60_000);
});
