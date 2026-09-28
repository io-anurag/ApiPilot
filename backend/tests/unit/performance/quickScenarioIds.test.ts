import { describe, expect, it } from "vitest";
import { withQuickScenarioIds } from "../../../src/performance/quick/quickScenarioIds";
import { selectPerformanceScenario } from "../../../src/performance/plan/selectScenario";
import { generatePositiveScenarios } from "../../../src/testDesign/generateTestModel";
import { loadQuickApiModel } from "../../fixtures/performance/specification";

/** AP-032 FR-005, FR-007 (specs/032-quick-performance-test research Q4, tasks T016). */

async function quickScenarios() {
  return withQuickScenarioIds(generatePositiveScenarios(await loadQuickApiModel()));
}

describe("withQuickScenarioIds", () => {
  it("gives every scenario a content-derived, rule-ranked id", async () => {
    const scenarios = await quickScenarios();
    for (const scenario of scenarios) expect(scenario.id).toMatch(/^q\d{2}-[0-9a-f]{24}$/);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);
  });

  it("gives the same ids for two separate analyses of the same file", async () => {
    const first = (await quickScenarios()).map((scenario) => scenario.id);
    const second = (await quickScenarios()).map((scenario) => scenario.id);
    expect(second).toEqual(first);
  });

  it("ranks the full happy path lowest, so AP-029's lowest-id rule picks it over enum and minimal variants", async () => {
    const apiModel = await loadQuickApiModel();
    const scenarios = await quickScenarios();
    const listOrders = apiModel.operations.find((operation) => operation.method.toUpperCase() === "GET" && operation.path === "/orders")!;
    const candidates = scenarios.filter((scenario) => scenario.operationPath === "/orders" && scenario.operationMethod.toUpperCase() === "GET");
    expect(candidates.length).toBeGreaterThan(1);

    const selection = selectPerformanceScenario(scenarios, listOrders);
    expect("scenario" in selection).toBe(true);
    if ("scenario" in selection) {
      expect(selection.scenario.id.startsWith("q00-")).toBe(true);
      expect(selection.scenario.provenance.source === "RULE" && selection.scenario.provenance.rule).toBe("positive-scenario");
    }
  });

  it("changes only the id, keeping each scenario's provenance", async () => {
    const generated = generatePositiveScenarios(await loadQuickApiModel());
    const renamed = withQuickScenarioIds(generated);
    expect(renamed.map(({ id: _id, ...rest }) => rest)).toEqual(generated.map(({ id: _id, ...rest }) => rest));
  });

  it("refuses a scenario from a rule outside the positive rules", async () => {
    const [first] = generatePositiveScenarios(await loadQuickApiModel());
    const negative = { ...first, category: "invalid-type" as const, provenance: { ...first.provenance, rule: "invalid-type" } };
    expect(() => withQuickScenarioIds([negative as typeof first])).toThrow(/invalid-type/);
  });
});
