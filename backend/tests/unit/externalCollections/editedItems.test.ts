import { describe, expect, it } from "vitest";
import { findEditedItemIds, markItemEdited } from "../../../src/externalCollections/editedItems";

describe("markItemEdited / findEditedItemIds", () => {
  it("marks a root-level item and findEditedItemIds reports it", () => {
    const tree = { info: { name: "c" }, item: [{ id: "item-1", name: "Get widget" }] };
    markItemEdited(tree, "item-1");
    const ids = findEditedItemIds(JSON.stringify(tree));
    expect(ids.has("item-1")).toBe(true);
  });

  it("marks an item nested inside a folder at any depth", () => {
    const tree = {
      info: { name: "c" },
      item: [{ id: "folder-1", name: "Widgets", item: [{ id: "item-1", name: "Get widget" }] }],
    };
    markItemEdited(tree, "item-1");
    const ids = findEditedItemIds(JSON.stringify(tree));
    expect(ids.has("item-1")).toBe(true);
    expect(ids.has("folder-1")).toBe(false);
  });

  it("does not mark any item when the id does not match", () => {
    const tree = { info: { name: "c" }, item: [{ id: "item-1", name: "Get widget" }] };
    markItemEdited(tree, "unknown-id");
    const ids = findEditedItemIds(JSON.stringify(tree));
    expect(ids.size).toBe(0);
  });

  it("findEditedItemIds returns an empty set for malformed JSON rather than throwing", () => {
    expect(findEditedItemIds("{not json")).toEqual(new Set());
  });
});
