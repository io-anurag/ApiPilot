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

  it("runs the selected requests in the order given, across folders, each with its own folder's auth, without changing the collection (FR-019)", async () => {
    const baseUrl = await targetServer.start();
    const app = createApp();
    const agent = request.agent(app);
    const collection = {
      info: { name: "c" },
      item: [
        {
          name: "Auth",
          auth: { type: "bearer", bearer: [{ key: "token", value: "folder-token", type: "string" }] },
          item: [{ name: "GET token", request: { method: "GET", url: "{{baseUrl}}/token" } }],
        },
        {
          name: "Meta",
          item: [
            { name: "GET health", request: { method: "GET", url: "{{baseUrl}}/health" } },
            { name: "GET version", request: { method: "GET", url: "{{baseUrl}}/version" } },
          ],
        },
      ],
    };
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "Ordered")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const before = await agent.get(`/api/external-collections/${id}/collection`);
    const [authFolder, metaFolder] = before.body.collectionView.folders;
    const tokenId = authFolder.items[0].id;
    const [healthId, versionId] = metaFolder.items.map((item: { id: string }) => item.id);

    const started = await agent
      .post(`/api/external-collections/${id}/execution/start`)
      .send({ confirmed: true, selectedRequestIds: [versionId, tokenId, healthId] });
    expect(started.status).toBe(200);
    const run = (await pollUntilSettled(agent, id, started.body.run.id)).body.run;

    expect(run.results.map((result: { requestName: string }) => result.requestName)).toEqual([
      "GET version",
      "GET token",
      "GET health",
    ]);
    expect(targetServer.requests.map((received) => received.path)).toEqual(["/version", "/token", "/health"]);
    expect(targetServer.requests[1].headers.authorization).toBe("Bearer folder-token");
    expect(targetServer.requests[0].headers.authorization).toBeUndefined();

    const after = await agent.get(`/api/external-collections/${id}/collection`);
    expect(after.body.collectionView.folders).toEqual(before.body.collectionView.folders);
  }, 60_000);

  it("400s invalid_run_order for a repeated id or an id the collection does not contain (FR-019)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithTwoRequests())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment("http://localhost"))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;
    const collectionView = await agent.get(`/api/external-collections/${id}/collection`);
    const pingId = collectionView.body.collectionView.items.find((i: { name: string }) => i.name === "GET ping").id;

    for (const selectedRequestIds of [[pingId, pingId], [pingId, "does-not-exist"]]) {
      const started = await agent
        .post(`/api/external-collections/${id}/execution/start`)
        .send({ confirmed: true, selectedRequestIds });
      expect(started.status).toBe(400);
      expect(started.body.error).toBe("invalid_run_order");
    }
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
