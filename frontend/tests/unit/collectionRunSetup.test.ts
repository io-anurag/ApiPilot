import { describe, expect, it } from "vitest";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import { hostOfUrl, summarizeCollectionRun } from "../../src/utils/collectionRunSetup";

function request(id: string, method: string, url: string, unresolvedVariables: string[] = []): CollectionRequestView {
  return {
    id,
    name: `${method} ${id}`,
    wasEdited: false,
    raw: { method, url, headers: [] },
    resolved: { method, url, headers: [] },
    unresolvedVariables,
    variableReferences: [],
    copiedScriptFolderIds: [],
  };
}

describe("hostOfUrl", () => {
  it("returns the host with its port, or the leading variable, or the first segment", () => {
    expect(hostOfUrl("https://api.example.com/v1/x?y=1")).toBe("api.example.com");
    expect(hostOfUrl("http://localhost:3000/a")).toBe("localhost:3000");
    expect(hostOfUrl("{{baseUrl}}/a/b")).toBe("{{baseUrl}}");
    expect(hostOfUrl("example.com/path")).toBe("example.com");
    expect(hostOfUrl("")).toBe("(no URL)");
  });
});

describe("summarizeCollectionRun", () => {
  const all = [
    request("a", "GET", "https://one.test/a", ["token"]),
    request("b", "post", "https://one.test/b", ["token", "id"]),
    request("c", "DELETE", "https://two.test/c"),
    request("d", "PATCH", "https://two.test/d"),
  ];

  it("reads only the selected requests, in run order, with distinct hosts", () => {
    const setup = summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["c", "a"]) });
    expect(setup.selected.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(setup.hosts).toEqual(["one.test", "two.test"]);
    expect(setup.blockedReason).toBeNull();
  });

  it("counts writes by method in a fixed order, from the request's own method", () => {
    const setup = summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["a", "b", "c", "d"]) });
    expect(setup.writes.map((write) => write.method)).toEqual(["POST", "DELETE", "PATCH"]);
    expect(setup.writesByMethod).toEqual([
      { method: "POST", count: 1 },
      { method: "PATCH", count: 1 },
      { method: "DELETE", count: 1 },
    ]);
  });

  it("lists unresolved variables once each, sorted, for the selected requests only", () => {
    expect(
      summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["a", "b"]) }).unresolvedVariables,
    ).toEqual(["id", "token"]);
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["c"]) }).unresolvedVariables).toEqual([]);
  });

  it("blocks a run with nothing selected, but not an empty (not yet loaded) collection", () => {
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set() }).blockedReason).toMatch(/No requests are selected/);
    expect(summarizeCollectionRun({ orderedRequests: [], selectedIds: new Set() }).blockedReason).toBeNull();
  });
});
