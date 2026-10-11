import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { COVERAGE_STATES } from "@apipilot/shared-domain";
import { asCoverageScenarios, baseInput, ordersApiModel, ordersScenarios, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();
const executed = () => calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all)] }));
const category = (snapshot: ReturnType<typeof executed>, group: string) => {
  const found = snapshot.categoryCoverage.find((c) => c.group === group);
  if (!found) throw new Error(`no category ${group}`);
  return found;
};

describe("category coverage counts classified testable requirements (coverage-rules.md 10)", () => {
  it("partitions each category's eligible requirements across the states", () => {
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(all, { failing: new Set([all[0].id]) })] }));
    for (const group of ["positive", "negative", "boundary"]) {
      const c = category(snapshot, group);
      const inGroup = snapshot.requirements.filter((r) => r.group === group);
      expect(c.eligible).toBe(inGroup.length);
      expect(COVERAGE_STATES.reduce((sum, s) => sum + c.counts[s], 0)).toBe(c.eligible);
      expect(c.specCovered).toBe(c.eligible - c.counts["not-covered"]);
      expect(c.verified).toBe(c.counts.verified);
      expect(c.verified).toBeLessThanOrEqual(c.specCovered);
    }
  });

  it("keeps response keys no generator can provoke in their own metric but in no category", () => {
    const snapshot = executed();
    const unclassified = snapshot.requirements.filter((r) => r.group === "unclassified");
    expect(unclassified.map((r) => r.id)).toContain("resp:GET /orders/{id}:default");
    expect(snapshot.unclassified.requirements).toContainEqual({ operationKey: "GET /orders/{id}", label: "documented response default" });
    const classified = ["positive", "negative", "boundary"].reduce((sum, g) => sum + category(snapshot, g).eligible, 0);
    expect(classified + unclassified.length).toBe(snapshot.requirements.length);
    const codes = snapshot.metrics.find((m) => m.id === "spec-response-codes");
    expect(codes?.denominator).toBe(snapshot.requirements.filter((r) => r.kind === "response-code").length);
  });

  it("classifies exact 2xx positive and exact 4xx negative, and ranges, 3xx and 5xx as unclassified", () => {
    const model = structuredClone(ordersApiModel);
    model.operations[1].responses.push(
      { statusCode: "2XX", description: "range", contentTypes: {}, examples: {} },
      { statusCode: "503", description: "down", contentTypes: {}, examples: {} },
      { statusCode: "301", description: "moved", contentTypes: {}, examples: {} },
      { statusCode: "400", description: "bad", contentTypes: {}, examples: {} },
    );
    const snapshot = calculateCoverage(baseInput({ apiModel: model }));
    const group = (id: string) => snapshot.requirements.find((r) => r.id === id)?.group;
    expect(group("resp:GET /orders:200")).toBe("positive");
    expect(group("resp:GET /orders:400")).toBe("negative");
    expect(group("resp:GET /orders:2XX")).toBe("unclassified");
    expect(group("resp:GET /orders:503")).toBe("unclassified");
    expect(group("resp:GET /orders:301")).toBe("unclassified");
  });

  it("reports a category with no eligible requirements as unavailable, not as 0%", () => {
    const snapshot = calculateCoverage(baseInput({ selectedOperationKeys: ["DELETE /orders/{id}"] }));
    expect(category(snapshot, "boundary")).toMatchObject({ available: false, eligible: 0, specCovered: 0, verified: 0 });
  });

  it("never measures security and never lets a declared scheme change any category figure", () => {
    const withoutSecurity = structuredClone(ordersApiModel);
    for (const op of withoutSecurity.operations) op.security = [];
    const a = executed();
    const b = calculateCoverage(baseInput({ apiModel: withoutSecurity, uploadedRuns: [uploadedRun(all)] }));
    expect(category(a, "security")).toMatchObject({ available: false, eligible: 0, verified: 0 });
    expect(a.categoryCoverage).toEqual(b.categoryCoverage);
    expect(a.operations.find((o) => o.operationKey === "POST /orders")?.securityDeclared).toBe(true);
  });

  it("does not change any category figure when scenarios are duplicated", () => {
    const duplicated = [...all, ...all.map((s) => ({ ...s, id: `${s.id}-dup` }))];
    const single = calculateCoverage(baseInput());
    const doubled = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(duplicated) }));
    expect(doubled.categoryCoverage).toEqual(single.categoryCoverage);
  });

  it("credits the happy path from positive scenarios only", () => {
    const negativeOnly = all.filter((s) => s.operationMethod === "POST" && s.provenance.source === "RULE" && s.provenance.rule.startsWith("required-field-"));
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(negativeOnly) }));
    expect(snapshot.requirements.find((r) => r.id === "op:POST /orders")?.state).toBe("not-covered");
    expect(snapshot.operationCounts.withScenarios).toBe(1);
    expect(category(snapshot, "negative").specCovered).toBeGreaterThan(0);
  });
});
