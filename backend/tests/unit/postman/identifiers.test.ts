import { describe, expect, it } from "vitest";
import { collectionIdForScenarios, itemIdForScenario } from "../../../src/postman/identifiers";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("itemIdForScenario", () => {
  it("is a pure function of the scenario id", () => {
    expect(itemIdForScenario("scenario-1")).toBe(itemIdForScenario("scenario-1"));
  });

  it("distinguishes different scenario ids", () => {
    expect(itemIdForScenario("scenario-1")).not.toBe(itemIdForScenario("scenario-2"));
  });

  it("produces a UUID-formatted identifier", () => {
    expect(itemIdForScenario("scenario-1")).toMatch(UUID_SHAPE);
  });

  it("does not depend on call order or elapsed time", () => {
    const first = itemIdForScenario("scenario-1");
    itemIdForScenario("scenario-9");
    expect(itemIdForScenario("scenario-1")).toBe(first);
  });
});

describe("collectionIdForScenarios", () => {
  it("is a pure function of the ordered scenario id list", () => {
    expect(collectionIdForScenarios(["a", "b"])).toBe(collectionIdForScenarios(["a", "b"]));
    expect(collectionIdForScenarios(["a", "b"])).toMatch(UUID_SHAPE);
  });

  it("changes when the scenario set changes", () => {
    expect(collectionIdForScenarios(["a", "b"])).not.toBe(collectionIdForScenarios(["a"]));
  });

  it("does not collide with an item id derived from the same single scenario", () => {
    expect(collectionIdForScenarios(["a"])).not.toBe(itemIdForScenario("a"));
  });
});
