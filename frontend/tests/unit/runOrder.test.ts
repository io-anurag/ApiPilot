import { describe, expect, it } from "vitest";
import { applyRunOrder, moveRunOrderItem } from "../../src/utils/runOrder";

const requests = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("applyRunOrder (specs/028 FR-015c)", () => {
  it("keeps the collection's own order when no run order is set", () => {
    expect(applyRunOrder(requests, undefined).map((request) => request.id)).toEqual(["a", "b", "c"]);
  });

  it("uses the run order, dropping ids that no longer exist and placing new requests last", () => {
    expect(applyRunOrder(requests, ["c", "gone", "a"]).map((request) => request.id)).toEqual(["c", "a", "b"]);
  });
});

describe("moveRunOrderItem", () => {
  it("moves an id down or up to the given index", () => {
    expect(moveRunOrderItem(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveRunOrderItem(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("clamps the index to the list, and leaves the list unchanged for an unknown id", () => {
    expect(moveRunOrderItem(["a", "b"], "a", 5)).toEqual(["b", "a"]);
    expect(moveRunOrderItem(["a", "b"], "b", -1)).toEqual(["b", "a"]);
    expect(moveRunOrderItem(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});
