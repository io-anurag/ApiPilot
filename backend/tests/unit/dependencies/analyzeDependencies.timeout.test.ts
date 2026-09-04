import { describe, expect, it } from "vitest";
import {
  analyzeDependencies,
  DependencyAnalysisTimeoutError,
} from "../../../src/dependencies/analyzeDependencies";
import { buildLargeApiModel } from "../../fixtures/dependencies/dependencyFixtures";

describe("analyzeDependencies timeout guard", () => {
  it("rejects with DependencyAnalysisTimeoutError when the budget is exceeded, rather than hanging or returning a partial result", async () => {
    const largeModel = buildLargeApiModel(200);

    await expect(
      analyzeDependencies(largeModel, undefined, { timeoutMs: -1 }),
    ).rejects.toBeInstanceOf(DependencyAnalysisTimeoutError);
  });

  it("still succeeds under a generous budget", async () => {
    const largeModel = buildLargeApiModel(200);
    const result = await analyzeDependencies(largeModel, undefined, { timeoutMs: 60_000 });
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });
});
