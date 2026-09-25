import { describe, expect, it } from "vitest";
import { parseUploadedCollection } from "../../../src/externalCollections/uploadedCollectionParsing";
import { buildCollectionView } from "../../../src/externalCollections/collectionView";

function nestedCollectionJson(): string {
  return JSON.stringify({
    info: { name: "c" },
    variable: [{ key: "widgetId", value: "default-widget" }],
    item: [
      { name: "Root request", request: { method: "GET", url: "{{baseUrl}}/health" } },
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
          {
            name: "Nested",
            item: [{ name: "Deep request", request: { method: "GET", url: "{{baseUrl}}/deep" } }],
          },
        ],
      },
    ],
  });
}

describe("buildCollectionView", () => {
  it("reproduces the collection's own folder/request order and nesting", () => {
    const view = buildCollectionView("uc-1", parseUploadedCollection(nestedCollectionJson()), nestedCollectionJson(), {});
    expect(view.items.map((i) => i.name)).toEqual(["Root request"]);
    expect(view.folders.map((f) => f.name)).toEqual(["Widgets"]);
    expect(view.folders[0].items.map((i) => i.name)).toEqual(["Get widget"]);
    expect(view.folders[0].folders.map((f) => f.name)).toEqual(["Nested"]);
    expect(view.folders[0].folders[0].items.map((i) => i.name)).toEqual(["Deep request"]);
  });

  it("substitutes a supplied variable value into resolved fields, and marks it unresolved when absent", () => {
    const view = buildCollectionView("uc-1", parseUploadedCollection(nestedCollectionJson()), nestedCollectionJson(), {
      baseUrl: "https://api.example.com",
    });
    const request = view.folders[0].items[0];
    expect(request.raw.url).toBe("{{baseUrl}}/widgets/{{widgetId}}");
    expect(request.resolved.url).toBe("https://api.example.com/widgets/{{widgetId}}");
    expect(request.raw.headers[0].value).toBe("Bearer {{token}}");
    expect(request.resolved.headers[0].value).toBe("Bearer {{token}}");
    expect(request.unresolvedVariables.sort()).toEqual(["token", "widgetId"]);
  });

  it("reports a variableValues-only key with no reference as referenced: false", () => {
    const view = buildCollectionView("uc-1", parseUploadedCollection(nestedCollectionJson()), nestedCollectionJson(), {
      baseUrl: "https://api.example.com",
      unusedKey: "some-value",
    });
    const unused = view.variables.find((v) => v.name === "unusedKey");
    expect(unused).toMatchObject({ source: "environment", resolved: true, referenced: false });
  });

  it("reports a collection-declared-default-only key as source: 'collection-default', resolved: true", () => {
    const view = buildCollectionView("uc-1", parseUploadedCollection(nestedCollectionJson()), nestedCollectionJson(), {});
    const widgetId = view.variables.find((v) => v.name === "widgetId");
    expect(widgetId).toMatchObject({ source: "collection-default", value: "default-widget", resolved: true });
  });

  it("environment always wins over a same-named collection default (research.md D8)", () => {
    const view = buildCollectionView("uc-1", parseUploadedCollection(nestedCollectionJson()), nestedCollectionJson(), {
      widgetId: "overridden-widget",
    });
    const widgetId = view.variables.find((v) => v.name === "widgetId");
    expect(widgetId).toMatchObject({ source: "environment", value: "overridden-widget" });
  });

  it("reads a request's test event script into testScript, and leaves it undefined when absent", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        {
          id: "item-1",
          name: "With tests",
          request: { method: "GET", url: "https://example.test" },
          event: [
            {
              listen: "test",
              script: { type: "text/javascript", exec: ["pm.test(\"Status code is 200\", function () {", "  pm.response.to.have.status(200);", "});"] },
            },
          ],
        },
        { id: "item-2", name: "Without tests", request: { method: "GET", url: "https://example.test" } },
      ],
    });
    const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
    expect(view.items.find((i) => i.name === "With tests")?.testScript).toBe(
      'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});',
    );
    expect(view.items.find((i) => i.name === "Without tests")?.testScript).toBeUndefined();
  });

  it("reads only the request's own test scripts, never its folders' or the collection's", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('collection', () => {});"] } }],
      item: [
        {
          id: "folder-1",
          name: "Orders",
          event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('folder', () => {});"] } }],
          item: [
            {
              id: "item-1",
              name: "Own tests",
              request: { method: "GET", url: "https://example.test" },
              event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('own', () => {});"] } }],
            },
            { id: "item-2", name: "No own tests", request: { method: "GET", url: "https://example.test" } },
          ],
        },
      ],
    });
    const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
    expect(view.folders[0].items[0].testScript).toBe("pm.test('own', () => {});");
    expect(view.folders[0].items[1].testScript).toBeUndefined();
  });

  it("marks a request wasEdited: true only when its id carries the _apipilotEdited marker in the raw stored JSON", () => {
    const raw = JSON.stringify({
      info: { name: "c" },
      item: [
        { id: "item-1", name: "Edited", _apipilotEdited: true, request: { method: "GET", url: "https://example.test" } },
        { id: "item-2", name: "Not edited", request: { method: "GET", url: "https://example.test" } },
      ],
    });
    const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
    expect(view.items.find((i) => i.name === "Edited")?.wasEdited).toBe(true);
    expect(view.items.find((i) => i.name === "Not edited")?.wasEdited).toBe(false);
  });

  describe("impliedAuthHeader (a request's `auth` block, not its literal `header` list)", () => {
    function collectionWithAuth(auth: unknown): string {
      return JSON.stringify({
        info: { name: "c" },
        item: [{ id: "item-1", name: "Request", request: { method: "GET", url: "https://example.test", auth } }],
      });
    }

    it("surfaces a bearer auth as an Authorization header, unresolved in raw and substituted in resolved", () => {
      const raw = collectionWithAuth({ type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, { token: "abc123" });
      const request = view.items[0];
      expect(request.impliedAuthHeader).toEqual({
        key: "Authorization",
        rawValue: "Bearer {{token}}",
        resolvedValue: "Bearer abc123",
      });
      // Never merged into the literal, editable header list.
      expect(request.raw.headers).toEqual([]);
      expect(request.resolved.headers).toEqual([]);
    });

    it("surfaces a header-located apikey auth using its own declared key name", () => {
      const raw = collectionWithAuth({
        type: "apikey",
        apikey: [
          { key: "key", value: "X-API-Key", type: "string" },
          { key: "value", value: "{{apiKeyValue}}", type: "string" },
          { key: "in", value: "header", type: "string" },
        ],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, { apiKeyValue: "secret" });
      expect(view.items[0].impliedAuthHeader).toEqual({
        key: "X-API-Key",
        rawValue: "{{apiKeyValue}}",
        resolvedValue: "secret",
      });
    });

    it("omits a query-located apikey auth — it is already visible in the URL, not a header", () => {
      const raw = collectionWithAuth({
        type: "apikey",
        apikey: [
          { key: "key", value: "apiKey", type: "string" },
          { key: "value", value: "{{apiKeyValue}}", type: "string" },
          { key: "in", value: "query", type: "string" },
        ],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.items[0].impliedAuthHeader).toBeUndefined();
    });

    it("omits an auth type whose header cannot be faithfully computed ahead of time (e.g. basic)", () => {
      const raw = collectionWithAuth({
        type: "basic",
        basic: [
          { key: "username", value: "{{username}}", type: "string" },
          { key: "password", value: "{{password}}", type: "string" },
        ],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.items[0].impliedAuthHeader).toBeUndefined();
    });

    it("omits impliedAuthHeader entirely when the request has no auth", () => {
      const raw = JSON.stringify({
        info: { name: "c" },
        item: [{ id: "item-1", name: "Request", request: { method: "GET", url: "https://example.test" } }],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.items[0].impliedAuthHeader).toBeUndefined();
    });

    it("counts an auth-only variable as unresolved when it has no value", () => {
      const raw = collectionWithAuth({ type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.items[0].unresolvedVariables).toEqual(["token"]);
    });
  });

  describe("effective auth and used variables (FR-002a, FR-002b)", () => {
    function folderAuthCollection(collectionAuth?: unknown): string {
      return JSON.stringify({
        info: { name: "c" },
        ...(collectionAuth ? { auth: collectionAuth } : {}),
        item: [
          { id: "root-req", name: "Root", request: { method: "GET", url: "{{baseUrl}}/root" } },
          {
            id: "orders",
            name: "Orders",
            auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
            event: [{ listen: "test", script: { type: "text/javascript", exec: ["pm.test('folder', () => {});"] } }],
            item: [
              {
                id: "order-get",
                name: "Get order",
                request: { method: "GET", url: "{{baseUrl}}/orders", header: [{ key: "X-Trace", value: "{{traceId}}" }] },
              },
              {
                id: "own-basic",
                name: "Own basic",
                request: {
                  method: "GET",
                  url: "https://example.test",
                  auth: {
                    type: "basic",
                    basic: [
                      { key: "username", value: "{{user}}", type: "string" },
                      { key: "password", value: "hunter2", type: "string" },
                    ],
                  },
                },
              },
            ],
          },
        ],
      });
    }

    it("reports inherited folder auth with its source and {{variable}} fields intact", () => {
      const raw = folderAuthCollection();
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.folders[0].items[0].auth).toEqual({
        type: "bearer",
        source: { kind: "folder", folderId: "orders", folderName: "Orders" },
        fields: expect.arrayContaining([{ key: "token", value: "{{token}}", hiddenLiteral: false }]),
      });
    });

    it("reports a request's own auth, and never sends a secret field's literal value", () => {
      const raw = folderAuthCollection();
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      const auth = view.folders[0].items[1].auth;
      expect(auth?.source).toEqual({ kind: "request" });
      expect(auth?.fields).toEqual(
        expect.arrayContaining([
          { key: "username", value: "{{user}}", hiddenLiteral: false },
          { key: "password", value: "", hiddenLiteral: true },
        ]),
      );
      expect(JSON.stringify(view)).not.toContain("hunter2");
    });

    it("reports collection-level auth, and no auth at all when none applies", () => {
      const withCollectionAuth = folderAuthCollection({
        type: "apikey",
        apikey: [
          { key: "key", value: "X-Api-Key", type: "string" },
          { key: "value", value: "literal-key-123", type: "string" },
        ],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(withCollectionAuth), withCollectionAuth, {});
      expect(view.items[0].auth?.source).toEqual({ kind: "collection" });
      expect(view.items[0].auth?.fields).toEqual(
        expect.arrayContaining([{ key: "value", value: "", hiddenLiteral: true }]),
      );

      const withoutAuth = folderAuthCollection();
      const plain = buildCollectionView("uc-1", parseUploadedCollection(withoutAuth), withoutAuth, {});
      expect(plain.items[0].auth).toBeUndefined();
    });

    it("lists every variable a request uses, where, and whether it is set and by which source", () => {
      const raw = folderAuthCollection();
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, { baseUrl: "https://api.test" });
      expect(view.folders[0].items[0].variableReferences).toEqual([
        { name: "baseUrl", usedIn: ["url"], resolved: true, source: "environment" },
        { name: "traceId", usedIn: ["headers"], resolved: false },
        { name: "token", usedIn: ["auth"], resolved: false },
      ]);
    });

    it("reports a folder's own script kinds, and folders whose scripts an item carries a copy of", () => {
      const raw = JSON.stringify({
        info: { name: "c" },
        item: [
          {
            id: "moved",
            name: "Moved",
            request: { method: "GET", url: "https://example.test" },
            event: [
              {
                listen: "test",
                script: {
                  type: "text/javascript",
                  exec: ['// Copied by ApiPilot from folder "Orders" (id: orders) when this item was moved.', "pm.test();"],
                },
              },
            ],
          },
          { id: "orders", name: "Orders", event: [{ listen: "prerequest", script: { exec: ["pm.variables.set('a', 1);"] } }], item: [] },
        ],
      });
      const view = buildCollectionView("uc-1", parseUploadedCollection(raw), raw, {});
      expect(view.items[0].copiedScriptFolderIds).toEqual(["orders"]);
      expect(view.folders[0].scriptEvents).toEqual(["prerequest"]);
      expect(view.folders[0].copiedScriptFolderIds).toEqual([]);
    });
  });
});
