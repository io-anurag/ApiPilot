import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import {
  asCoverageScenarios,
  baseInput,
  findScenario,
  guidedRun,
  ordersApiModel,
  ordersScenarios,
  scenariosOf,
  uploadedRun,
} from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();
const metric = (snapshot: CoverageSnapshot, id: string) => {
  const found = snapshot.metrics.find((m) => m.id === id);
  if (!found) throw new Error(`no metric ${id}`);
  return found;
};
const requirement = (snapshot: CoverageSnapshot, id: string) => {
  const found = snapshot.requirements.find((r) => r.id === id);
  if (!found) throw new Error(`no requirement ${id}`);
  return found;
};
const stable = (snapshot: CoverageSnapshot) => JSON.stringify({ ...snapshot, calculatedAt: "" });

describe("calculateCoverage: specification coverage", () => {
  it("covers nothing, honestly, when no scenario exists", () => {
    const snapshot = calculateCoverage(baseInput({ scenarios: [] }));
    expect(metric(snapshot, "spec-operations")).toMatchObject({ numerator: 0, denominator: 4, percentage: 0 });
    expect(snapshot.requirements.every((r) => r.state === "not-covered")).toBe(true);
    expect(snapshot.notices.map((n) => n.code)).toContain("no-scenarios");
    expect(metric(snapshot, "runtime-assertions")).toMatchObject({ numerator: 0, denominator: 0, percentage: null, available: false });
  });

  it("leaves an operation with no scenario not covered while others are covered", () => {
    const without = all.filter((s) => !(s.operationMethod === "DELETE"));
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(without) }));
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("not-covered");
    expect(requirement(snapshot, "op:GET /orders/{id}").state).not.toBe("not-covered");
    expect(metric(snapshot, "spec-operations").numerator).toBe(3);
  });

  it("counts a generated scenario toward specification coverage but not runtime verification", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(metric(snapshot, "spec-operations").numerator).toBe(4);
    expect(metric(snapshot, "runtime-operations").numerator).toBe(0);
    expect(requirement(snapshot, "op:POST /orders").state).toBe("generated-not-executed");
    expect(snapshot.notices.map((n) => n.code)).toContain("not-executed");
  });

  it("keeps the same path with different methods as separate operations", () => {
    const snapshot = calculateCoverage(baseInput());
    const keys = snapshot.operations.map((o) => o.operationKey);
    expect(keys).toContain("GET /orders/{id}");
    expect(keys).toContain("DELETE /orders/{id}");
    expect(snapshot.operations).toHaveLength(4);
  });

  it("counts documented parameters once and excludes cookie parameters as not measurable", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(metric(snapshot, "spec-parameters").denominator).toBe(3);
    expect(snapshot.notMeasurable.some((n) => n.kind === "parameter" && n.reason.includes("cookie"))).toBe(true);
  });

  it("does not inflate coverage with duplicate scenarios", () => {
    const duplicated = [...all, ...all.map((s) => ({ ...s, id: `${s.id}-dup` }))];
    const single = calculateCoverage(baseInput());
    const doubled = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(duplicated) }));
    expect(doubled.metrics.map((m) => [m.id, m.numerator, m.denominator])).toEqual(single.metrics.map((m) => [m.id, m.numerator, m.denominator]));
    expect(requirement(doubled, "op:POST /orders").scenarioIds.length).toBe(requirement(single, "op:POST /orders").scenarioIds.length * 2);
  });

  it("reports documented responses nothing expects as not covered, including ranges and default", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(requirement(snapshot, "resp:POST /orders:422").state).toBe("not-covered");
    expect(requirement(snapshot, "resp:GET /orders/{id}:default").state).toBe("not-covered");
    expect(requirement(snapshot, "resp:POST /orders:201").state).toBe("generated-not-executed");
  });

  it("maps a response schema only through a scenario asserting code and schema together", () => {
    const withoutSchemaScenarios = all.map((s) => ({ ...s, assertions: s.assertions.filter((a) => a.type !== "schema-conformance") }));
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(withoutSchemaScenarios) }));
    expect(requirement(snapshot, "respschema:POST /orders:201").state).toBe("not-covered");
    expect(requirement(snapshot, "resp:POST /orders:201").state).not.toBe("not-covered");
  });

  it("limits every denominator to the selected operations and lists the rest as out of scope", () => {
    const snapshot = calculateCoverage(baseInput({ selectedOperationKeys: ["POST /orders"] }));
    expect(metric(snapshot, "spec-operations").denominator).toBe(1);
    expect(snapshot.outOfScopeOperations).toEqual(["DELETE /orders/{id}", "GET /orders", "GET /orders/{id}"]);
    expect(snapshot.operations.map((o) => o.operationKey)).toEqual(["POST /orders"]);
  });

  it("counts pending and accepted scenarios, never rejected, and reports the split", () => {
    const post = scenariosOf({ method: "POST", path: "/orders" }, all);
    const positive = findScenario(all, "POST", "/orders", "positive-scenario");
    const scenarios = [
      { scenario: positive, reviewState: "accepted" as const },
      ...post.filter((s) => s.id !== positive.id).slice(0, 2).map((scenario) => ({ scenario, reviewState: "pending" as const })),
      ...post.slice(5, 8).map((scenario) => ({ scenario, reviewState: "rejected" as const })),
    ];
    const snapshot = calculateCoverage(baseInput({ scenarios }));
    expect(snapshot.context.scenarioCounts).toMatchObject({ accepted: 1, pending: 2, rejected: 3, total: 6 });
    const op = requirement(snapshot, "op:POST /orders");
    expect(op.acceptedCount).toBe(1);
    expect(op.pendingCount).toBe(2);
    expect(op.scenarioIds).toHaveLength(3);
  });

  it("does not count a scenario that is only rejected", () => {
    const only = [{ scenario: findScenario(all, "DELETE", "/orders/{id}", "positive-scenario"), reviewState: "rejected" as const }];
    const snapshot = calculateCoverage(baseInput({ scenarios: only }));
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("not-covered");
  });

  it("reports unavailable metrics, never NaN, for a specification with nothing to measure", () => {
    const empty = calculateCoverage(baseInput({ apiModel: { ...ordersApiModel, operations: [] }, scenarios: [] }));
    for (const m of empty.metrics) {
      expect(m.percentage).toBeNull();
      expect(m.available).toBe(false);
    }
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);
  });

  it("reports security and authorization coverage as unavailable and never infers it", () => {
    const snapshot = calculateCoverage(baseInput());
    expect(snapshot.categoryCoverage.find((c) => c.group === "security")).toMatchObject({ available: false });
    expect(snapshot.categoryCoverage.find((c) => c.group === "security")).toMatchObject({ eligible: 0, specCovered: 0, verified: 0 });
    expect(snapshot.categoryCoverage.find((c) => c.group === "positive")?.eligible).toBe(snapshot.requirements.filter((r) => r.group === "positive").length);
    expect(snapshot.operations.find((o) => o.operationKey === "DELETE /orders/{id}")?.securityDeclared).toBe(true);
  });
});

