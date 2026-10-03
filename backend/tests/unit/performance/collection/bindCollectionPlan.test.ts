import type { Capture } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { bindReferences, convertedCaptures, type DraftStep } from "../../../../src/performance/collection/bindCollectionPlan";
import type { CollectionScript } from "../../../../src/performance/collection/readCollectionRequests";
import { recognizeScript } from "../../../../src/performance/collection/recognizeScript";

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
