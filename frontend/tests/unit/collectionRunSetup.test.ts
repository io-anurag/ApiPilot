import { describe, expect, it } from "vitest";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import { authLabel, formatMinimumTime, hostOfUrl, summarizeCollectionRun } from "../../src/utils/collectionRunSetup";

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

describe("summarizeCollectionRun variables", () => {
  function withReferences(id: string, references: CollectionRequestView["variableReferences"]): CollectionRequestView {
    return { ...request(id, "GET", "https://one.test/x"), variableReferences: references };
  }

  it("lists every variable the selected requests use, once, with where and how many, and never a value", () => {
    const requests = [
      withReferences("a", [
        { name: "baseUrl", usedIn: ["url"], resolved: true, source: "environment" },
        { name: "token", usedIn: ["headers"], resolved: false },
      ]),
      withReferences("b", [
        { name: "baseUrl", usedIn: ["url", "body"], resolved: true, source: "environment" },
        { name: "id", usedIn: ["url"], resolved: true, source: "collection-default" },
      ]),
      withReferences("c", [{ name: "unselected", usedIn: ["url"], resolved: false }]),
    ];
    const { variables } = summarizeCollectionRun({ orderedRequests: requests, selectedIds: new Set(["a", "b"]) });
    expect(variables).toEqual([
      { name: "token", requestCount: 1, usedIn: ["headers"], resolved: false },
      { name: "baseUrl", requestCount: 2, usedIn: ["url", "body"], resolved: true, source: "environment" },
      { name: "id", requestCount: 1, usedIn: ["url"], resolved: true, source: "collection-default" },
    ]);
    expect(JSON.stringify(variables)).not.toContain("value");
  });

  it("is empty when the selected requests use no variables", () => {
    const { variables } = summarizeCollectionRun({ orderedRequests: [withReferences("a", [])], selectedIds: new Set(["a"]) });
    expect(variables).toEqual([]);
  });
});

describe("summarizeCollectionRun at a glance", () => {
  const base = (id: string, extra: Partial<CollectionRequestView> = {}): CollectionRequestView => ({ ...request(id, "GET", "https://one.test/x"), ...extra });
  const auth = (type: string): CollectionRequestView["auth"] => ({ type, source: { kind: "collection" }, fields: [] });

  const all = [
    base("a", { auth: auth("bearer"), testScript: "pm.test('ok', () => {})", wasEdited: true }),
    base("b", { auth: auth("bearer"), testScript: "   " }),
    base("c"),
    base("d", { auth: auth("basic"), testScript: "pm.test('x', () => {})" }),
  ];
  const placements = new Map([
    ["a", { folderPath: ["Auth"] }],
    ["b", { folderPath: ["Core", "Products"] }],
    ["c", { folderPath: [] }],
    ["d", { folderPath: ["Auth"] }],
  ]);

  it("counts the authentication types, the test scripts and the edited requests among the selected", () => {
    const setup = summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["a", "b", "c", "d"]) });
    expect(setup.auth).toEqual([
      { type: "bearer", count: 2 },
      { type: "basic", count: 1 },
      { type: "noauth", count: 1 },
    ]);
    expect(setup.withTests).toBe(2);
    expect(setup.edited).toBe(1);
    const fewer = summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["c"]) });
    expect(fewer.auth).toEqual([{ type: "noauth", count: 1 }]);
    expect(fewer.withTests).toBe(0);
    expect(fewer.edited).toBe(0);
  });

  it("counts the selected requests per folder, and is empty when the folders are not known", () => {
    const selectedIds = new Set(["a", "b", "c", "d"]);
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds, placements }).folders).toEqual([
      { folderPath: ["Auth"], count: 2 },
      { folderPath: ["Core", "Products"], count: 1 },
      { folderPath: [], count: 1 },
    ]);
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds }).folders).toEqual([]);
  });

  it("gives the least time as the delay across the gaps between requests, and none without a delay", () => {
    const selectedIds = new Set(["a", "b", "c", "d"]);
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds, requestDelayMs: 500 }).minimumDurationMs).toBe(1500);
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds }).minimumDurationMs).toBeNull();
    expect(summarizeCollectionRun({ orderedRequests: all, selectedIds: new Set(["a"]), requestDelayMs: 500 }).minimumDurationMs).toBeNull();
  });
});

describe("formatMinimumTime and authLabel", () => {
  it("formats a short time with a decimal, a longer one in whole seconds, and minutes from sixty seconds", () => {
    expect(formatMinimumTime(1800)).toBe("1.8 s");
    expect(formatMinimumTime(12_400)).toBe("12 s");
    expect(formatMinimumTime(60_000)).toBe("1 min");
    expect(formatMinimumTime(125_000)).toBe("2 min 5 s");
  });

  it("names known auth types and passes others through", () => {
    expect(authLabel("bearer")).toBe("Bearer token");
    expect(authLabel("noauth")).toBe("No auth");
    expect(authLabel("custom-thing")).toBe("custom-thing");
  });
});