describe("calculateCoverage: runtime evidence", () => {
  const run = (options = {}) => uploadedRun(all, options);

  it("verifies a requirement from a passing, evaluated execution", () => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [run()] }));
    expect(requirement(snapshot, "op:POST /orders").state).toBe("verified");
    expect(requirement(snapshot, "resp:POST /orders:201").state).toBe("verified");
    expect(requirement(snapshot, "respschema:POST /orders:201").state).toBe("verified");
    expect(metric(snapshot, "runtime-operations").numerator).toBe(4);
    expect(metric(snapshot, "runtime-assertions")).toMatchObject({ numerator: metric(snapshot, "runtime-assertions").denominator });
    expect(snapshot.execution.lastQualifyingExecutionAt).toBe("2026-10-10T11:00:00.000Z");
  });

  it("does not count a failed assertion as verified and does not call it untested", () => {
    const failing = findScenario(all, "POST", "/orders", "positive-scenario");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [run({ failing: new Set([failing.id]) })] }));
    const op = requirement(snapshot, "op:POST /orders");
    expect(op.state).toBe("executed-failed");
    expect(op.state).not.toBe("not-covered");
    expect(op.state).not.toBe("generated-not-executed");
    expect(requirement(snapshot, "resp:POST /orders:201").state).toBe("executed-failed");
    // POST /orders also has passing scenarios, so it has passing verification AND a failure; neither hides the other.
    expect(metric(snapshot, "runtime-operations").numerator).toBe(4);
    expect(snapshot.operationCounts).toMatchObject({ withPassingVerification: 4, withFailures: 1 });
    expect(snapshot.operations.find((o) => o.operationKey === "POST /orders")?.failedCount).toBeGreaterThan(0);
  });

  it("leaves a successful response with no evaluated checks inconclusive", () => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [run({ noTests: new Set(all.map((s) => s.id)) })] }));
    expect(requirement(snapshot, "respschema:POST /orders:201").state).toBe("inconclusive");
    expect(metric(snapshot, "runtime-operations").numerator).toBe(0);
    expect(metric(snapshot, "runtime-assertions").denominator).toBe(0);
  });

  it("treats an edited request as evidence that cannot verify", () => {
    const positive = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    const others = all.filter((s) => s.operationMethod === "DELETE");
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(others, { edited: new Set(others.map((s) => s.id)) })] }));
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("inconclusive");
    expect(positive).toBeDefined();
    expect(snapshot.notices.map((n) => n.code)).toContain("edited-results");
  });

  it("keeps unexecuted requirements separate from failures after a partial run", () => {
    const post = scenariosOf({ method: "POST", path: "/orders" }, all);
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(post)] }));
    expect(requirement(snapshot, "op:POST /orders").state).toBe("verified");
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("generated-not-executed");
    expect(snapshot.operations.find((o) => o.operationKey === "DELETE /orders/{id}")?.failedCount).toBe(0);
    expect(metric(snapshot, "spec-operations").numerator).toBe(4);
  });

  it("counts a repeated run once and lets the latest result decide", () => {
    const failing = new Set([findScenario(all, "DELETE", "/orders/{id}", "positive-scenario").id]);
    const earlyFail = uploadedRun(all, { id: "a", startedAt: "2026-10-10T09:00:00.000Z", failing });
    const latePass = uploadedRun(all, { id: "b", startedAt: "2026-10-10T10:00:00.000Z" });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [earlyFail, latePass] }));
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("verified");
    expect(metric(snapshot, "runtime-operations").numerator).toBe(4);
    const selected = calculateCoverage(baseInput({ uploadedRuns: [earlyFail, latePass], runId: "a" }));
    expect(requirement(selected, "op:DELETE /orders/{id}").state).toBe("executed-failed");
  });

  it("lists every selectable run, newest first, even when only one is evaluated", () => {
    const a = uploadedRun(all, { id: "a", startedAt: "2026-10-10T09:00:00.000Z" });
    const b = uploadedRun(all, { id: "b", startedAt: "2026-10-10T10:00:00.000Z" });
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [a, b], runId: "a" }));
    expect(snapshot.execution.availableRuns.map((r) => r.id)).toEqual(["b", "a"]);
    expect(snapshot.execution.runIds).toEqual(["a"]);
    expect(snapshot.execution.availableRuns[0]).toMatchObject({ kind: "uploaded", label: "Orders collection" });
  });

  it("uses guided-run evidence by assertion index", () => {
    const snapshot = calculateCoverage(baseInput({ guidedRuns: [guidedRun(all)] }));
    expect(requirement(snapshot, "resp:POST /orders:201").state).toBe("verified");
    expect(snapshot.execution.sources).toEqual(["guided"]);
  });

  it("reports results that match no current scenario as unattributed and never as verified", () => {
    const orphans = all.map((s) => ({ ...s, id: `old-${s.id}` }));
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(orphans)] }));
    expect(snapshot.execution.unattributedResults).toBe(all.length);
    expect(metric(snapshot, "runtime-operations").numerator).toBe(0);
    expect(snapshot.requirements.some((r) => r.state === "verified")).toBe(false);
    expect(snapshot.notices.find((n) => n.code === "unattributed-results")?.message).toContain("possibly from an earlier specification");
  });

  it("notes a scenario edited in review after its run without invalidating the evidence", () => {
    const edited = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    const scenarios = asCoverageScenarios(all).map((s) =>
      s.scenario.id === edited.id ? { ...s, editedAt: ["2026-10-10T11:30:00.000Z"] } : s,
    );
    const snapshot = calculateCoverage(baseInput({ scenarios, uploadedRuns: [run()] }));
    expect(snapshot.scenarioEditedAfterRun).toEqual([edited.id]);
    expect(requirement(snapshot, "op:DELETE /orders/{id}").state).toBe("verified");
  });
});

