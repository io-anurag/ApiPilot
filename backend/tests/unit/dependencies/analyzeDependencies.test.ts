import { describe, expect, it } from "vitest";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import { crudChainApiModel, minimalApiModelForNoRelationships } from "../../fixtures/dependencies/dependencyFixtures";

describe("analyzeDependencies (deterministic-only)", () => {
  it("produces the expected CONFIRMED relationship with source 'deterministic'", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    const created = result.graph.relationships.find(
      (r) => r.producer.operationPath === "/users" && r.consumer.operationPath === "/users/{userId}",
    );
    expect(created?.confidence).toBe("CONFIRMED");
    expect(created?.source).toBe("deterministic");
  });

  it("returns an explicit empty graph when there are no candidate relationships (FR-009)", async () => {
    const result = await analyzeDependencies(minimalApiModelForNoRelationships);
    expect(result.graph.relationships).toEqual([]);
  });

  it("reports aiOutcome 'skipped' when no AIProvider is supplied", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    expect(result.aiOutcome).toBe("skipped");
  });

  it("returns an explicit empty workflow/candidate/cycle set when there are no candidate relationships", async () => {
    const result = await analyzeDependencies(minimalApiModelForNoRelationships);
    expect(result.workflows).toEqual([]);
    expect(result.manualConfirmationCandidates).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  // Workflow assembly itself (ordering, variable naming, POSSIBLE/disambiguation/cycle handling)
  // is covered by assembleWorkflows.test.ts and buildDependencyGraph.test.ts (User Story 2); this
  // file only asserts that analyzeDependencies wires those results into its return value.
  it("wires assembled workflows into its result", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    expect(result.workflows.length).toBeGreaterThan(0);
  });
});
