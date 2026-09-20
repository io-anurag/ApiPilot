import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

const POLL_TIMEOUT_MS = 30_000;

function validCollection() {
  return {
    info: { name: "My collection", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [
      {
        name: "Get widget",
        request: { method: "GET", url: "{{baseUrl}}/widgets/1" },
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                'pm.test("Status code is 200", function () {',
                "  pm.response.to.have.status(200);",
                "});",
              ],
            },
          },
        ],
      },
    ],
  };
}

function validEnvironment(baseUrl: string) {
  return {
    name: "My environment",
    values: [{ key: "baseUrl", value: baseUrl, enabled: true }],
  };
}

/** Mirrors `executionRuns.test.ts`'s own poll helper (same rationale: never silently return "in-progress"). */
async function pollUntilSettled(
  agent: ReturnType<typeof request.agent>,
  uploadedCollectionId: string,
  runId: string,
  timeoutMs = POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await agent.get(`/api/external-collections/${uploadedCollectionId}/execution/runs/${runId}`);
    if (response.body.run.status !== "in-progress") {
      return response;
    }
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} was still "in-progress" after ${timeoutMs}ms; it never settled.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("external collections: upload, confirm, and run (US1, US2)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("uploads, confirms, runs, and reports a per-request pass/fail result (quickstart.md Scenario 1)", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: { id: 1 } });

    const app = createApp();
    const agent = request.agent(app);

    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(validCollection())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(validEnvironment(baseUrl))), "environment.json");
    expect(uploadResponse.status).toBe(201);
    const uploadedCollectionId = uploadResponse.body.uploadedCollection.id;
    expect(uploadResponse.body.uploadedCollection.variableValues).toBeUndefined();

    const unconfirmed = await agent
      .post(`/api/external-collections/${uploadedCollectionId}/execution/start`)
      .send({ confirmed: false });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toBe("unverified_content_confirmation_required");

    const started = await agent
      .post(`/api/external-collections/${uploadedCollectionId}/execution/start`)
      .send({ confirmed: true });
    expect(started.status).toBe(200);
    expect(started.body.run.status).toBe("in-progress");
    expect(started.body.run.source).toBe("uploaded");
    expect(started.body.run.results).toEqual([]);

    const finalResponse = await pollUntilSettled(agent, uploadedCollectionId, started.body.run.id);
    const run = finalResponse.body.run;
    expect(run.status).toBe("completed");
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({
      requestName: "Get widget",
      requestMethod: "GET",
      outcome: "passed",
      responseStatusCode: 200,
      testOutcomes: [{ name: "Status code is 200", outcome: "passed" }],
    });
  }, 60_000);
});
