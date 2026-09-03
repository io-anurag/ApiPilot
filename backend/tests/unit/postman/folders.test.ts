import { describe, expect, it } from "vitest";
import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { folderNameForOperation, groupAndName } from "../../../src/postman/folders";
import { exportApiModel } from "../../fixtures/postman/exportFixtures";

function operation(overrides: Partial<ApiOperation>): ApiOperation {
  return {
    path: "/things",
    method: "GET",
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
    ...overrides,
  };
}

function scenario(id: string, overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id,
    operationPath: "/things",
    operationMethod: "GET",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [],
    provenance: { source: "RULE", rule: "positive", description: "d", duplicateOfRules: [] },
    ...overrides,
  };
}

describe("folderNameForOperation", () => {
  it("uses the operation's first declared tag", () => {
    expect(folderNameForOperation(operation({ tags: ["orders", "beta"] }))).toBe("orders");
  });

  it("falls back to the first path segment when the operation declares no tag", () => {
    expect(folderNameForOperation(operation({ path: "/orders/{orderId}", tags: [] }))).toBe(
      "orders",
    );
  });

  it("falls back to a single Ungrouped folder when the path has no segment", () => {
    expect(folderNameForOperation(operation({ path: "/", tags: [] }))).toBe("Ungrouped");
  });

  it("replaces characters that are awkward in a folder label", () => {
    expect(folderNameForOperation(operation({ tags: ["orders/v1:beta"] }))).toBe("orders-v1-beta");
  });
});

describe("groupAndName", () => {
  it("groups scenarios into folders ordered by folder name", () => {
    const folders = groupAndName([
      { scenario: scenario("s1", { operationPath: "/reports/upload", operationMethod: "POST" }), operation: exportApiModel.operations[2] },
      { scenario: scenario("s2", { operationPath: "/orders", operationMethod: "GET" }), operation: exportApiModel.operations[1] },
    ]);
    expect(folders.map((folder) => folder.name)).toEqual(["orders", "reports"]);
  });

  it("names each request with its method, path, and scenario category", () => {
    const folders = groupAndName([
      {
        scenario: scenario("s1", { operationPath: "/orders", operationMethod: "GET", category: "invalid-type" }),
        operation: exportApiModel.operations[1],
      },
    ]);
    expect(folders[0].entries[0].requestName).toBe("GET /orders — invalid-type");
  });

  it("disambiguates colliding request names deterministically", () => {
    const pairs = [
      { scenario: scenario("s2", { operationPath: "/orders" }), operation: exportApiModel.operations[1] },
      { scenario: scenario("s1", { operationPath: "/orders" }), operation: exportApiModel.operations[1] },
    ];
    const names = groupAndName(pairs)[0].entries.map((entry) => entry.requestName);
    expect(names).toEqual(["GET /orders — positive", "GET /orders — positive (2)"]);
    // The suffix follows the sort order, not the input order.
    expect(groupAndName([...pairs].reverse())[0].entries.map((e) => e.requestName)).toEqual(names);
  });

  it("disambiguates folder names that collide after normalization", () => {
    const taggedA = operation({ path: "/a", tags: ["orders/v1"] });
    const taggedB = operation({ path: "/b", tags: ["orders:v1"] });
    const folders = groupAndName([
      { scenario: scenario("s1", { operationPath: "/a" }), operation: taggedA },
      { scenario: scenario("s2", { operationPath: "/b" }), operation: taggedB },
    ]);
    expect(folders.map((folder) => folder.name)).toEqual(["orders-v1", "orders-v1 (2)"]);
  });

  it("emits no empty folder", () => {
    const folders = groupAndName([]);
    expect(folders).toEqual([]);
  });

  it("orders requests within a folder by path, method, category, then scenario id", () => {
    const listOrders = exportApiModel.operations[1];
    const folders = groupAndName([
      { scenario: scenario("s3", { operationPath: "/orders", category: "positive" }), operation: listOrders },
      { scenario: scenario("s1", { operationPath: "/orders", category: "invalid-type" }), operation: listOrders },
    ]);
    expect(folders[0].entries.map((entry) => entry.scenario.id)).toEqual(["s1", "s3"]);
  });
});