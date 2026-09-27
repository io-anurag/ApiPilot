import { describe, expect, it } from "vitest";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import {
  addFolder,
  addRequest,
  copiedScriptSourceFolderId,
  deleteItem,
  moveItem,
  renameItem,
  reorderContainer,
} from "../../../src/externalCollections/collectionStructure";
import { FolderNotFoundError, InvalidMoveError, InvalidOrderError, ItemNotFoundError } from "../../../src/externalCollections/errors";

function collectionWithFolderAndTwoRequests(): string {
  return JSON.stringify({
    info: { name: "c" },
    item: [
      { id: "item-1", name: "First", request: { method: "GET", url: "https://example.test/first" } },
      { id: "item-2", name: "Second", request: { method: "GET", url: "https://example.test/second" } },
      {
        id: "folder-1",
        name: "Widgets",
        item: [{ id: "item-3", name: "Nested", request: { method: "GET", url: "https://example.test/nested" } }],
      },
    ],
  });
}

describe("addRequest", () => {
  it("adds a new request to the collection root", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    const { newItemId } = addRequest(collection, null, {
      name: "New request",
      method: "POST",
      url: "https://example.test/new",
      headers: [{ key: "X-Test", value: "1" }],
    });
    expect(newItemId).toEqual(expect.any(String));
    const json = collection.toJSON() as { item: Array<{ id: string; name: string }> };
    expect(json.item.find((i) => i.id === newItemId)?.name).toBe("New request");
  });

  it("adds a new request to a nested folder", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    const { newItemId } = addRequest(collection, "folder-1", {
      name: "Nested new",
      method: "GET",
      url: "https://example.test/nested-new",
      headers: [],
    });
    const json = collection.toJSON() as { item: Array<{ id: string; item?: Array<{ id: string; name: string }> }> };
    const folder = json.item.find((i) => i.id === "folder-1");
    expect(folder?.item?.find((i) => i.id === newItemId)?.name).toBe("Nested new");
  });

  it("throws FolderNotFoundError for an unknown parentFolderId", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() =>
      addRequest(collection, "does-not-exist", { name: "x", method: "GET", url: "https://example.test", headers: [] }),
    ).toThrow(FolderNotFoundError);
  });
});

describe("addFolder", () => {
  it("adds a new, empty folder to the collection root", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    const { newItemId } = addFolder(collection, null, "New folder");
    const json = collection.toJSON() as { item: Array<{ id: string; name: string; item?: unknown[] }> };
    const added = json.item.find((i) => i.id === newItemId);
    expect(added?.name).toBe("New folder");
    expect(added?.item).toEqual([]);
  });

  it("adds a new folder nested inside an existing folder", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    const { newItemId } = addFolder(collection, "folder-1", "Nested folder");
    const json = collection.toJSON() as { item: Array<{ id: string; item?: Array<{ id: string; name: string }> }> };
    const folder = json.item.find((i) => i.id === "folder-1");
    expect(folder?.item?.find((i) => i.id === newItemId)?.name).toBe("Nested folder");
  });

  it("throws FolderNotFoundError for an unknown parentFolderId", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() => addFolder(collection, "does-not-exist", "x")).toThrow(FolderNotFoundError);
  });
});

describe("deleteItem", () => {
  it("removes a request from the root", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    deleteItem(collection, "item-1");
    const json = collection.toJSON() as { item: Array<{ id: string }> };
    expect(json.item.map((i) => i.id)).not.toContain("item-1");
  });

  it("removes a folder and every request nested within it", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    deleteItem(collection, "folder-1");
    const json = collection.toJSON() as { item: Array<{ id: string }> };
    expect(json.item.map((i) => i.id)).not.toContain("folder-1");
  });

  it("throws ItemNotFoundError for an unknown id", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() => deleteItem(collection, "does-not-exist")).toThrow(ItemNotFoundError);
  });
});

describe("renameItem", () => {
  it("renames an existing request", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    renameItem(collection, "item-1", "Renamed");
    const json = collection.toJSON() as { item: Array<{ id: string; name: string }> };
    expect(json.item.find((i) => i.id === "item-1")?.name).toBe("Renamed");
  });

  it("renames a folder nested at any depth", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    renameItem(collection, "folder-1", "Renamed folder");
    const json = collection.toJSON() as { item: Array<{ id: string; name: string }> };
    expect(json.item.find((i) => i.id === "folder-1")?.name).toBe("Renamed folder");
  });

  it("throws ItemNotFoundError for an unknown id", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() => renameItem(collection, "does-not-exist", "x")).toThrow(ItemNotFoundError);
  });
});

