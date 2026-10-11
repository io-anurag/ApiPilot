import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { itemIdForOAuth2TokenFetch, itemIdForScenario } from "../../../src/postman/identifiers";
import { baseInput, findScenario, guidedRun, ordersScenarios, scenariosOf, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";
import type { CoverageSnapshot, NotAttemptedReason } from "@apipilot/shared-domain";

const all = ordersScenarios();
const posts = scenariosOf({ method: "POST", path: "/orders" }, all);
const deletes = scenariosOf({ method: "DELETE", path: "/orders/{id}" }, all);
const requirement = (snapshot: CoverageSnapshot, id: string) => {
  const found = snapshot.requirements.find((r) => r.id === id);
  if (!found) throw new Error(`no requirement ${id}`);
  return found;
};

describe("evidence selection and disclosure (coverage-rules.md 8)", () => {
  it("takes the newest attributable result per scenario and names every contributing run", () => {
    const early = uploadedRun(deletes, { id: "a", startedAt: "2026-10-10T09:00:00.000Z", failing: new Set(deletes.map((s) => s.id)) });
    const mid = uploadedRun(posts, { id: "b", startedAt: "2026-10-10T10:00:00.000Z" });
    const late = uploadedRun(deletes, { id: "c", startedAt: "2026-10-10T11:00:00.000Z" });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [early, mid, late] }));
    expect(snapshot.execution.evidenceMode).toBe("latest-per-scenario");
    expect(snapshot.execution.runIds).toEqual(["c", "b"]);
    expect(snapshot.execution.evidenceByRun).toEqual([
      { runId: "c", scenarios: deletes.length },
      { runId: "b", scenarios: posts.length },
    ]);
    expect(snapshot.scenarios.filter((s) => s.operationKey === "DELETE /orders/{id}").every((s) => s.verdict === "passed")).toBe(true);
  });

  it("combines only runs of the newest qualifying run's environment and lists the others as excluded (D-2)", () => {
    const newest = uploadedRun(deletes, { id: "new", startedAt: "2026-10-10T11:00:00.000Z", collection: { name: "Orders collection", tier: "local" } });
    const other = uploadedRun(posts, { id: "other", startedAt: "2026-10-10T10:00:00.000Z", collection: { name: "Orders collection", tier: "production" } });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [newest, other] }));
    expect(snapshot.execution.runIds).toEqual(["new"]);
    expect(snapshot.execution.environments).toEqual([{ name: "Orders collection", tier: "local" }]);
    expect(snapshot.execution.excludedRuns).toEqual([
      { runId: "other", environment: { name: "Orders collection", tier: "production" }, reason: "different environment" },
    ]);
    expect(snapshot.notices.map((n) => n.code)).toContain("excluded-runs");
    expect(snapshot.scenarios.filter((s) => s.operationKey === "POST /orders").every((s) => s.verdict === "not-executed")).toBe(true);
  });

  it("evaluates a selected run as is, even from another environment", () => {
    const newest = uploadedRun(deletes, { id: "new", startedAt: "2026-10-10T11:00:00.000Z" });
    const other = uploadedRun(posts, { id: "other", startedAt: "2026-10-10T10:00:00.000Z", collection: { name: "Elsewhere", tier: "production" } });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [newest, other], runId: "other" }));
    expect(snapshot.execution.evidenceMode).toBe("single-run");
    expect(snapshot.execution.excludedRuns).toEqual([]);
    expect(snapshot.scenarios.filter((s) => s.operationKey === "POST /orders").every((s) => s.verdict === "passed")).toBe(true);
  });

  it("marks scenarios absent from a selected run as not in the selected run when they ran elsewhere", () => {
    const a = uploadedRun(posts, { id: "a", startedAt: "2026-10-10T09:00:00.000Z" });
    const b = uploadedRun(deletes, { id: "b", startedAt: "2026-10-10T10:00:00.000Z" });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [a, b], runId: "a" }));
    const del = requirement(snapshot, "op:DELETE /orders/{id}");
    expect(del.state).toBe("generated-not-executed");
    expect(del.cause).toBe("not-in-selected-run");
    const never = calculateCoverage(baseInput({ uploadedRuns: [a], runId: "a" }));
    expect(requirement(never, "op:DELETE /orders/{id}").cause).toBe("never-run");
  });

  it("derives every figure from one snapshot so cards, operations, scenarios and categories agree", () => {
    const failing = findScenario(all, "POST", "/orders", "positive-scenario");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { failing: new Set([failing.id]) })] }));
    const verdicts = snapshot.operations.reduce((s, o) => s + o.scenarioVerdicts.passed + o.scenarioVerdicts.failed + o.scenarioVerdicts.inconclusive + o.scenarioVerdicts.notExecuted, 0);
    expect(verdicts).toBe(snapshot.scenarios.length);
    expect(snapshot.metrics.find((m) => m.id === "runtime-operations")?.numerator).toBe(snapshot.operationCounts.withPassingVerification);
    expect(snapshot.metrics.find((m) => m.id === "spec-operations")?.numerator).toBe(snapshot.operationCounts.withScenarios);
    const assertions = snapshot.metrics.find((m) => m.id === "runtime-assertions");
    expect(assertions?.numerator).toBe(snapshot.assertionOutcomes.passed);
    expect(assertions?.denominator).toBe(snapshot.assertionOutcomes.passed + snapshot.assertionOutcomes.failed);
  });
});

describe("why an unexecuted requirement was not executed", () => {
  const reasons: [NotAttemptedReason, string][] = [
    ["dependency-not-met", "blocked-by-dependency"],
    ["cancelled", "run-cancelled"],
    ["run-ended-before-reached", "not-reached"],
  ];
  it.each(reasons)("reports a guided %s as %s", (reason, cause) => {
    const target = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    const run = guidedRun([target], { notAttempted: new Map([[target.id, reason]]) });
    const snapshot = calculateCoverage(baseInput({ guidedRuns: [run] }));
    const op = requirement(snapshot, "op:DELETE /orders/{id}");
    expect(op.state).toBe("generated-not-executed");
    expect(op.cause).toBe(cause);
    expect(snapshot.scenarios.find((s) => s.scenarioId === target.id)).toMatchObject({ verdict: "not-executed", cause });
  });

  it("reports an uploaded not-attempted result as cancelled", () => {
    const target = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun([target], { notAttempted: new Set([target.id]) })] }));
    expect(requirement(snapshot, "op:DELETE /orders/{id}").cause).toBe("run-cancelled");
  });

  it("reports a failed infrastructure request as a notice, never as an unattributed or failed requirement", () => {
    const run = uploadedRun(deletes);
    run.results.push({
      requestName: "token",
      requestMethod: "POST",
      outcome: "failed",
      failureCategory: "connectivity-failure",
      startedAt: run.startedAt,
      durationMs: 5,
      testOutcomes: [],
      itemId: itemIdForOAuth2TokenFetch("bearer"),
    });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [run] }));
    expect(snapshot.notices.map((n) => n.code)).toContain("infrastructure-error");
    expect(snapshot.execution.unattributedResults).toBe(0);
    expect(snapshot.requirements.some((r) => r.state === "executed-failed")).toBe(false);
    expect(itemIdForScenario(deletes[0].id)).not.toBe(itemIdForOAuth2TokenFetch("bearer"));
  });
});
