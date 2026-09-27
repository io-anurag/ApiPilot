import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

function collectionWithOneRequest() {
  return {
    info: { name: "c" },
    item: [{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets/1" } }],
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

describe("PUT /api/external-collections/:id/requests/:requestId (AP-028 US4, quickstart.md Scenario 4)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("updates the stored item, and a subsequent run's result carries wasEdited: true", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/2", { status: 200, body: { id: 2 } });

    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithOneRequest())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const collectionView = await agent.get(`/api/external-collections/${id}/collection`);
    const requestId = collectionView.body.collectionView.items[0].id;

    const editResponse = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ method: "GET", url: "{{baseUrl}}/widgets/2", headers: [] });
    expect(editResponse.status).toBe(200);
    expect(editResponse.body.collectionView.items[0].wasEdited).toBe(true);
    expect(editResponse.body.collectionView.items[0].raw.url).toBe("{{baseUrl}}/widgets/2");

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    const finalResponse = await pollUntilSettled(agent, id, started.body.run.id);
    expect(finalResponse.body.run.results[0]).toMatchObject({
      outcome: "passed",
      responseStatusCode: 200,
      wasEdited: true,
    });
  }, 60_000);

  it("a saved test script is surfaced by the collection view and actually runs on the next execution", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });

    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithOneRequest())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const collectionView = await agent.get(`/api/external-collections/${id}/collection`);
    const requestId = collectionView.body.collectionView.items[0].id;
    expect(collectionView.body.collectionView.items[0].testScript).toBeUndefined();

    const testScript = 'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});';
    const editResponse = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ method: "GET", url: "{{baseUrl}}/widgets/1", headers: [], testScript });
    expect(editResponse.status).toBe(200);
    expect(editResponse.body.collectionView.items[0].testScript).toBe(testScript);

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    const finalResponse = await pollUntilSettled(agent, id, started.body.run.id);
    expect(finalResponse.body.run.results[0]).toMatchObject({
      outcome: "passed",
      testOutcomes: [{ name: "Status code is 200", outcome: "passed" }],
    });
  }, 60_000);

  it("keeps every edited request marked across later edits and structural changes, not just the last one", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const twoRequests = {
      info: { name: "c" },
      item: [
        { name: "First", request: { method: "GET", url: "{{baseUrl}}/widgets/1" } },
        { name: "Second", request: { method: "GET", url: "{{baseUrl}}/widgets/2" } },
      ],
    };
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(twoRequests)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment("http://localhost"))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;
    const view = await agent.get(`/api/external-collections/${id}/collection`);
    const [first, second] = view.body.collectionView.items as Array<{ id: string }>;

    await agent.put(`/api/external-collections/${id}/requests/${first.id}`).send({ method: "GET", url: "{{baseUrl}}/a", headers: [] });
    const afterSecondEdit = await agent
      .put(`/api/external-collections/${id}/requests/${second.id}`)
      .send({ method: "GET", url: "{{baseUrl}}/b", headers: [] });
    expect(afterSecondEdit.body.collectionView.items.map((i: { wasEdited: boolean }) => i.wasEdited)).toEqual([true, true]);

    const afterRename = await agent.put(`/api/external-collections/${id}/items/${first.id}/rename`).send({ name: "Renamed" });
    expect(afterRename.body.collectionView.items.map((i: { wasEdited: boolean }) => i.wasEdited)).toEqual([true, true]);
  });

  it("saving the Tests tab as shown never copies a folder's test script onto the request, so it runs once", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });
    const collection = {
      info: { name: "c" },
      item: [
        {
          name: "Widgets",
          event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("folder test", function () {});'] } }],
          item: [
            {
              name: "Get widget",
              request: { method: "GET", url: "{{baseUrl}}/widgets/1" },
              event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("own test", function () {});'] } }],
            },
          ],
        },
      ],
    };

    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "Folder tests")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploaded.body.uploadedCollection.id as string;
    const shown = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView.folders[0].items[0];
    expect(shown.testScript).toBe('pm.test("own test", function () {});');

    const saved = await agent
      .put(`/api/external-collections/${id}/requests/${shown.id}`)
      .send({ method: "GET", url: "{{baseUrl}}/widgets/1", headers: [], testScript: shown.testScript });
    expect(saved.status).toBe(200);

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    const settled = await pollUntilSettled(agent, id, started.body.run.id);
    expect(settled.body.run.results[0].testOutcomes.map((outcome: { name: string }) => outcome.name)).toEqual([
      "folder test",
      "own test",
    ]);
  }, 60_000);

  it("edits the request's own auth, keeps a hidden literal unless replaced, and runs with it (FR-002c)", async () => {
    const baseUrl = await targetServer.start();
    const app = createApp();
    const agent = request.agent(app);
    const collection = {
      info: { name: "c" },
      item: [
        {
          name: "Get widget",
          request: {
            method: "GET",
            url: "{{baseUrl}}/widgets/1",
            auth: { type: "bearer", bearer: [{ key: "token", value: "literal-secret", type: "string" }] },
          },
        },
      ],
    };
    const env = {
      name: "env",
      values: [
        { key: "baseUrl", value: baseUrl, enabled: true },
        { key: "adminToken", value: "admin-123", enabled: true },
      ],
    };
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "Auth edit")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(env)), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;
    const viewResponse = await agent.get(`/api/external-collections/${id}/collection`);
    expect(JSON.stringify(viewResponse.body)).not.toContain("literal-secret");
    const requestId = viewResponse.body.collectionView.items[0].id;
    const fields = { method: "GET", url: "{{baseUrl}}/widgets/1", headers: [] };

    async function runAndReadAuthorization() {
      targetServer.requests.length = 0;
      const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
      expect(started.status).toBe(200);
      await pollUntilSettled(agent, id, started.body.run.id);
      return targetServer.requests[0].headers.authorization;
    }

    const kept = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ ...fields, auth: { type: "bearer", token: { kind: "keep" } } });
    expect(kept.status).toBe(200);
    expect(kept.body.collectionView.items[0].auth.fields).toEqual([{ key: "token", value: "", hiddenLiteral: true }]);
    expect(JSON.stringify(kept.body)).not.toContain("literal-secret");
    expect(await runAndReadAuthorization()).toBe("Bearer literal-secret");

    const replaced = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ ...fields, auth: { type: "bearer", token: { kind: "set", value: "{{adminToken}}" } } });
    expect(replaced.status).toBe(200);
    expect(replaced.body.collectionView.items[0]).toMatchObject({
      wasEdited: true,
      auth: { type: "bearer", source: { kind: "request" }, fields: [{ key: "token", value: "{{adminToken}}", hiddenLiteral: false }] },
      impliedAuthHeader: { rawValue: "Bearer {{adminToken}}", hiddenLiteral: false },
    });
    expect(await runAndReadAuthorization()).toBe("Bearer admin-123");

    const invalid = await agent
      .put(`/api/external-collections/${id}/requests/${requestId}`)
      .send({ ...fields, auth: { type: "basic", username: "u", password: { kind: "keep" } } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_auth_edit");
  }, 60_000);

  it("404s request_not_found for an unknown requestId", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithOneRequest())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment("http://localhost"))), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const response = await agent
      .put(`/api/external-collections/${id}/requests/does-not-exist`)
      .send({ method: "GET", url: "https://example.test", headers: [] });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("request_not_found");
  });
});