describe("reorderContainer", () => {
  it("reorders the root's direct children to match orderedIds", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    reorderContainer(collection, "root", ["folder-1", "item-2", "item-1"]);
    const json = collection.toJSON() as { item: Array<{ id: string }> };
    expect(json.item.map((i) => i.id)).toEqual(["folder-1", "item-2", "item-1"]);
  });

  it("reorders a nested folder's own children", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          id: "folder-1",
          name: "Widgets",
          item: [
            { id: "item-1", name: "A", request: { method: "GET", url: "https://example.test/a" } },
            { id: "item-2", name: "B", request: { method: "GET", url: "https://example.test/b" } },
          ],
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    reorderContainer(collection, "folder-1", ["item-2", "item-1"]);
    const json = collection.toJSON() as { item: Array<{ id: string; item: Array<{ id: string }> }> };
    expect(json.item[0].item.map((i) => i.id)).toEqual(["item-2", "item-1"]);
  });

  it("throws InvalidOrderError when orderedIds doesn't exactly match the current child id set", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() => reorderContainer(collection, "root", ["item-1", "item-2"])).toThrow(InvalidOrderError);
    expect(() => reorderContainer(collection, "root", ["item-1", "item-2", "folder-1", "unknown-id"])).toThrow(
      InvalidOrderError,
    );
  });

  it("throws ItemNotFoundError for an unknown containerId", () => {
    const collection = parseUploadedCollection(collectionWithFolderAndTwoRequests());
    expect(() => reorderContainer(collection, "does-not-exist", [])).toThrow(ItemNotFoundError);
  });
});

/**
 * Root: "Root" request, "Orders" folder (Bearer {{token}}, pre-request + test scripts) holding
 * "Get order" (inherits, own test), "Own auth" (basic) and subfolder "Archive" > "Archived", and
 * "Payments" folder (test script, no auth) holding "Pay". No collection-level auth.
 */
function collectionWithFolderAuthAndScripts(): string {
  return JSON.stringify({
    info: { name: "c" },
    item: [
      { id: "root-req", name: "Root", request: { method: "GET", url: "https://example.test/root" } },
      {
        id: "orders",
        name: "Orders",
        auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
        event: [
          { listen: "prerequest", script: { type: "text/javascript", exec: ["pm.variables.set('orderDate', 'today');"] } },
          { listen: "test", script: { type: "text/javascript", exec: ["pm.test('orders folder', () => {});"] } },
        ],
        item: [
          {
            id: "order-get",
            name: "Get order",
            request: { method: "GET", url: "https://example.test/orders/1" },
            event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('own', () => {});"] } }],
          },
          {
            id: "order-own-auth",
            name: "Own auth",
            request: {
              method: "GET",
              url: "https://example.test/orders/2",
              auth: { type: "basic", basic: [{ key: "username", value: "{{user}}", type: "string" }] },
            },
          },
          {
            id: "archive",
            name: "Archive",
            item: [{ id: "archived", name: "Archived", request: { method: "GET", url: "https://example.test/archive" } }],
          },
        ],
      },
      {
        id: "payments",
        name: "Payments",
        event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('payments folder', () => {});"] } }],
        item: [{ id: "pay", name: "Pay", request: { method: "POST", url: "https://example.test/pay" } }],
      },
    ],
  });
}

interface RawNode {
  id: string;
  name: string;
  item?: RawNode[];
  auth?: { type: string };
  request?: { auth?: { type: string; bearer?: Array<{ key: string; value: string }> } };
  event?: Array<{ listen: string; script: { exec: string[] } }>;
}

