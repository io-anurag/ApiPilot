import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { TargetServer } from "../../fixtures/execution/targetServer";

describe("external collections: missing variable value refuses the run (US1 Scenario 3, FR-004)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("refuses to start, naming the missing variable, and dispatches no request", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/widgets/1", { status: 200, body: {} });

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

    const started = await agent
      .post(`/api/external-collections/${uploadResponse.body.uploadedCollection.id}/execution/start`)
      .send({ confirmed: true });
    expect(started.status).toBe(400);
    expect(started.body.error).toBe("missing_variable_values");
    expect(started.body.missing).toEqual(["widgetId"]);

    expect(targetServer.requests).toHaveLength(0);
  });
});
