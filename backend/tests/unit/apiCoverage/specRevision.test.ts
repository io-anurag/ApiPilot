import { describe, expect, it } from "vitest";
import { specificationRevision, stableStringify } from "../../../src/apiCoverage/specRevision";
import { ordersApiModel } from "../../fixtures/apiCoverage/coverageFixtures";

describe("specificationRevision", () => {
  it("is stable across operation order", () => {
    const reordered = { ...ordersApiModel, operations: [...ordersApiModel.operations].reverse() };
    expect(specificationRevision(reordered)).toBe(specificationRevision(ordersApiModel));
  });

  it("ignores info.title and info.version but changes with the contract", () => {
    const renamed = { ...ordersApiModel, info: { title: "Other", version: "9.9.9" } };
    expect(specificationRevision(renamed)).toBe(specificationRevision(ordersApiModel));

    const changed = structuredClone(ordersApiModel);
    changed.operations[0].responses.push({ statusCode: "409", description: "Conflict", contentTypes: {}, examples: {} });
    expect(specificationRevision(changed)).not.toBe(specificationRevision(ordersApiModel));
  });

  it("serializes objects with sorted keys and tolerates undefined", () => {
    expect(stableStringify({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] })).toBe('{"b":1,"c":[{"y":2,"z":1}]}');
  });
});
