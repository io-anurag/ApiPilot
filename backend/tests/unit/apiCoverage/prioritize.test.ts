import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { assessGap, priorityForScore } from "../../../src/apiCoverage/prioritize";
import { baseInput, findScenario, ordersScenarios, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const ctx = { method: "GET", securityDeclared: false, constrainedFieldCount: 0 };

describe("assessGap", () => {
  it("ranks a destructive, unverified, secured operation above a harmless one with the same gap", () => {
    const destructive = assessGap({ method: "DELETE", securityDeclared: true, constrainedFieldCount: 0 }, "operation", "generated-not-executed");
    const harmless = assessGap(ctx, "operation", "generated-not-executed");
    expect(destructive.score).toBeGreaterThan(harmless.score);
    expect(destructive.priority).toBe("high");
  });

  it("explains every point it awards", () => {
    const assessment = assessGap({ method: "POST", securityDeclared: true, constrainedFieldCount: 12 }, "response-code", "not-covered");
    expect(assessment.factors.map((f) => f.factor).sort()).toEqual(["complexity", "kind", "method", "security", "state"]);
    expect(assessment.factors.reduce((sum, f) => sum + f.points, 0)).toBe(assessment.score);
    expect(assessment.factors.every((f) => f.explanation.length > 0)).toBe(true);
  });

  it("scores an executed failure above an unexecuted scenario", () => {
    expect(assessGap(ctx, "mixed", "executed-failed").score).toBeGreaterThan(assessGap(ctx, "mixed", "generated-not-executed").score);
  });

  it("caps complexity and uses fixed band thresholds", () => {
    expect(assessGap({ ...ctx, constrainedFieldCount: 1000 }, "mixed", "inconclusive").factors.find((f) => f.factor === "complexity")?.points).toBe(2);
    expect(priorityForScore(7)).toBe("high");
    expect(priorityForScore(6)).toBe("medium");
    expect(priorityForScore(3)).toBe("medium");
    expect(priorityForScore(2)).toBe("low");
  });
});

describe("gap grouping", () => {
  const all = ordersScenarios();
  const gapsOf = (snapshot: CoverageSnapshot, operationKey: string) => snapshot.gaps.filter((g) => g.operationKey === operationKey);

  it("reports one underlying gap once instead of one gap per kind", () => {
    const snapshot = calculateCoverage(baseInput());
    const unexecuted = gapsOf(snapshot, "DELETE /orders/{id}").filter((g) => g.state === "generated-not-executed");
    expect(unexecuted).toHaveLength(1);
    expect(unexecuted[0].kind).toBe("mixed");
    expect(unexecuted[0].requirementIds.length).toBeGreaterThan(3);
  });

  it("collapses everything about an operation with no scenario into a single gap", () => {
    const withoutDelete = all.filter((s) => s.operationMethod !== "DELETE").map((scenario) => ({ scenario, reviewState: "accepted" as const }));
    const snapshot = calculateCoverage(baseInput({ scenarios: withoutDelete }));
    const gaps = gapsOf(snapshot, "DELETE /orders/{id}");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].id).toBe("gap:DELETE /orders/{id}:no-scenarios");
    expect(gaps[0].priority).toBe("high");
  });

  it("separates an executed failure from unexecuted requirements", () => {
    const failing = new Set([findScenario(all, "POST", "/orders", "positive-scenario").id]);
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all.filter((s) => s.operationMethod === "POST"), { failing })] }));
    const states = gapsOf(snapshot, "POST /orders").map((g) => g.state);
    expect(states).toContain("executed-failed");
  });

  it("orders gaps by score then operation key, identically on repeat", () => {
    const a = calculateCoverage(baseInput());
    const b = calculateCoverage(baseInput());
    expect(a.gaps.map((g) => g.id)).toEqual(b.gaps.map((g) => g.id));
    const scores = a.gaps.map((g) => g.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it("gives an operation with no gaps low priority", () => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all)] }));
    const verifiedOps = snapshot.operations.filter((o) => o.stateCounts["not-covered"] === 0 && o.stateCounts["generated-not-executed"] === 0);
    expect(verifiedOps.length).toBeGreaterThan(0);
  });
});
