import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

/**
 * A collection whose pre-request script computes a header value the request depends on, and
 * whose test script depends on that header having been set (quickstart.md Scenario 7, FR-008,
 * constitution XVII exception). Proves the pre-request script actually executed with real effect
 * — not merely that the literal request file was sent as authored — which is only possible
 * because `PostmanRawItem`/`PostmanRawEvent` (research.md D6) can represent a `"prerequest"`
 * event at all, unlike `postmanArtifact.ts`'s generator-only `PostmanEvent`.
 */
/**
 * The request defines no `X-Signature` header at all statically — it exists on the wire only
 * because the pre-request script adds it. This is a stronger proof of real script execution than
 * a script merely filling in a `{{templated}}` header value would be, and it also sidesteps FR-004
 * entirely: nothing here is a `{{variableName}}` reference the environment needs to supply, since
 * `pm.variables.get('secret')` is read from the run's live variable state (already seeded from
 * `uploadedCollection.variableValues`), not from static request text FR-004's extraction scans.
 */
function collectionWithPrerequestScript() {
  return {
    info: { name: "c" },
    item: [
      {
        name: "Signed request",
        request: { method: "GET", url: "{{baseUrl}}/signed" },
        event: [
          {
            listen: "prerequest",
            script: {
              type: "text/javascript",
              exec: [
                "pm.request.headers.add({ key: 'X-Signature', value: 'sig-' + pm.variables.get('secret') });",
              ],
            },
          },
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                'pm.test("Signature header was set by the pre-request script", function () {',
                "  pm.expect(pm.request.headers.get('X-Signature')).to.eql('sig-shh');",
                "});",
              ],
            },
          },
        ],
      },
    ],
  };
}

function environment(baseUrl: string) {
  return {
    name: "env",
    values: [
      { key: "baseUrl", value: baseUrl, enabled: true },
      { key: "secret", value: "shh", enabled: true },
    ],
  };
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

describe("external collections: full script fidelity (FR-008, quickstart.md Scenario 7)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("the target server actually receives the pre-request-script-computed header, and the dependent test passes", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/signed", { status: 200, body: {} });

    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "signed-collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionWithPrerequestScript())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");

    const started = await agent
      .post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true });
    expect(started.status).toBe(200);

    const settled = await pollUntilSettled(agent, uploaded.body.uploadedCollection.id, started.body.run.id);
    expect(settled.body.run.status).toBe("completed");
    expect(settled.body.run.results[0]).toMatchObject({
      outcome: "passed",
      testOutcomes: [{ name: "Signature header was set by the pre-request script", outcome: "passed" }],
    });

    expect(targetServer.requests).toHaveLength(1);
    expect(targetServer.requests[0].headers["x-signature"]).toBe("sig-shh");
  }, 60_000);

  it("runs a request with its folder's auth and its collection's and folder's scripts, as Postman does (FR-008)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/signed", { status: 200, body: {} });
    const collection = {
      info: { name: "c" },
      event: [
        {
          listen: "test",
          script: { type: "text/javascript", exec: ['pm.test("collection test", function () { pm.response.to.have.status(200); });'] },
        },
      ],
      item: [
        {
          name: "Signing",
          auth: { type: "bearer", bearer: [{ key: "token", value: "{{secret}}", type: "string" }] },
          event: [
            {
              listen: "prerequest",
              script: {
                type: "text/javascript",
                exec: ["pm.request.headers.add({ key: 'X-Signature', value: 'sig-' + pm.variables.get('secret') });"],
              },
            },
          ],
          item: [
            {
              name: "Signed request",
              request: { method: "GET", url: "{{baseUrl}}/signed" },
              event: [
                {
                  listen: "test",
                  script: { type: "text/javascript", exec: ['pm.test("own test", function () { pm.response.to.have.status(200); });'] },
                },
              ],
            },
          ],
        },
      ],
    };

    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "folder-scripts")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploaded.body.uploadedCollection.id as string;

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    const settled = await pollUntilSettled(agent, id, started.body.run.id);

    expect(settled.body.run.results[0].testOutcomes).toEqual([
      expect.objectContaining({ name: "collection test", outcome: "passed" }),
      expect.objectContaining({ name: "own test", outcome: "passed" }),
    ]);
    expect(targetServer.requests[0].headers.authorization).toBe("Bearer shh");
    expect(targetServer.requests[0].headers["x-signature"]).toBe("sig-shh");
  }, 60_000);

  it("a request moved out of its folder still sends the folder's auth and runs the folder's scripts next to its own (FR-015b)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/signed", { status: 200, body: {} });
    const collection = {
      info: { name: "c" },
      item: [
        {
          name: "Signing",
          auth: { type: "bearer", bearer: [{ key: "token", value: "{{secret}}", type: "string" }] },
          event: [
            {
              listen: "prerequest",
              script: {
                type: "text/javascript",
                exec: ["pm.request.headers.add({ key: 'X-Signature', value: 'sig-' + pm.variables.get('secret') });"],
              },
            },
            {
              listen: "test",
              script: { type: "text/javascript", exec: ['pm.test("folder test", function () { pm.response.to.have.status(200); });'] },
            },
          ],
          item: [
            {
              name: "Signed request",
              request: { method: "GET", url: "{{baseUrl}}/signed" },
              event: [
                {
                  listen: "test",
                  script: { type: "text/javascript", exec: ['pm.test("own test", function () { pm.response.to.have.status(200); });'] },
                },
              ],
            },
          ],
        },
      ],
    };

    const app = createApp();
    const agent = request.agent(app);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "moved-collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment(baseUrl))), "environment.json");
    const id = uploaded.body.uploadedCollection.id as string;
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const moved = await agent
      .post(`/api/external-collections/${id}/items/${view.folders[0].items[0].id}/move`)
      .send({ targetContainerId: "root" });
    expect(moved.status).toBe(200);

    const started = await agent.post(`/api/external-collections/${id}/execution/start`).send({ confirmed: true });
    expect(started.status).toBe(200);
    const settled = await pollUntilSettled(agent, id, started.body.run.id);

    expect(settled.body.run.status).toBe("completed");
    expect(settled.body.run.results[0].testOutcomes).toEqual([
      expect.objectContaining({ name: "folder test", outcome: "passed" }),
      expect.objectContaining({ name: "own test", outcome: "passed" }),
    ]);
    expect(targetServer.requests).toHaveLength(1);
    expect(targetServer.requests[0].headers["x-signature"]).toBe("sig-shh");
    expect(targetServer.requests[0].headers.authorization).toBe("Bearer shh");
  }, 60_000);
});
