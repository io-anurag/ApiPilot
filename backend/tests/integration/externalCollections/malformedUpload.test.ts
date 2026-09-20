import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function validCollection() {
  return { info: { name: "c" }, item: [{ name: "req", request: { method: "GET", url: "{{baseUrl}}" } }] };
}

function validEnvironment() {
  return { name: "env", values: [{ key: "baseUrl", value: "http://localhost", enabled: true }] };
}

describe("external collections: malformed upload refused, not repaired (US1 Scenario 4, FR-002/FR-003)", () => {
  it("refuses a collection file that is not valid JSON, and does not list it afterward", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const response = await agent
      .post("/api/external-collections")
      .field("name", "Bad collection")
      .field("tier", "local")
      .attach("collection", Buffer.from("{not json"), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(validEnvironment())), "environment.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_collection");

    const list = await agent.get("/api/external-collections");
    expect(list.body.uploadedCollections).toEqual([]);
  });

  it("refuses a malformed environment file", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const response = await agent
      .post("/api/external-collections")
      .field("name", "Bad environment")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(validCollection())), "collection.json")
      .attach("environment", Buffer.from("not json"), "environment.json");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_environment");
  });
});
