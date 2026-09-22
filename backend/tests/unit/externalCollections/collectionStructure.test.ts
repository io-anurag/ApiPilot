import { describe, expect, it } from "vitest";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import { addFolder, addRequest, deleteItem, renameItem, reorderContainer } from "../../../src/externalCollections/collectionStructure";
import { FolderNotFoundError, InvalidOrderError, ItemNotFoundError } from "../../../src/externalCollections/errors";

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