describe("calculateCoverage: determinism and identity", () => {
  it("returns identical output for identical input and for reordered scenarios", () => {
    const input = baseInput({ uploadedRuns: [uploadedRun(all)] });
    const first = calculateCoverage(input);
    expect(stable(calculateCoverage(input))).toBe(stable(first));
    const reordered = baseInput({ scenarios: asCoverageScenarios([...all].reverse()), uploadedRuns: [uploadedRun(all)] });
    expect(stable(calculateCoverage(reordered))).toBe(stable(first));
  });

  it("keeps requirement ids unchanged when an unrelated part of the specification changes", () => {
    const changed = structuredClone(ordersApiModel);
    changed.operations[3].responses.push({ statusCode: "409", description: "Conflict", contentTypes: {}, examples: {} });
    const before = calculateCoverage(baseInput());
    const after = calculateCoverage(baseInput({ apiModel: changed }));
    const postBefore = before.requirements.filter((r) => r.operationKey === "POST /orders").map((r) => [r.id, r.contractHash]);
    const postAfter = after.requirements.filter((r) => r.operationKey === "POST /orders").map((r) => [r.id, r.contractHash]);
    expect(postAfter).toEqual(postBefore);
    expect(after.specification.revision).not.toBe(before.specification.revision);
  });

  it("offers no overall coverage score", () => {
    const keys = JSON.stringify(Object.keys(calculateCoverage(baseInput())));
    expect(keys).not.toMatch(/overall|score|total_?coverage/i);
    expect(calculateCoverage(baseInput()).metrics.every((m) => !/overall/i.test(m.id))).toBe(true);
  });

  it("records the injected clock and never reads its own", () => {
    expect(calculateCoverage(baseInput()).calculatedAt).toBe("2026-10-10T12:00:00.000Z");
  });

  it("reports the specification name and version from the document, falling back to the filename", () => {
    expect(calculateCoverage(baseInput()).specification).toMatchObject({ name: "Orders API", version: "1.0.0" });
    const noInfo = { ...ordersApiModel, info: undefined };
    expect(calculateCoverage(baseInput({ apiModel: noInfo })).specification.name).toBe("orders.yaml");
  });
});
