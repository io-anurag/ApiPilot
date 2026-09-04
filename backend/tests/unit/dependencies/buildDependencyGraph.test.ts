import { describe, expect, it } from "vitest";
import { buildDependencyGraph } from "../../../src/dependencies/buildDependencyGraph";
import { computeDeterministicRelationships } from "../../../src/dependencies/deterministicMatching";
import { crudChainApiModel, cyclicApiModel } from "../../fixtures/dependencies/dependencyFixtures";

describe("buildDependencyGraph", () => {
  it("identifies the cyclic fixture's relationships as a single cycle", () => {
    const relationships = computeDeterministicRelationships(cyclicApiModel);
    expect(relationships.length).toBeGreaterThanOrEqual(2);

    const { acyclicRelationships, cycles } = buildDependencyGraph(relationships);

    expect(acyclicRelationships).toEqual([]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].relationshipIds.sort()).toEqual([...relationships.map((r) => r.id)].sort());
    expect(cycles[0].operations).toEqual(
      expect.arrayContaining([
        { path: "/widgets", method: "POST" },
        { path: "/gadgets", method: "POST" },
      ]),
    );
  });

  it("reports no cycles for an acyclic relationship set", () => {
    const relationships = computeDeterministicRelationships(crudChainApiModel);
    const { acyclicRelationships, cycles } = buildDependencyGraph(relationships);

    expect(cycles).toEqual([]);
    expect(acyclicRelationships).toHaveLength(relationships.length);
  });

  it("is deterministic across repeated calls", () => {
    const relationships = computeDeterministicRelationships(cyclicApiModel);
    const first = buildDependencyGraph(relationships);
    const second = buildDependencyGraph(relationships);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
