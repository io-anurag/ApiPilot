import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function validCollection() {
  return { info: { name: "c" }, item: [{ name: "req", request: { method: "GET", url: "{{baseUrl}}" } }] };
}

function validEnvironment() {
  return { name: "env", values: [{ key: "baseUrl", value: "http://localhost", enabled: true }] };
}

function attachValidFiles(req: request.Test) {
  return req
    .attach("collection", Buffer.from(JSON.stringify(validCollection())), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(validEnvironment())), "environment.json");
}

describe("external collections: list, remove, duplicate name, oversized file (US1, FR-016/FR-017/FR-012)", () => {
  it("lists an uploaded collection without variableValues/raw body, refuses a duplicate name, and removes it", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const uploadResponse = await attachValidFiles(
      agent.post("/api/external-collections").field("name", "My collection").field("tier", "local"),
    );
    expect(uploadResponse.status).toBe(201);
    const id = uploadResponse.body.uploadedCollection.id;

    const list = await agent.get("/api/external-collections");
    expect(list.status).toBe(200);
    expect(list.body.uploadedCollections).toEqual([
      expect.objectContaining({ id, name: "My collection", tier: "local" }),
    ]);
    expect(list.body.uploadedCollections[0].variableValues).toBeUndefined();
    expect(list.body.uploadedCollections[0].collection).toBeUndefined();

    const duplicate = await attachValidFiles(
      agent.post("/api/external-collections").field("name", "My collection").field("tier", "local"),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("duplicate_name");

    const removed = await agent.delete(`/api/external-collections/${id}`);
    expect(removed.status).toBe(204);

    const listAfterRemoval = await agent.get("/api/external-collections");
    expect(listAfterRemoval.body.uploadedCollections).toEqual([]);

    const removeAgain = await agent.delete(`/api/external-collections/${id}`);
    expect(removeAgain.status).toBe(404);
    expect(removeAgain.body.error).toBe("uploaded_collection_not_found");
  });

  it("refuses a collection file exceeding the upload size limit with 413 file_too_large", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);

    const response = await agent
      .post("/api/external-collections")
      .field("name", "Too big")
      .field("tier", "local")
      .attach("collection", oversized, "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(validEnvironment())), "environment.json");
    expect(response.status).toBe(413);
    expect(response.body.error).toBe("file_too_large");
  });
});
