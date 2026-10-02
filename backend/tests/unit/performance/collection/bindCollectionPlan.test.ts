import type { Capture } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { ensureStableIds } from "../../../../src/externalCollections/itemIdentity";
import { parseUploadedCollection } from "../../../../src/externalCollections/uploadedCollectionParsing";
import { assembleCollectionPlan, defaultCollectionChoices, type CollectionPlanChoices } from "../../../../src/performance/collection/assembleCollectionPlan";
import { bindReferences, convertedCaptures, type DraftStep } from "../../../../src/performance/collection/bindCollectionPlan";
import type { CollectionScript } from "../../../../src/performance/collection/readCollectionRequests";
import { recognizeScript } from "../../../../src/performance/collection/recognizeScript";
import { captureKeyOf } from "../../../../src/performance/plan/stepRequest";
import { collectionOf, folderItem, requestItem, testScript } from "../../../fixtures/collections/collectionBuilders";

/** AP-036 research R6, FR-006, FR-008 (tasks T024). */

function script(owner: CollectionScript["owner"], ...lines: string[]): CollectionScript {
  const ownerKey = owner.kind === "collection" ? "collection" : owner.kind === "folder" ? `folder:${owner.folderId}` : `request:${owner.itemId}`;
  return { event: "test", owner, ownerKey, text: lines.join("\n") };
}

function capture(name: string): Capture {
  return { name, source: { kind: "body", path: name, segments: [{ field: name }] }, documented: null };
}

function draft(id: string, captures: string[], references: string[]): DraftStep {
  return { id, itemId: id, captures: captures.map(capture), references: new Map(references.map((name) => [name, { name, locations: new Set(["url" as const]), authOnly: false }])) };
}

function assemble(collection: Record<string, unknown>, ids: string[], choices: Partial<CollectionPlanChoices> = {}) {
  const json = ensureStableIds(parseUploadedCollection(JSON.stringify(collection)));
  return assembleCollectionPlan({ id: "c", name: "C", tier: "local", json }, { ...defaultCollectionChoices(ids), ...choices }, { supportedDynamicVariables: new Set() });
}

describe("convertedCaptures", () => {
  it("makes each setter a capture with its scope, owner and line, the later setter of one name winning in Postman's order", () => {
    const scripts = [
      script({ kind: "collection" }, 'pm.collectionVariables.set("id", pm.response.json().first);'),
      script({ kind: "folder", folderId: "f", folderName: "F" }, 'pm.globals.set("other", pm.response.json().other);'),
      script({ kind: "request", itemId: "r" }, "", 'pm.environment.set("id", pm.response.json().second);'),
    ];
    const { captures, superseded } = convertedCaptures(scripts, (entry) => recognizeScript(entry.text));
    expect(captures.map((entry) => [entry.name, entry.source, entry.origin])).toEqual([
      ["other", { kind: "body", path: "other", segments: [{ field: "other" }] }, { kind: "collection-script", scope: "globals", owner: { kind: "folder", folderId: "f", folderName: "F" }, line: 1 }],
      ["id", { kind: "body", path: "second", segments: [{ field: "second" }] }, { kind: "collection-script", scope: "environment", owner: { kind: "request", itemId: "r" }, line: 2 }],
    ]);
    expect(superseded).toEqual([
      { kind: "superseded-setter", owner: { kind: "collection" }, event: "test", line: 1, column: null, excerpt: 'pm.collectionVariables.set("id", pm.response.json().first);', detail: "id" },
    ]);
  });
});

