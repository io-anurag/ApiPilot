import { describe, expect, it } from "vitest";
import { Collection, type Item } from "postman-collection";
import { applyRequestAuthEdit, parseRequestAuthEdit } from "../../../src/externalCollections/requestAuthEdit";
import { InvalidAuthEditError } from "../../../src/externalCollections/errors";

function itemWithAuth(auth?: unknown): Item {
  const collection = new Collection({
    info: { name: "c" },
    item: [{ name: "Folder", auth: { type: "bearer", bearer: [{ key: "token", value: "{{folderToken}}", type: "string" }] }, item: [
      { id: "item-1", name: "Request", request: { method: "GET", url: "https://example.test", ...(auth ? { auth } : {}) } },
    ] }],
  });
  let found: Item | undefined;
  collection.forEachItem((item: Item) => {
    found = item;
  });
  return found!;
}

function storedAuth(item: Item) {
  return (item.toJSON() as { request: { auth?: unknown } }).request.auth;
}

describe("parseRequestAuthEdit (specs/028 FR-002c)", () => {
  it("returns undefined when auth is omitted, leaving the request's auth untouched", () => {
    expect(parseRequestAuthEdit(undefined)).toBeUndefined();
  });

  it("accepts each editable type", () => {
    expect(parseRequestAuthEdit({ type: "inherit" })).toEqual({ type: "inherit" });
    expect(parseRequestAuthEdit({ type: "noauth" })).toEqual({ type: "noauth" });
    expect(parseRequestAuthEdit({ type: "bearer", token: { kind: "keep" } })).toEqual({ type: "bearer", token: { kind: "keep" } });
    expect(
      parseRequestAuthEdit({ type: "apikey", key: "X-API-Key", value: { kind: "set", value: "{{k}}" }, in: "query" }),
    ).toEqual({ type: "apikey", key: "X-API-Key", value: { kind: "set", value: "{{k}}" }, in: "query" });
  });

  it("refuses an unsupported type, a malformed secret field, or a bad API key location", () => {
    expect(() => parseRequestAuthEdit({ type: "oauth2" })).toThrow(InvalidAuthEditError);
    expect(() => parseRequestAuthEdit({ type: "bearer", token: "plain" })).toThrow(InvalidAuthEditError);
    expect(() => parseRequestAuthEdit({ type: "basic", username: 1, password: { kind: "keep" } })).toThrow(InvalidAuthEditError);
    expect(() => parseRequestAuthEdit({ type: "apikey", key: "k", value: { kind: "keep" }, in: "cookie" })).toThrow(InvalidAuthEditError);
  });
});

describe("applyRequestAuthEdit (specs/028 FR-002c)", () => {
  it("sets a bearer token of its own on a request that inherited its auth", () => {
    const item = itemWithAuth();
    applyRequestAuthEdit(item, { type: "bearer", token: { kind: "set", value: "{{adminToken}}" } });
    expect(storedAuth(item)).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{adminToken}}", type: "string" }] });
  });

  it("keeps a stored secret literal of the same type unless a new one is typed", () => {
    const item = itemWithAuth({
      type: "basic",
      basic: [
        { key: "username", value: "old", type: "string" },
        { key: "password", value: "s3cret", type: "string" },
      ],
    });
    applyRequestAuthEdit(item, { type: "basic", username: "{{user}}", password: { kind: "keep" } });
    expect(storedAuth(item)).toEqual({
      type: "basic",
      basic: [
        { key: "username", value: "{{user}}", type: "string" },
        { key: "password", value: "s3cret", type: "string" },
      ],
    });
  });

  it("refuses to keep a secret the request's own auth of that type does not have", () => {
    expect(() => applyRequestAuthEdit(itemWithAuth(), { type: "bearer", token: { kind: "keep" } })).toThrow(InvalidAuthEditError);
    const basic = itemWithAuth({ type: "basic", basic: [{ key: "password", value: "p", type: "string" }] });
    expect(() => applyRequestAuthEdit(basic, { type: "bearer", token: { kind: "keep" } })).toThrow(InvalidAuthEditError);
  });

  it("removes the request's own auth for inherit, so the folder's applies again", () => {
    const item = itemWithAuth({ type: "noauth" });
    applyRequestAuthEdit(item, { type: "inherit" });
    expect(storedAuth(item)).toBeUndefined();
    expect(item.getAuth()?.type).toBe("bearer");
  });

  it("writes an explicit No Auth and an API key with its location", () => {
    const item = itemWithAuth();
    applyRequestAuthEdit(item, { type: "noauth" });
    expect(storedAuth(item)).toMatchObject({ type: "noauth" });

    applyRequestAuthEdit(item, { type: "apikey", key: "X-API-Key", value: { kind: "set", value: "{{key}}" }, in: "header" });
    expect(storedAuth(item)).toEqual({
      type: "apikey",
      apikey: [
        { key: "key", value: "X-API-Key", type: "string" },
        { key: "value", value: "{{key}}", type: "string" },
        { key: "in", value: "header", type: "string" },
      ],
    });
  });
});
