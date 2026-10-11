import type { CoverageFilter } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { filterSnapshot } from "../../../src/apiCoverage/filterSnapshot";
import { baseInput, findScenario, ordersScenarios, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();
const failing = new Set([findScenario(all, "POST", "/orders", "positive-scenario").id]);
const snapshot = calculateCoverage(
  baseInput({ uploadedRuns: [uploadedRun(all.filter((s) => s.operationMethod !== "DELETE"), { failing })] }),
);
const keys = (filter: CoverageFilter) => filterSnapshot(snapshot, filter).operations.map((o) => o.operationKey);

describe("filterSnapshot", () => {
  it("returns everything for an empty filter and keeps totals unfiltered", () => {
    const result = filterSnapshot(snapshot, {});
    expect(result.operations).toHaveLength(4);
    expect(result.totals).toEqual(snapshot.totals);
  });

  it("filters by method, case-insensitively", () => {
    expect(keys({ methods: ["delete"] })).toEqual(["DELETE /orders/{id}"]);
    expect(keys({ methods: ["GET"] }).sort()).toEqual(["GET /orders", "GET /orders/{id}"]);
  });

  it("filters by path text", () => {
    expect(keys({ q: "{ID}" }).sort()).toEqual(["DELETE /orders/{id}", "GET /orders/{id}"]);
  });

  it("filters by coverage state", () => {
    expect(keys({ states: ["executed-failed"] })).toEqual(["POST /orders"]);
    expect(keys({ states: ["generated-not-executed"] })).toContain("DELETE /orders/{id}");
  });

  it("separates failed verification from missing coverage", () => {
    expect(keys({ gapKind: "failed" })).toEqual(["POST /orders"]);
    const missing = filterSnapshot(snapshot, { gapKind: "missing" });
    expect(missing.gaps.every((g) => g.state !== "executed-failed")).toBe(true);
    expect(missing.gaps.length).toBeGreaterThan(0);
  });

  it("filters by priority and category", () => {
    const high = filterSnapshot(snapshot, { priorities: ["high"] });
    expect(high.operations.every((o) => o.priority === "high")).toBe(true);
    expect(high.gaps.every((g) => g.priority === "high")).toBe(true);
    expect(keys({ category: "boundary" }).sort()).toEqual(["GET /orders", "POST /orders"]);
  });

  it("recomputes summary values from the filtered operations", () => {
    const post = filterSnapshot(snapshot, { methods: ["POST"] });
    const operations = post.metrics.find((m) => m.id === "spec-operations");
    expect(operations).toMatchObject({ numerator: 1, denominator: 1 });
    expect(post.requirements.every((r) => r.operationKey === "POST /orders")).toBe(true);
    expect(post.recommendations.every((r) => r.operationKey === "POST /orders")).toBe(true);
  });

  it("yields real zeros and no invalid numbers when nothing matches", () => {
    const none = filterSnapshot(snapshot, { q: "no-such-path" });
    expect(none.operations).toEqual([]);
    for (const metric of none.metrics) expect(metric.percentage).toBeNull();
    expect(JSON.stringify(none)).not.toMatch(/NaN|Infinity/);
  });

  it("sorts by each key in both directions with a stable tie-break", () => {
    expect(keys({ sort: "method", order: "asc" })[0]).toMatch(/^DELETE/);
    expect(keys({ sort: "method", order: "desc" })[0]).toMatch(/^POST/);
    expect(keys({ sort: "path", order: "asc" })[0]).toBe("GET /orders");
    const byPriority = filterSnapshot(snapshot, { sort: "priority", order: "asc" }).operations.map((o) => o.priority);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    expect([...byPriority].sort((a, b) => rank[a] - rank[b])).toEqual(byPriority);
    const bySpec = filterSnapshot(snapshot, { sort: "specification", order: "asc" }).operations;
    const ratio = (o: (typeof bySpec)[number]) => o.specification.covered / o.specification.total;
    expect(bySpec.map(ratio)).toEqual([...bySpec.map(ratio)].sort((a, b) => a - b));
    const byRuntime = keys({ sort: "runtime", order: "desc" });
    expect(byRuntime).toHaveLength(4);
  });

  it("does not mutate the snapshot it filters", () => {
    const before = JSON.stringify(snapshot);
    filterSnapshot(snapshot, { methods: ["POST"], sort: "path", order: "desc" });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  describe("refined semantics (coverage-rules.md 13.2)", () => {
    it("keeps operations with at least one requirement in the state and reports the matching count", () => {
      const result = filterSnapshot(snapshot, { states: ["executed-failed"] });
      expect(result.operations.map((o) => o.operationKey)).toEqual(["POST /orders"]);
      const row = result.operations[0];
      const failed = snapshot.requirements.filter((r) => r.operationKey === "POST /orders" && r.state === "executed-failed").length;
      expect(row.matchingRequirements).toBe(failed);
      // Cards cover every requirement of the kept operation, not only the matching ones.
      expect(result.requirements.filter((r) => r.operationKey === "POST /orders")).toHaveLength(
        snapshot.requirements.filter((r) => r.operationKey === "POST /orders").length,
      );
    });

    it.each([
      ["missing", ["not-covered", "generated-not-executed"]],
      ["failed", ["executed-failed"]],
      ["insufficient", ["inconclusive"]],
      ["stale", ["stale"]],
    ] as const)("gap type %s selects only its state family", (gapKind, states) => {
      const result = filterSnapshot(snapshot, { gapKind });
      for (const row of result.operations) {
        const own = snapshot.requirements.filter((r) => r.operationKey === row.operationKey);
        expect(own.some((r) => (states as readonly string[]).includes(r.state))).toBe(true);
      }
      expect(result.gaps.every((g) => (states as readonly string[]).includes(g.state))).toBe(true);
    });

    it("yields no rows for gap type stale because no rule produces stale evidence", () => {
      expect(filterSnapshot(snapshot, { gapKind: "stale" }).operations).toEqual([]);
    });

    it("restricts requirements and scenarios to the category and recomputes rows and cards over it", () => {
      const result = filterSnapshot(snapshot, { category: "boundary" });
      expect(result.requirements.every((r) => r.group === "boundary")).toBe(true);
      expect(result.scenarios.every((s) => s.group === "boundary")).toBe(true);
      for (const row of result.operations) {
        const own = result.requirements.filter((r) => r.operationKey === row.operationKey);
        expect(row.specification.total).toBe(own.filter((r) => r.kind !== "operation").length);
        expect(row.scenarioCount).toBe(result.scenarios.filter((s) => s.operationKey === row.operationKey).length);
      }
      const requestSchemas = result.metrics.find((m) => m.id === "spec-request-schemas");
      expect(requestSchemas?.denominator).toBe(result.requirements.filter((r) => r.kind === "request-schema").length);
      // The category section always shows all categories for the chosen operations.
      expect(result.categoryCoverage.find((c) => c.group === "positive")?.eligible).toBeGreaterThan(0);
      expect(result.operationCounts.eligible).toBe(result.operations.length);
    });

    it("drops operations with no requirement in the category", () => {
      expect(keys({ category: "boundary" })).not.toContain("DELETE /orders/{id}");
    });

    it("keeps the invariants on every filtered view", () => {
      for (const filter of [{}, { category: "negative" as const }, { methods: ["GET"] }, { states: ["verified" as const] }]) {
        const result = filterSnapshot(snapshot, filter);
        const c = result.operationCounts;
        expect(c.withScenarios + c.withNoScenarios).toBe(c.eligible);
        for (const cat of result.categoryCoverage.filter((x) => x.available)) {
          expect(Object.values(cat.counts).reduce((a, b) => a + b, 0)).toBe(cat.eligible);
        }
      }
    });
  });
});
