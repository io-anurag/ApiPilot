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
});
