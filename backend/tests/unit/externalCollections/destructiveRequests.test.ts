import { describe, expect, it } from "vitest";
import { Collection } from "postman-collection";
import { findDestructiveRequests } from "../../../src/externalCollections/destructiveRequests";
import { DESTRUCTIVE_METHODS } from "../../../src/execution/destructiveOperations";

function request(name: string, method: string) {
  return { name, request: { method, url: "https://example.test" } };
}

describe("findDestructiveRequests", () => {
  it("finds destructive requests in a flat collection", () => {
    const collection = new Collection({
      info: { name: "c" },
      item: [request("Get widget", "GET"), request("Create widget", "POST")],
    });
    expect(findDestructiveRequests(collection)).toEqual([
      { operationPath: "Create widget", operationMethod: "POST" },
    ]);
  });

  it("finds destructive requests nested in folders", () => {
    const collection = new Collection({
      info: { name: "c" },
      item: [{ name: "folder", item: [request("Delete widget", "DELETE")] }],
    });
    expect(findDestructiveRequests(collection)).toEqual([
      { operationPath: "Delete widget", operationMethod: "DELETE" },
    ]);
  });

  it("returns an empty array when no request is destructive", () => {
    const collection = new Collection({
      info: { name: "c" },
      item: [request("Get widget", "GET"), request("List widgets", "GET")],
    });
    expect(findDestructiveRequests(collection)).toEqual([]);
  });

  it("classifies against the exact same DESTRUCTIVE_METHODS set the ApiModel-based path uses", () => {
    expect(DESTRUCTIVE_METHODS).toEqual(new Set(["POST", "PUT", "PATCH", "DELETE"]));
  });
});
