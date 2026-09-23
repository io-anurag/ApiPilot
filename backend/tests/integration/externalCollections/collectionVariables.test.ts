import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function collectionReferencingToken() {
  return {
    info: { name: "c" },
    item: [
      {
        name: "Get widget",
        request: {
          method: "GET",
          url: "{{baseUrl}}/widgets",
          header: [{ key: "Authorization", value: "Bearer {{token}}" }],
        },
      },
    ],
  };
}

function environmentWithBaseUrlOnly() {
  return { name: "env", values: [{ key: "baseUrl", value: "https://api.example.com", enabled: true }] };
}

describe("PUT /api/external-collections/:id/variables (AP-028 US2, quickstart.md Scenario 2)", () => {
  it("updates stored values and the response's collectionView reflects the substitution live", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collectionReferencingToken())), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environmentWithBaseUrlOnly())), "environment.json");
    const id = uploadResponse.body.uploadedCollection.id;

    const before = await agent.get(`/api/external-collections/${id}/collection`);
    expect(before.body.collectionView.items[0].unresolvedVariables).toEqual(["token"]);

    const updated = await agent
      .put(`/api/external-collections/${id}/variables`)
      .send({ variableValues: { baseUrl: "https://api.example.com", token: "abc123" } });
    expect(updated.status).toBe(200);
    expect(updated.body.collectionView.items[0].resolved.headers[0].value).toBe("Bearer abc123");
    expect(updated.body.collectionView.items[0].unresolvedVariables).toEqual([]);
  });

  it("404s uploaded_collection_not_found for an unknown id", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const response = await agent.put("/api/external-collections/does-not-exist/variables").send({ variableValues: {} });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("uploaded_collection_not_found");
  });
});