function findNode(nodes: RawNode[], id: string): RawNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.item ? findNode(node.item, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

function rawTree(collection: { toJSON(): unknown }): RawNode[] {
  return (collection.toJSON() as { item: RawNode[] }).item;
}

describe("moveItem (FR-015a, FR-015b)", () => {
  it("moves a request to the root, last among its requests, carrying the folder's auth and scripts ahead of its own", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const carried = moveItem(collection, "order-get", "root");

    const tree = rawTree(collection);
    expect(tree.map((node) => node.id)).toEqual(["root-req", "orders", "payments", "order-get"]);
    expect(findNode(tree, "orders")?.item?.map((node) => node.id)).toEqual(["order-own-auth", "archive"]);

    const moved = findNode(tree, "order-get");
    expect(moved?.request?.auth?.type).toBe("bearer");
    expect(moved?.request?.auth?.bearer).toEqual([expect.objectContaining({ key: "token", value: "{{token}}" })]);
    expect(moved?.event?.map((event) => [event.listen, event.script.exec.at(-1)])).toEqual([
      ["prerequest", "pm.variables.set('orderDate', 'today');"],
      ["test", "pm.test('orders folder', () => {});"],
      ["test", "pm.test('own', () => {});"],
    ]);
    expect(moved?.event?.[0].script.exec[0]).toBe(
      '// Copied by ApiPilot from folder "Orders" (id: orders) when this item was moved.',
    );
    expect(carried).toEqual({
      auth: { type: "bearer", fromFolderName: "Orders" },
      scriptsFromFolders: [{ id: "orders", name: "Orders", events: ["prerequest", "test"] }],
    });
  });

  it("copies nothing when moving into a subfolder, where the same folder's auth and scripts still apply", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const carried = moveItem(collection, "order-get", "archive");

    const tree = rawTree(collection);
    expect(findNode(tree, "archive")?.item?.map((node) => node.id)).toEqual(["archived", "order-get"]);
    const moved = findNode(tree, "order-get");
    expect(moved?.request?.auth).toBeUndefined();
    expect(moved?.event?.map((event) => event.script.exec.at(-1))).toEqual(["pm.test('own', () => {});"]);
    expect(carried).toEqual({ auth: null, scriptsFromFolders: [] });
  });

  it("leaves a request's own auth untouched", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const carried = moveItem(collection, "order-own-auth", "payments");

    expect(findNode(rawTree(collection), "order-own-auth")?.request?.auth?.type).toBe("basic");
    expect(carried.auth).toBeNull();
    expect(carried.scriptsFromFolders.map((folder) => folder.id)).toEqual(["orders"]);
  });

  it("writes an explicit noauth when the request had no auth and the target folder has one", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const carried = moveItem(collection, "pay", "orders");

    expect(findNode(rawTree(collection), "pay")?.request?.auth?.type).toBe("noauth");
    expect(carried.auth).toEqual({ type: "noauth", fromFolderName: null });
    // Entering Orders copies none of its scripts (they run there anyway); leaving Payments copies its test.
    expect(carried.scriptsFromFolders).toEqual([{ id: "payments", name: "Payments", events: ["test"] }]);
  });

  it("does not carry collection-level auth when the target inherits the same collection auth", () => {
    const json = JSON.parse(collectionWithFolderAuthAndScripts()) as Record<string, unknown>;
    json.auth = { type: "bearer", bearer: [{ key: "token", value: "{{collectionToken}}", type: "string" }] };
    const collection = parseUploadedCollection(JSON.stringify(json));
    const carried = moveItem(collection, "root-req", "payments");

    expect(findNode(rawTree(collection), "root-req")?.request?.auth).toBeUndefined();
    expect(carried.auth).toBeNull();
  });

  it("moves a folder, carrying its inherited auth and scripts, and places it after the target's other folders", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const carried = moveItem(collection, "archive", "payments");

    const tree = rawTree(collection);
    expect(findNode(tree, "payments")?.item?.map((node) => node.id)).toEqual(["archive", "pay"]);
    const archive = findNode(tree, "archive");
    expect(archive?.auth?.type).toBe("bearer");
    expect(archive?.item?.map((node) => node.id)).toEqual(["archived"]);
    expect(carried.scriptsFromFolders.map((folder) => folder.id)).toEqual(["orders"]);
  });

  it("refuses a move into the item's current container", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    expect(() => moveItem(collection, "order-get", "orders")).toThrow(InvalidMoveError);
    expect(() => moveItem(collection, "root-req", "root")).toThrow(InvalidMoveError);
  });

  it("refuses moving a folder into itself or one of its own subfolders, leaving the collection unchanged", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    const before = JSON.stringify(collection.toJSON());
    expect(() => moveItem(collection, "orders", "orders")).toThrow(InvalidMoveError);
    expect(() => moveItem(collection, "orders", "archive")).toThrow(InvalidMoveError);
    expect(JSON.stringify(collection.toJSON())).toBe(before);
  });

  it("throws ItemNotFoundError for an unknown item or target", () => {
    const collection = parseUploadedCollection(collectionWithFolderAuthAndScripts());
    expect(() => moveItem(collection, "missing", "root")).toThrow(ItemNotFoundError);
    expect(() => moveItem(collection, "order-get", "missing")).toThrow(ItemNotFoundError);
  });
});

describe("copiedScriptSourceFolderId", () => {
  it("reads the folder id from a copy marker line, and ignores any other script", () => {
    expect(
      copiedScriptSourceFolderId('// Copied by ApiPilot from folder "Orders (v2)" (id: f-1) when this item was moved.\npm.test();'),
    ).toBe("f-1");
    expect(copiedScriptSourceFolderId("pm.test('x', () => {});")).toBeUndefined();
  });
});
