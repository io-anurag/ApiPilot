import { describe, expect, it } from "vitest";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import { ensureStableIds } from "../../../src/externalCollections/itemIdentity";

function collectionWith(items: unknown[]): string {
  return JSON.stringify({ info: { name: "c" }, item: items });
}

describe("ensureStableIds", () => {
  it("backfills an id on a request item that has none", () => {
    const raw = collectionWith([{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } }]);
    const persisted = ensureStableIds(parseUploadedCollection(raw));
    const parsedJson = JSON.parse(persisted) as { item: Array<{ id?: string }> };
    expect(parsedJson.item[0].id).toEqual(expect.any(String));
    expect(parsedJson.item[0].id!.length).toBeGreaterThan(0);
  });

  it("backfills an id on a folder that has none, at any nesting depth", () => {
    const raw = collectionWith([
      {
        name: "Outer folder",
        item: [
          {
            name: "Inner folder",
            item: [{ name: "nested", request: { method: "GET", url: "{{baseUrl}}/nested" } }],
          },
        ],
      },
    ]);
    const persisted = ensureStableIds(parseUploadedCollection(raw));
    const parsedJson = JSON.parse(persisted) as {
      item: Array<{ id?: string; item: Array<{ id?: string; item: Array<{ id?: string }> }> }>;
    };
    expect(parsedJson.item[0].id).toEqual(expect.any(String));
    expect(parsedJson.item[0].item[0].id).toEqual(expect.any(String));
    expect(parsedJson.item[0].item[0].item[0].id).toEqual(expect.any(String));
  });

  it("keeps an id that was already present rather than replacing it", () => {
    const raw = collectionWith([
      { id: "existing-id", name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } },
    ]);
    const persisted = ensureStableIds(parseUploadedCollection(raw));
    const parsedJson = JSON.parse(persisted) as { item: Array<{ id?: string }> };
    expect(parsedJson.item[0].id).toBe("existing-id");
  });

  it("is idempotent: parsing the persisted output again yields the same ids", () => {
    const raw = collectionWith([{ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } }]);
    const once = ensureStableIds(parseUploadedCollection(raw));
    const twice = ensureStableIds(parseUploadedCollection(once));
    const idOnce = (JSON.parse(once) as { item: Array<{ id?: string }> }).item[0].id;
    const idTwice = (JSON.parse(twice) as { item: Array<{ id?: string }> }).item[0].id;
    expect(idTwice).toBe(idOnce);
  });
});
