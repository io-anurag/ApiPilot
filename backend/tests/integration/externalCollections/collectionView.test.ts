import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function nestedCollection() {
  return {
    info: { name: "c" },
    item: [
      {
        name: "Widgets",
        item: [
          {
            name: "Get widget",
            request: {
              method: "GET",
              url: "{{baseUrl}}/widgets/{{widgetId}}",
              header: [{ key: "Authorization", value: "Bearer {{token}}" }],
            },
          },
        ],
      },
    ],
  };
}

function environmentWithBaseUrl() {
  return {
    name: "env",
    values: [{ key: "baseUrl", value: "https://api.example.com", enabled: true }],
  };
}

describe("GET /api/external-collections/:id/collection (AP-028 US1, quickstart.md Scenario 1)", () => {
  it("exposes script-created variable names in the editor catalog before a run", async () => {
    const agent = request.agent(createApp());
    const collection = {
      info: { name: "Script-created variables" },
      item: [
        {
          name: "Create customer",
          request: { method: "POST", url: "https://example.test/customers" },
          event: [
            {
              listen: "test",
              script: {
                exec: [
                  'pm.environment.set("customer_id", pm.response.json().id);',
                  'pm.environment.set("token", pm.response.json().token);',
                ],
              },
            },
          ],
        },
      ],
    };
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "Script-created variables")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify({ name: "env", values: [] })), "environment.json");
    expect(uploaded.status).toBe(201);
    const response = await agent.get(
      `/api/external-collections/${uploaded.body.uploadedCollection.id}/collection`,
    );
    expect(response.status).toBe(200);
    expect(response.body.collectionView.variables).toEqual([
      {
        name: "customer_id",
        source: "collection-default",
        resolved: false,
        referenced: false,
      },
      { name: "token", source: "collection-default", resolved: false, referenced: false },
    ]);
  });

  it("returns a tree matching the source collection's order/nesting, with placeholders intact and unresolved variables reported", async () => {
    const app = createApp();
    const agent = request.agent(app);

    const uploadResponse = await agent
      .post("/api/external-collections")
      .field("name", "My collection")
      .field("tier", "local")
      .attach(
        "collection",
        Buffer.from(JSON.stringify(nestedCollection())),
        "collection.json",
      )
      .attach(
        "environment",
        Buffer.from(JSON.stringify(environmentWithBaseUrl())),
        "environment.json",
      );
    expect(uploadResponse.status).toBe(201);
    const id = uploadResponse.body.uploadedCollection.id;

    const response = await agent.get(`/api/external-collections/${id}/collection`);
    expect(response.status).toBe(200);

    const { collectionView } = response.body;
    expect(collectionView.folders).toHaveLength(1);
    expect(collectionView.folders[0].name).toBe("Widgets");
    const [item] = collectionView.folders[0].items;
    expect(item.raw.url).toBe("{{baseUrl}}/widgets/{{widgetId}}");
    expect(item.resolved.url).toBe("https://api.example.com/widgets/{{widgetId}}");
    expect(item.unresolvedVariables.sort()).toEqual(["token", "widgetId"]);
    expect(item.id).toEqual(expect.any(String));
    expect(item.wasEdited).toBe(false);
  });

  it("404s uploaded_collection_not_found for an unknown id", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const response = await agent.get(
      "/api/external-collections/does-not-exist/collection",
    );
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("uploaded_collection_not_found");
  });
});
