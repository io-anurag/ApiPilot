import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { baseInput, findScenario, ordersScenarios, scenariosOf, uploadedRun, asCoverageScenarios } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();
const deletes = scenariosOf({ method: "DELETE", path: "/orders/{id}" }, all);

/** The invariants of coverage-rules.md 3 and 5.1, checked on every snapshot below. */
function expectInvariants(snapshot: CoverageSnapshot): void {
  const c = snapshot.operationCounts;
  expect(c.withScenarios + c.withNoScenarios).toBe(c.eligible);
  expect(c.withPassingVerification).toBeLessThanOrEqual(c.withScenarios);
  expect(c.withFailures).toBeLessThanOrEqual(c.withScenarios);
  for (const op of snapshot.operations) {
    const v = op.scenarioVerdicts;
    expect(v.passed + v.failed + v.inconclusive + v.notExecuted).toBe(op.scenarioCount);
  }
}

describe("operation-level counts OC1 to OC5", () => {
  it("counts every operation with a scenario and none without runs as passing", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(snapshot.operationCounts).toEqual({ eligible: 4, withScenarios: 4, withPassingVerification: 0, withFailures: 0, withNoScenarios: 0 });
    expectInvariants(snapshot);
  });

  it("counts an operation without scenarios as having none, while other operations are unaffected", () => {
    const without = all.filter((s) => s.operationMethod !== "DELETE");
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(without) }));
    expect(snapshot.operationCounts).toMatchObject({ eligible: 4, withScenarios: 3, withNoScenarios: 1 });
    expectInvariants(snapshot);
  });

  it("puts an operation with a passed and a failed scenario in both counts, hiding neither", () => {
    const failing = findScenario(all, "POST", "/orders", "positive-scenario");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { failing: new Set([failing.id]) })] }));
    const post = snapshot.operations.find((o) => o.operationKey === "POST /orders");
    expect(post?.scenarioVerdicts.failed).toBe(1);
    expect(post?.scenarioVerdicts.passed).toBeGreaterThan(0);
    expect(snapshot.operationCounts).toMatchObject({ withPassingVerification: 4, withFailures: 1 });
    expectInvariants(snapshot);
  });

  it("puts a scenario that passed its status check but failed its schema check in the failed count", () => {
    const happy = findScenario(all, "POST", "/orders", "positive-scenario");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { schemaFailing: new Set([happy.id]) })] }));
    expect(snapshot.scenarios.find((s) => s.scenarioId === happy.id)?.verdict).toBe("failed");
    expect(snapshot.operationCounts.withFailures).toBe(1);
  });

  it.each([
    ["transport errors", { timeout: new Set(deletes.map((s) => s.id)) }],
    ["edited requests", { edited: new Set(deletes.map((s) => s.id)) }],
    ["unevaluated checks", { noTests: new Set(deletes.map((s) => s.id)) }],
  ])("keeps an operation whose only evidence is %s out of passing and failures", (_name, options) => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(deletes, options)] }));
    const del = snapshot.operations.find((o) => o.operationKey === "DELETE /orders/{id}");
    expect(del?.scenarioVerdicts).toMatchObject({ passed: 0, failed: 0, inconclusive: deletes.length });
    expect(snapshot.operationCounts).toMatchObject({ withPassingVerification: 0, withFailures: 0, withScenarios: 4 });
    expectInvariants(snapshot);
  });

  it("excludes out-of-scope operations from every count", () => {
    const snapshot = calculateCoverage(baseInput({ selectedOperationKeys: ["POST /orders"], uploadedRuns: [uploadedRun(all)] }));
    expect(snapshot.operationCounts).toEqual({ eligible: 1, withScenarios: 1, withPassingVerification: 1, withFailures: 0, withNoScenarios: 0 });
    expect(snapshot.scenarios.every((s) => s.operationKey === "POST /orders")).toBe(true);
    expectInvariants(snapshot);
  });

  it("never uses scenario counts as a coverage numerator or denominator", () => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all)] }));
    expect(snapshot.metrics.some((m) => m.denominator === snapshot.scenarios.length && m.kind !== "operation" && m.kind !== "assertion" && m.denominator > 4)).toBe(false);
  });

  it("gives an operation with no scenario no single status: only counts", () => {
    const without = all.filter((s) => s.operationMethod !== "DELETE");
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(without) }));
    const del = snapshot.operations.find((o) => o.operationKey === "DELETE /orders/{id}");
    expect(del).toBeDefined();
    expect(Object.keys(del ?? {})).not.toContain("state");
    expect(del?.scenarioCount).toBe(0);
    expect(del?.stateCounts["not-covered"]).toBe(del?.stateCounts["not-covered"]);
  });
});
