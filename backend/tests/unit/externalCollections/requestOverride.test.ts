import { describe, expect, it } from "vitest";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import { applyRequestOverride } from "../../../src/externalCollections/requestOverride";
import { RequestNotFoundError } from "../../../src/externalCollections/errors";

function collectionWithNestedRequest(): string {
  return JSON.stringify({
    info: { name: "c" },
    item: [
      {
        name: "Widgets",
        item: [{ id: "item-1", name: "Get widget", request: { method: "GET", url: "https://example.test/widgets" } }],
      },
    ],
  });
}

describe("applyRequestOverride", () => {
  it("updates method/url/headers/body and marks the item edited", () => {
    const collection = parseUploadedCollection(collectionWithNestedRequest());
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "POST",
      url: "https://example.test/widgets?limit=10",
      headers: [{ key: "Authorization", value: "Bearer abc" }],
      body: '{"name":"widget"}',
    });

    // `.url` in the SDK's own `toJSON()` output is a structured object (`{protocol, host, path,
    // query, variable}`), not a raw string (`Url#getRaw` was discontinued in favor of
    // `Url#toString()`) — re-parse through the SDK, matching how `collectionView.ts` itself reads
    // the URL, rather than assuming a `.raw` string field exists in the plain JSON.
    const reparsed = parseUploadedCollection(updatedJson);
    let found: import("postman-collection").Item | undefined;
    reparsed.forEachItem((candidate) => {
      if (candidate.id === "item-1") found = candidate;
    });
    expect(found?.request.method).toBe("POST");
    expect(found?.request.url.toString()).toBe("https://example.test/widgets?limit=10");
    expect(found?.request.headers.all().map((h) => ({ key: h.key, value: h.value }))).toEqual([
      { key: "Authorization", value: "Bearer abc" },
    ]);
    expect(found?.request.body?.toJSON().raw).toBe('{"name":"widget"}');

    const parsed = JSON.parse(updatedJson) as { item: Array<{ item: Array<{ id: string; _apipilotEdited?: boolean }> }> };
    expect(parsed.item[0].item[0]._apipilotEdited).toBe(true);
  });

  it("leaves an unedited request's own _apipilotEdited marker absent", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        { id: "item-1", name: "Get widget", request: { method: "GET", url: "https://example.test" } },
        { id: "item-2", name: "Other", request: { method: "GET", url: "https://example.test" } },
      ],
    });
    const collection = parseUploadedCollection(raw);
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "GET",
      url: "https://example.test/edited",
      headers: [],
    });
    const parsed = JSON.parse(updatedJson) as { item: Array<{ id: string; _apipilotEdited?: boolean }> };
    expect(parsed.item.find((i) => i.id === "item-2")?._apipilotEdited).toBeUndefined();
  });

  it("sets a request's test script when edit.testScript is provided", () => {
    const collection = parseUploadedCollection(collectionWithNestedRequest());
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "GET",
      url: "https://example.test/widgets",
      headers: [],
      testScript: 'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});',
    });
    const reparsed = parseUploadedCollection(updatedJson);
    let found: import("postman-collection").Item | undefined;
    reparsed.forEachItem((candidate) => {
      if (candidate.id === "item-1") found = candidate;
    });
    const testEvents = found!.events.listeners("test");
    expect(testEvents).toHaveLength(1);
    expect(testEvents[0].script.toSource()).toBe('pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});');
  });

  it("removes every test event when edit.testScript is empty/whitespace-only", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          id: "item-1",
          name: "Get widget",
          request: { method: "GET", url: "https://example.test" },
          event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("x", function () {});'] } }],
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "GET",
      url: "https://example.test",
      headers: [],
      testScript: "   ",
    });
    const reparsed = parseUploadedCollection(updatedJson);
    let found: import("postman-collection").Item | undefined;
    reparsed.forEachItem((candidate) => {
      if (candidate.id === "item-1") found = candidate;
    });
    expect(found!.events.listeners("test")).toHaveLength(0);
  });

  it("leaves an existing test script untouched when edit.testScript is omitted", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          id: "item-1",
          name: "Get widget",
          request: { method: "GET", url: "https://example.test" },
          event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("original", function () {});'] } }],
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "GET",
      url: "https://example.test/v2",
      headers: [],
    });
    const reparsed = parseUploadedCollection(updatedJson);
    let found: import("postman-collection").Item | undefined;
    reparsed.forEachItem((candidate) => {
      if (candidate.id === "item-1") found = candidate;
    });
    expect(found!.events.listeners("test")[0].script.toSource()).toBe('pm.test("original", function () {});');
  });

  it("throws RequestNotFoundError for an unknown request id", () => {
    const collection = parseUploadedCollection(collectionWithNestedRequest());
    expect(() =>
      applyRequestOverride(collection, "does-not-exist", { method: "GET", url: "https://example.test", headers: [] }),
    ).toThrow(RequestNotFoundError);
  });

  it("leaves an existing body untouched when edit.body is omitted", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          id: "item-1",
          name: "Create widget",
          request: { method: "POST", url: "https://example.test", body: { mode: "raw", raw: "original body" } },
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    const updatedJson = applyRequestOverride(collection, "item-1", {
      method: "POST",
      url: "https://example.test/v2",
      headers: [],
    });
    const parsed = JSON.parse(updatedJson) as { item: Array<{ request: { body?: { raw?: string } } }> };
    expect(parsed.item[0].request.body?.raw).toBe("original body");
  });
});
