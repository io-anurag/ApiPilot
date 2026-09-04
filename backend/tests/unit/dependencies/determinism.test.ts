import { describe, expect, it } from "vitest";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import { crudChainApiModel } from "../../fixtures/dependencies/dependencyFixtures";

describe("analyzeDependencies determinism", () => {
  it("produces an identical serialized graph across repeated runs", async () => {
    const first = await analyzeDependencies(crudChainApiModel);
    const second = await analyzeDependencies(crudChainApiModel);
    expect(JSON.stringify(second.graph)).toBe(JSON.stringify(first.graph));
    expect(second.requestId).toBe(first.requestId);
  });

  it("produces the same relationships when the ApiModel's operations are shuffled", async () => {
    const shuffled = {
      ...crudChainApiModel,
      operations: [...crudChainApiModel.operations].reverse(),
    };
    const original = await analyzeDependencies(crudChainApiModel);
    const reordered = await analyzeDependencies(shuffled);

    const sortRelationships = (relationships: typeof original.graph.relationships) =>
      [...relationships].sort((a, b) => a.id.localeCompare(b.id));

    expect(sortRelationships(reordered.graph.relationships)).toEqual(
      sortRelationships(original.graph.relationships),
    );
  });

  it("produces an identical set of workflows, variables, and relationshipIds across repeated runs", async () => {
    const first = await analyzeDependencies(crudChainApiModel);
    const second = await analyzeDependencies(crudChainApiModel);

    const sortWorkflows = (workflows: typeof first.workflows) =>
      [...workflows].sort((a, b) => a.id.localeCompare(b.id));

    expect(sortWorkflows(second.workflows)).toEqual(sortWorkflows(first.workflows));
    expect(
      [...second.manualConfirmationCandidates].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId)),
    ).toEqual(
      [...first.manualConfirmationCandidates].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId)),
    );
  });

  it("produces the same workflows when the relationship input order is shuffled", async () => {
    const shuffled = {
      ...crudChainApiModel,
      operations: [...crudChainApiModel.operations].reverse(),
    };
    const original = await analyzeDependencies(crudChainApiModel);
    const reordered = await analyzeDependencies(shuffled);

    const sortWorkflows = (workflows: typeof original.workflows) =>
      [...workflows].sort((a, b) => a.id.localeCompare(b.id));

    expect(sortWorkflows(reordered.workflows)).toEqual(sortWorkflows(original.workflows));
  });
});