describe("bindReferences", () => {
  it("binds each reference to the latest earlier capture of its name, and leaves earlier or unknown names to the environment", () => {
    const steps = [draft("a", [], ["id"]), draft("b", ["id"], []), draft("c", ["id"], ["id"]), draft("d", [], ["id", "other"])];
    const bindings = bindReferences(steps, new Map());
    expect(bindings.get("a")).toEqual([]);
    expect(bindings.get("c")).toEqual([{ name: "id", captureStepId: "b", captureName: "id", addedByUser: false }]);
    expect(bindings.get("d")).toEqual([{ name: "id", captureStepId: "c", captureName: "id", addedByUser: false }]);
  });

  it("uses an engineer's binding while its capture is on an earlier step (FR-019)", () => {
    const steps = [draft("a", ["etag"], []), draft("b", ["etag"], []), draft("c", [], ["version"])];
    expect(bindReferences(steps, new Map([["c", [{ name: "version", captureStepId: "a", captureName: "etag" }]]])).get("c")).toEqual([
      { name: "version", captureStepId: "a", captureName: "etag", addedByUser: true },
    ]);
    const later = [draft("c", [], ["version"]), draft("a", ["etag"], [])];
    expect(bindReferences(later, new Map([["c", [{ name: "version", captureStepId: "a", captureName: "etag" }]]])).get("c")).toEqual([]);
  });
});

describe("binding in an assembled plan", () => {
  const collection = collectionOf([
    requestItem("create", "Create", { method: "POST", event: [testScript('pm.collectionVariables.set("id", pm.response.json().id);')] }),
    requestItem("read", "Read", { url: "{{baseUrl}}/items/{{id}}" }),
    requestItem("again", "Again", { method: "POST", event: [testScript('pm.environment.set("id", pm.response.json().id);')] }),
    requestItem("delete", "Delete", { method: "DELETE", url: "{{baseUrl}}/items/{{id}}" }),
  ]);
  const ids = ["create", "read", "again", "delete"];

  it("rewrites bound references to capture keys, and notes each collection-variable or global capture's scope", () => {
    const { plan, requests } = assemble(collection, ids);
    const [create, read, again, remove] = plan.journeys[0].steps;
    expect(read.bindings).toEqual([{ target: { kind: "reference", name: "id", locations: ["url"] }, captureStepId: create.id, captureName: "id", state: "active" }]);
    expect(remove.bindings![0].captureStepId).toBe(again.id);
    expect(requests.get(read.id)!.template.url).toBe(`{{baseUrl}}/items/{{${captureKeyOf(create.id, "id")}}}`);
    expect(read.requiredValues).toEqual(["baseUrl"]);
    expect(plan.collection!.findings.filter((finding) => finding.kind === "scope-precedence")).toEqual([
      { kind: "scope-precedence", owner: { kind: "request", itemId: "create" }, event: "test", stepIds: [create.id], line: 1, column: null, excerpt: null, detail: "id" },
    ]);
  });

  it("re-binds on every assembly: after removing the capturing step, and after a reorder", () => {
    const removed = assemble(collection, ids, { excludedRequestIds: ["again"] }).plan.journeys[0].steps;
    expect(removed.find((step) => step.collectionRequest?.itemId === "delete")!.bindings![0].captureStepId).toBe(removed[0].id);
    const none = assemble(collection, ids, { excludedRequestIds: ["create", "again"] }).plan;
    expect(none.journeys[0].steps.every((step) => step.bindings === undefined)).toBe(true);
    expect(none.userSuppliedValues.map((value) => [value.name, value.source])).toEqual([
      ["baseUrl", "base-url"],
      ["id", "collection-variable"],
    ]);
  });

  it("binds in folder scripts on every step inside the folder", () => {
    const folder = collectionOf([
      folderItem("f", "F", [requestItem("one", "One"), requestItem("two", "Two")], { event: [testScript('pm.environment.set("last", pm.response.json().id);')] }),
      requestItem("after", "After", { url: "{{baseUrl}}/x/{{last}}" }),
    ]);
    const { plan: built } = assemble(folder, ["one", "two", "after"]);
    const [one, two, after] = built.journeys[0].steps;
    expect(one.captures?.map((entry) => entry.name)).toEqual(["last"]);
    expect(two.captures?.map((entry) => entry.name)).toEqual(["last"]);
    expect(after.bindings![0].captureStepId).toBe(two.id);
  });
});
