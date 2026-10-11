import type { CoverageGap, CoverageRequirementResult } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { recommendationsFor } from "../../../src/apiCoverage/summarize";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { baseInput, findScenario, ordersScenarios, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();

describe("recommendations", () => {
  it("names the operation, requirement, reason, evidence, priority, rationale and an action", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(snapshot.recommendations.length).toBeGreaterThan(0);
    for (const rec of snapshot.recommendations) {
      expect(rec.operationKey).toMatch(/^[A-Z]+ \//);
      expect(rec.requirement.length).toBeGreaterThan(0);
      expect(rec.why.length).toBeGreaterThan(0);
      expect(rec.rationale).toContain("heuristic");
      expect(["high", "medium", "low"]).toContain(rec.priority);
      expect(["generate-scenario", "review-scenario", "open-result", "re-run"]).toContain(rec.action.type);
      expect(Array.isArray(rec.evidence)).toBe(true);
    }
  });

  it("traces every recommendation to an existing gap and ranks them by gap order", () => {
    const snapshot = calculateCoverage(baseInput());
    const gapIds = snapshot.gaps.map((g) => g.id);
    snapshot.recommendations.forEach((rec, index) => {
      expect(rec.rank).toBe(index + 1);
      expect(rec.gapId).toBe(gapIds[index]);
    });
  });

  it("recommends generating a scenario when nothing covers a requirement", () => {
    const snapshot = calculateCoverage(baseInput());
    const missing = snapshot.recommendations.find((r) => r.gapId === "gap:POST /orders:response-code");
    expect(missing?.action.type).toBe("generate-scenario");
    expect(missing?.requirement).toContain("422");
  });

  it("recommends opening the failing result when a scenario failed, with real evidence", () => {
    const failing = new Set([findScenario(all, "POST", "/orders", "positive-scenario").id]);
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { failing })] }));
    const rec = snapshot.recommendations.find((r) => r.operationKey === "POST /orders" && r.action.type === "open-result");
    expect(rec).toBeDefined();
    expect(rec?.action.runId).toBe("run-1");
    expect(rec?.evidence.some((e) => e.verdict === "failed")).toBe(true);
    expect(rec?.action.scenarioIds.length).toBeGreaterThan(0);
  });

  it("recommends reviewing scenarios that were generated but not executed", () => {
    const snapshot = calculateCoverage(baseInput());
    const rec = snapshot.recommendations.find((r) => r.gapId === "gap:DELETE /orders/{id}:generated-not-executed:never-run");
    expect(rec?.action.type).toBe("review-scenario");
    expect(rec?.evidence).toEqual([]);
  });

  it("is identical on repeat and bounded", () => {
    const a = calculateCoverage(baseInput());
    const b = calculateCoverage(baseInput());
    expect(a.recommendations).toEqual(b.recommendations);
    expect(a.recommendations.length).toBeLessThanOrEqual(20);
  });

  it("offers nothing when everything is verified", () => {
    const only = all.filter((s) => s.operationMethod === "DELETE");
    const snapshot = calculateCoverage(baseInput({ selectedOperationKeys: ["DELETE /orders/{id}"], scenarios: only.map((scenario) => ({ scenario, reviewState: "accepted" })), uploadedRuns: [uploadedRun(only)] }));
    const unverified = snapshot.requirements.filter((r) => r.state !== "verified");
    expect(snapshot.gaps.flatMap((g) => g.requirementIds).sort()).toEqual(unverified.map((r) => r.id).sort());
  });

  it("keeps a timeout and an edited request in separate gaps, each with its cause", () => {
    const deletes = all.filter((s) => s.operationMethod === "DELETE");
    const [first, ...rest] = deletes;
    const snapshot = calculateCoverage(
      baseInput({ selectedOperationKeys: ["DELETE /orders/{id}"], scenarios: deletes.map((scenario) => ({ scenario, reviewState: "accepted" })), uploadedRuns: [uploadedRun(deletes, { timeout: new Set([first.id]), edited: new Set(rest.map((s) => s.id)) })] }),
    );
    const causes = snapshot.gaps.filter((g) => g.state === "inconclusive").map((g) => g.cause);
    expect(new Set(causes).size).toBe(causes.length);
    expect(causes).toEqual(expect.arrayContaining(["transport-error"]));
    expect(snapshot.gaps.find((g) => g.cause === "transport-error")?.reason).toContain("no response");
  });

  it("recommends re-running a stale gap, never reviewing or generating", () => {
    const gap: CoverageGap = {
      id: "gap:X:stale", operationKey: "GET /x", kind: "mixed", cause: undefined, requirementIds: ["r1"], state: "stale",
      reason: "1 requirements have evidence that no longer matches their contract and need re-execution.",
      categoryGroups: ["positive"], priority: "medium", score: 4, factors: [{ factor: "state", points: 2, explanation: "stale" }], evidence: [],
    };
    const requirement = { id: "r1", kind: "parameter", operationKey: "GET /x", label: "limit", contractHash: "h", group: "positive", state: "stale", reason: "r", scenarioIds: ["s9"], acceptedCount: 1, pendingCount: 0, tally: { passed: 0, failed: 0, inconclusive: 1, notExecuted: 0 }, evidence: [] } as CoverageRequirementResult;
    const [rec] = recommendationsFor([gap], [requirement]);
    expect(rec.action).toEqual({ type: "re-run", scenarioIds: ["s9"] });
  });

  it("ranks an executed failure above equal missing coverage and breaks ties by operation key", () => {
    const failing = new Set([findScenario(all, "GET", "/orders/{id}", "positive-scenario").id]);
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { failing })] }));
    const gaps = snapshot.gaps;
    for (let i = 1; i < gaps.length; i += 1) {
      const a = gaps[i - 1];
      const b = gaps[i];
      expect(a.score > b.score || (a.score === b.score && a.operationKey.localeCompare(b.operationKey) <= 0)).toBe(true);
    }
  });
});
