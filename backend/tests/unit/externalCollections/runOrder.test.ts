import { describe, expect, it } from "vitest";
import { Collection } from "postman-collection";
import { resolveRunOrder } from "../../../src/externalCollections/runOrder";
import { InvalidRunOrderError, NoRequestsSelectedError } from "../../../src/externalCollections/errors";

function request(id: string) {
  return { id, name: id, request: { method: "GET", url: "https://example.test" } };
}

function collection() {
  return new Collection({
    info: { name: "c" },
    item: [
      { name: "Auth", item: [request("auth-token")] },
      { name: "Meta", item: [request("health"), request("version")] },
    ],
  });
}

describe("resolveRunOrder (specs/026 FR-018, FR-019)", () => {
  it("returns undefined when no run order is given, so the collection's own order is used", () => {
    expect(resolveRunOrder(collection(), undefined)).toBeUndefined();
  });

  it("returns the ids in the order given, across folders", () => {
    expect(resolveRunOrder(collection(), ["health", "auth-token", "version"])).toEqual(["health", "auth-token", "version"]);
  });

  it("accepts a subset", () => {
    expect(resolveRunOrder(collection(), ["version", "health"])).toEqual(["version", "health"]);
  });

  it("refuses a repeated id rather than dropping it", () => {
    expect(() => resolveRunOrder(collection(), ["health", "health"])).toThrow(InvalidRunOrderError);
  });

  it("refuses a non-string entry", () => {
    expect(() => resolveRunOrder(collection(), ["health", 3])).toThrow(InvalidRunOrderError);
  });

  it("refuses an id the collection does not contain when another id matches", () => {
    expect(() => resolveRunOrder(collection(), ["health", "gone"])).toThrow(InvalidRunOrderError);
  });

  it("reports no requests selected when no id matches, or the order is empty", () => {
    expect(() => resolveRunOrder(collection(), ["gone"])).toThrow(NoRequestsSelectedError);
    expect(() => resolveRunOrder(collection(), [])).toThrow(NoRequestsSelectedError);
  });
});
