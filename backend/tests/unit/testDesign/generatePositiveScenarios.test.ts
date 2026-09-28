import { describe, expect, it } from "vitest";
import { dedupeKey } from "../../../src/testDesign/deduplicate";
import { generatePositiveScenarios, generateTestModel } from "../../../src/testDesign/generateTestModel";
import { loadQuickApiModel } from "../../fixtures/performance/specification";

/** AP-032 FR-004 (specs/032-quick-performance-test research Q3, tasks T015). */

const POSITIVE_RULES = new Set(["positive-scenario", "enum-positive-variant", "minimal-positive-scenario"]);

function withoutIds<T extends { id: string }>(scenarios: T[]): Omit<T, "id">[] {
  return scenarios.map(({ id: _id, ...rest }) => rest);
}

describe("generatePositiveScenarios", () => {
  it("generates positive scenarios only, from the three positive rules, for every operation", async () => {
    const apiModel = await loadQuickApiModel();
    const scenarios = generatePositiveScenarios(apiModel);

    expect(scenarios.length).toBeGreaterThan(0);
    expect(new Set(scenarios.map((scenario) => scenario.category))).toEqual(new Set(["positive"]));
    for (const scenario of scenarios) {
      expect(scenario.provenance.source).toBe("RULE");
      if (scenario.provenance.source === "RULE") expect(POSITIVE_RULES.has(scenario.provenance.rule)).toBe(true);
    }
    const covered = new Set(scenarios.map((scenario) => `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`));
    expect(covered.size).toBe(apiModel.operations.length);
  });

  it("yields generateTestModel's scenarios from the three positive rules, in the same order with the same requests", async () => {
    const apiModel = await loadQuickApiModel();
    const identity = (scenarios: ReturnType<typeof generatePositiveScenarios>) =>
      withoutIds(scenarios).map(({ operationMethod, operationPath, request, assertions, provenance }) => ({
        operationMethod,
        operationPath,
        request,
        assertions,
        rule: provenance.source === "RULE" ? provenance.rule : undefined,
      }));
    const positive = generatePositiveScenarios(apiModel);
    const fromPositiveRules = generateTestModel(apiModel).scenarios.filter(
      (scenario) => scenario.provenance.source === "RULE" && POSITIVE_RULES.has(scenario.provenance.rule),
    );
    expect(identity(positive)).toEqual(identity(fromPositiveRules));
  });

  it("does not run the boundary rules, so their valid at-boundary variants are not generated (research Q3)", async () => {
    const apiModel = await loadQuickApiModel();
    const boundary = generateTestModel(apiModel).scenarios.filter(
      (scenario) => scenario.category === "positive" && scenario.provenance.source === "RULE" && !POSITIVE_RULES.has(scenario.provenance.rule),
    );
    expect(boundary.length).toBeGreaterThan(0);
    const rules = new Set(generatePositiveScenarios(apiModel).map((scenario) => (scenario.provenance.source === "RULE" ? scenario.provenance.rule : "")));
    for (const scenario of boundary) expect(rules.has(scenario.provenance.source === "RULE" ? scenario.provenance.rule : "")).toBe(false);
  });

  it("never yields two equivalent scenarios (deduplication applies, FR-012 of AP-003)", async () => {
    const positive = generatePositiveScenarios(await loadQuickApiModel());
    expect(new Set(positive.map((scenario) => dedupeKey(scenario))).size).toBe(positive.length);
  });

  it("leaves generateTestModel's negative categories in place", async () => {
    const apiModel = await loadQuickApiModel();
    const categories = new Set(generateTestModel(apiModel).scenarios.map((scenario) => scenario.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});
