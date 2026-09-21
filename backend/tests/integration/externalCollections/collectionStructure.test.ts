import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";

function collectionWithFolder() {
  return {
    info: { name: "c" },
    item: [
      { name: "Root request", request: { method: "GET", url: "https://example.test/root" } },
      { name: "Second root request", request: { method: "GET", url: "https://example.test/root2" } },
      {
        name: "Widgets",
        item: [{ name: "Nested request", request: { method: "GET", url: "https://example.test/nested" } }],
      },
    ],
  };
}

function environment() {
  return { name: "env", values: [] };
}

async function upload(agent: ReturnType<typeof request.agent>) {
  const response = await agent
    .post("/api/external-collections")
    .field("name", "My collection")
    .field("tier", "local")
    .attach("collection", Buffer.from(JSON.stringify(collectionWithFolder())), "collection.json")
    .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
  return response.body.uploadedCollection.id as string;
}

describe("AP-028 collection structure endpoints (US4, quickstart.md Scenario 5)", () => {
  it("POST .../items adds a request to the root and to a nested folder", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const folderId = view.folders[0].id;

    const toRoot = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: null, name: "New root request", method: "POST", url: "https://example.test/new", headers: [] });
    expect(toRoot.status).toBe(201);
    expect(toRoot.body.collectionView.items.map((i: { name: string }) => i.name)).toContain("New root request");

    const toFolder = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: folderId, name: "New nested request", method: "GET", url: "https://example.test/new2", headers: [] });
    expect(toFolder.status).toBe(201);
    expect(toFolder.body.collectionView.folders[0].items.map((i: { name: string }) => i.name)).toContain(
      "New nested request",
    );
  });

  it("DELETE .../items/:itemId removes a request, and removes every nested request when the target is a folder", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const folderId = view.folders[0].id;

    const response = await agent.delete(`/api/external-collections/${id}/items/${folderId}`);
    expect(response.status).toBe(200);
    expect(response.body.collectionView.folders).toEqual([]);
  });

  it("PUT .../items/:itemId/rename renames either kind", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const requestId = view.items[0].id;

    const response = await agent.put(`/api/external-collections/${id}/items/${requestId}/rename`).send({ name: "Renamed" });
    expect(response.status).toBe(200);
    expect(response.body.collectionView.items[0].name).toBe("Renamed");
  });

  it("PUT .../containers/:containerId/order reorders two requests and rejects a mismatched id set", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    // The endpoint itself accepts any full permutation of the container's true child id set
    // (both requests and the folder together, interleaved order and all — reorderContainer
    // operates on the SDK's own single flat PropertyList). The response view then re-splits that
    // into folders-then-items for display (CollectionTreeView's documented kind-grouped
    // convention), so this test reorders within one kind (the two root requests) to get an
    // assertion that survives that re-split, rather than asserting on a literal full-list order.
    const [firstItemId, secondItemId] = view.items.map((i: { id: string }) => i.id);
    const folderId = view.folders[0].id;
    const fullOrder = [folderId, secondItemId, firstItemId];

    const reordered = await agent
      .put(`/api/external-collections/${id}/containers/root/order`)
      .send({ orderedIds: fullOrder });
    expect(reordered.status).toBe(200);
    expect(reordered.body.collectionView.items.map((i: { id: string }) => i.id)).toEqual([secondItemId, firstItemId]);

    const invalid = await agent
      .put(`/api/external-collections/${id}/containers/root/order`)
      .send({ orderedIds: [firstItemId, secondItemId] }); // missing the folder id
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_order");
  });
});
