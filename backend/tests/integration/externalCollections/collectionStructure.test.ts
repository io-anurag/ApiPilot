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

  it("POST .../items with kind: 'folder' adds an empty folder to the root and to a nested folder", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const folderId = view.folders[0].id;

    const toRoot = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: null, name: "New folder", kind: "folder" });
    expect(toRoot.status).toBe(201);
    expect(toRoot.body.collectionView.folders.map((f: { name: string }) => f.name)).toContain("New folder");

    const toFolder = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: folderId, name: "Nested folder", kind: "folder" });
    expect(toFolder.status).toBe(201);
    const updatedRootFolder = toFolder.body.collectionView.folders.find((f: { id: string }) => f.id === folderId);
    expect(updatedRootFolder.folders.map((f: { name: string }) => f.name)).toContain("Nested folder");
  });

  it("POST .../items with kind: 'folder' requires only a name, not method/url", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const id = await upload(agent);

    const missingName = await agent.post(`/api/external-collections/${id}/items`).send({ parentFolderId: null, kind: "folder" });
    expect(missingName.status).toBe(400);

    const noMethodOrUrl = await agent
      .post(`/api/external-collections/${id}/items`)
      .send({ parentFolderId: null, name: "Fine without method/url", kind: "folder" });
    expect(noMethodOrUrl.status).toBe(201);
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

  it("POST .../items/:itemId/move carries folder auth and scripts, marks the item edited, and persists the move (FR-015a, FR-015b)", async () => {
    const app = createApp();
    const agent = request.agent(app);
    const collection = {
      info: { name: "c" },
      item: [
        { name: "Root request", request: { method: "GET", url: "https://example.test/root" } },
        {
          name: "Orders",
          auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
          event: [{ listen: "prerequest", script: { type: "text/javascript", exec: ["pm.variables.set('d', 1);"] } }],
          item: [{ name: "Get order", request: { method: "GET", url: "https://example.test/orders/1" } }],
        },
      ],
    };
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "Move collection")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify(collection)), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify(environment())), "environment.json");
    const id = uploaded.body.uploadedCollection.id as string;
    const view = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    const ordersId = view.folders[0].id as string;
    const requestId = view.folders[0].items[0].id as string;

    const moved = await agent.post(`/api/external-collections/${id}/items/${requestId}/move`).send({ targetContainerId: "root" });
    expect(moved.status).toBe(200);
    expect(moved.body.carried).toEqual({
      auth: { type: "bearer", fromFolderName: "Orders" },
      scriptsFromFolders: [{ id: ordersId, name: "Orders", events: ["prerequest"] }],
    });
    const movedRequest = moved.body.collectionView.items.find((item: { id: string }) => item.id === requestId);
    expect(movedRequest).toMatchObject({
      wasEdited: true,
      auth: { type: "bearer", source: { kind: "request" } },
      copiedScriptFolderIds: [ordersId],
    });
    expect(moved.body.collectionView.folders[0].items).toEqual([]);

    const reread = (await agent.get(`/api/external-collections/${id}/collection`)).body.collectionView;
    expect(reread.items.map((item: { id: string }) => item.id)).toEqual([view.items[0].id, requestId]);

    const sameContainer = await agent.post(`/api/external-collections/${id}/items/${requestId}/move`).send({ targetContainerId: "root" });
    expect(sameContainer.status).toBe(400);
    expect(sameContainer.body.error).toBe("invalid_move");

    const missingTarget = await agent.post(`/api/external-collections/${id}/items/${requestId}/move`).send({});
    expect(missingTarget.status).toBe(400);
    expect(missingTarget.body.error).toBe("invalid_request");

    const unknownTarget = await agent
      .post(`/api/external-collections/${id}/items/${requestId}/move`)
      .send({ targetContainerId: "no-such-folder" });
    expect(unknownTarget.status).toBe(404);
    expect(unknownTarget.body.error).toBe("item_not_found");
  });
});
