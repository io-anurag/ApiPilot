import { describe, expect, it } from "vitest";
import {
  extractReferencedVariables,
  parseUploadedCollection,
  parseUploadedEnvironment,
} from "../../../src/externalCollections/uploadedCollectionParsing";
import { InvalidCollectionError, InvalidEnvironmentError } from "../../../src/externalCollections/errors";

function collectionJson(item: unknown): string {
  return JSON.stringify({ info: { name: "c" }, item: [item] });
}

describe("parseUploadedCollection", () => {
  it("accepts a valid collection with one request", () => {
    const collection = parseUploadedCollection(
      collectionJson({ name: "Get widget", request: { method: "GET", url: "{{baseUrl}}/widgets" } }),
    );
    let count = 0;
    collection.forEachItem(() => (count += 1));
    expect(count).toBe(1);
  });

  it("discovers a request nested in a folder", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          name: "folder",
          item: [{ name: "nested", request: { method: "GET", url: "{{baseUrl}}/nested" } }],
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    let count = 0;
    collection.forEachItem(() => (count += 1));
    expect(count).toBe(1);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseUploadedCollection("{not json")).toThrow(InvalidCollectionError);
  });

  it("refuses an empty collection (no requests, directly or nested)", () => {
    const raw = JSON.stringify({ info: { name: "c" }, item: [] });
    expect(() => parseUploadedCollection(raw)).toThrow(InvalidCollectionError);
  });
});

describe("parseUploadedEnvironment", () => {
  it("accepts a valid environment", () => {
    const parsed = parseUploadedEnvironment(
      JSON.stringify({ values: [{ key: "baseUrl", value: "https://example.test", enabled: true }] }),
    );
    expect(parsed).toEqual([{ key: "baseUrl", value: "https://example.test", enabled: true }]);
  });

  it("tolerates a disabled entry with no value", () => {
    const parsed = parseUploadedEnvironment(JSON.stringify({ values: [{ key: "unused", enabled: false }] }));
    expect(parsed).toEqual([{ key: "unused", value: "", enabled: false }]);
  });

  it("refuses an enabled entry missing a string value", () => {
    expect(() =>
      parseUploadedEnvironment(JSON.stringify({ values: [{ key: "token", enabled: true }] })),
    ).toThrow(InvalidEnvironmentError);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseUploadedEnvironment("not json")).toThrow(InvalidEnvironmentError);
  });
});

describe("extractReferencedVariables", () => {
  it("extracts variables referenced across URL, header, and body", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          name: "req",
          request: {
            method: "POST",
            url: "{{baseUrl}}/widgets/{{widgetId}}",
            header: [{ key: "Authorization", value: "Bearer {{token}}" }],
            body: { mode: "raw", raw: '{"owner":"{{ownerId}}"}' },
          },
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    const variables = extractReferencedVariables(collection);
    expect(new Set(variables)).toEqual(new Set(["baseUrl", "widgetId", "token", "ownerId"]));
  });

  it("extracts a variable referenced only inside a request's auth block, with no literal header of its own", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          name: "req",
          request: {
            method: "GET",
            url: "https://example.test",
            auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
          },
        },
      ],
    });
    const collection = parseUploadedCollection(raw);
    expect(extractReferencedVariables(collection)).toEqual(["token"]);
  });
});
