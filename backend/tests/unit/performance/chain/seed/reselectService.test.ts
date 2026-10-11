import { describe, expect, it } from "vitest";
import type { Chain, ChainPlan, ChainStep, SeedingReportItem } from "@apipilot/shared-domain";
import { applyReselect } from "../../../../../src/performance/chain/seed/reselectService";
import { EditedStepsWouldBeRemovedError } from "../../../../../src/performance/errors";

/**
 * AP-047 (specs/047-unified-performance-tab data-model.md "Merge and reset semantics"): the pure core of
 * reselecting, on hand-built plans. The HTTP behaviour is in `chainPlanReselect.test.ts`.
 */

const NOW = "2026-10-11T10:00:00.000Z";

function step(id: string, key: string | null, overrides: Partial<ChainStep> = {}): ChainStep {
  return {
    id,
    name: key ?? id,
    method: "GET",
    url: "{{baseUrl}}/x",
    query: [],
    headers: [],
    body: { kind: "none" },
    expectedStatuses: ["200"],
    extractors: [],
    checks: [],
    runs: "every-iteration",
    thinkTimeMs: null,
    source: key === null ? { kind: "added" } : { kind: "operation", operationKey: key, label: key, passwordFields: [] },
    seedDigest: key === null ? null : `digest-${key}`,
    changed: false,
    ...overrides,
  };
}

const chain = (id: string, name: string, steps: ChainStep[]): Chain => ({ id, name, steps });

function plan(chains: Chain[], overrides: Partial<ChainPlan> = {}): ChainPlan {
  const number = (prefix: string, ids: string[]) => Math.max(0, ...ids.map((id) => Number(id.slice(prefix.length)))) + 1;
  return {
    id: "plan-1",
    name: "Plan",
    revision: 3,
    chains,
    loadProfile: { kind: "smoke", stages: [{ durationMs: 60_000, targetVirtualUsers: 1 }], plannedDurationMs: 60_000 },
    thinkTimeMs: 1000,
    thresholds: [],
    targetEnvironmentId: null,
    secretNames: [],
    dataSets: [],
    seedingReport: { source: { kind: "specification", filename: "spec.yaml" }, seededAt: "2026-10-01T00:00:00.000Z", items: [] },
    nextChainNumber: number("c", chains.map((c) => c.id)),
    nextStepNumber: number("s", chains.flatMap((c) => c.steps.map((s) => s.id))),
    nextItemNumber: 1,
    fingerprint: "old",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const item = (sourceLabel: string, stepId: string | null, detail = "d"): SeedingReportItem => ({ kind: "no-positive-scenario", sourceLabel, detail, stepId });

/** The same source seeded with the new selection: ids start again at c1 and s1, as a fresh seed does. */
const freshOf = (chains: Chain[], overrides: Partial<ChainPlan> = {}) => plan(chains, { revision: 1, ...overrides });

describe("applyReselect: merge", () => {
  const stored = plan([chain("c1", "GET /a", [step("s1", "GET /a")]), chain("c2", "GET /b", [step("s2", "GET /b")])]);

  it("changes nothing when the selection is the same, apart from the revision", () => {
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")]), chain("c2", "GET /b", [step("s2", "GET /b")])]);
    const result = applyReselect(stored, fresh, "merge", false, NOW);
    expect(result.plan.chains).toEqual(stored.chains);
    expect(result).toMatchObject({ added: [], removed: [], keptEdited: [] });
    expect(result.plan.revision).toBe(stored.revision + 1);
    expect(result.plan.updatedAt).toBe(NOW);
  });

  it("numbers what it adds from the plan's counters, never from the fresh seed's", () => {
    const fresh = freshOf([
      chain("c1", "GET /a", [step("s1", "GET /a")]),
      chain("c2", "GET /b", [step("s2", "GET /b")]),
      chain("c3", "GET /c", [step("s3", "GET /c", { extractors: [{ id: "x1", name: "token", source: { kind: "body", path: "t" } }] })]),
    ]);
    const result = applyReselect(stored, fresh, "merge", false, NOW);
    const added = result.plan.chains[2];
    expect(added.id).toBe("c3");
    expect(added.steps[0].id).toBe("s3");
    expect(added.steps[0].extractors[0].id).toBe("x1");
    expect(result.plan.nextChainNumber).toBe(4);
    expect(result.plan.nextStepNumber).toBe(4);
    expect(result.plan.nextItemNumber).toBe(2);
    expect(added.steps[0].seedDigest).toBe("digest-GET /c");
    expect(added.steps[0].changed).toBe(false);
  });

  it("carries the report items of the added operations with their new step ids, and keeps the earlier ones", () => {
    const earlier = item("GET /old", null, "earlier");
    const base = plan(stored.chains, { seedingReport: { source: { kind: "specification", filename: "spec.yaml" }, seededAt: "t", items: [earlier] } });
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")]), chain("c2", "GET /c", [step("s2", "GET /c")])], {
      seedingReport: { source: { kind: "specification", filename: "spec.yaml" }, seededAt: "t2", items: [item("GET /c", "s2", "about the new step"), item("GET /a", null, "about a kept one"), item("GET /left-out", null, "about nothing selected")] },
    });
    const items = applyReselect(base, fresh, "merge", false, NOW).plan.seedingReport!.items;
    expect(items).toEqual([earlier, { ...item("GET /c", "s3", "about the new step") }]);
  });

  it("keeps an item about a removed step, with no step", () => {
    const base = plan(stored.chains, { seedingReport: { source: { kind: "specification", filename: "spec.yaml" }, seededAt: "t", items: [item("GET /b", "s2", "about b")] } });
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")])]);
    expect(applyReselect(base, fresh, "merge", false, NOW).plan.seedingReport!.items).toEqual([item("GET /b", null, "about b")]);
  });

  it("keeps a chain the engineer made even when it is empty, and a seeded chain that still holds an added step", () => {
    const base = plan([chain("c1", "GET /a", [step("s1", "GET /a"), step("s2", null)]), chain("c2", "Mine", [])]);
    const fresh = freshOf([chain("c1", "GET /z", [step("s1", "GET /z")])]);
    const result = applyReselect(base, fresh, "merge", false, NOW);
    expect(result.plan.chains.map((c) => [c.id, c.name, c.steps.map((s) => s.id)])).toEqual([
      ["c1", "GET /a", ["s2"]],
      ["c2", "Mine", []],
      ["c3", "GET /z", ["s3"]],
    ]);
    expect(result.removed).toEqual(["GET /a"]);
  });

  it("refuses to remove an edited step unless confirmed, naming the step", () => {
    const base = plan([chain("c1", "GET /a", [step("s1", "GET /a", { changed: true, name: "Edited a" })])]);
    const fresh = freshOf([chain("c1", "GET /z", [step("s1", "GET /z")])]);
    expect(() => applyReselect(base, fresh, "merge", false, NOW)).toThrow(EditedStepsWouldBeRemovedError);
    try {
      applyReselect(base, fresh, "merge", false, NOW);
    } catch (error) {
      expect((error as EditedStepsWouldBeRemovedError).edited).toEqual([{ chainId: "c1", stepId: "s1", stepName: "Edited a", operationKey: "GET /a", reasons: ["step-changed"] }]);
    }
    expect(applyReselect(base, fresh, "merge", true, NOW).removed).toEqual(["GET /a"]);
  });

  it("leaves one empty chain when nothing is left, and never reuses an id", () => {
    const fresh = freshOf([]);
    const result = applyReselect(stored, fresh, "merge", false, NOW);
    expect(result.plan.chains).toEqual([{ id: "c3", name: "Chain 3", steps: [] }]);
  });

  it("adds the secret names the added steps need and keeps the ones it had, sorted", () => {
    const base = plan(stored.chains, { secretNames: ["zeta"] });
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")])], { secretNames: ["alpha"] });
    expect(applyReselect(base, fresh, "merge", false, NOW).plan.secretNames).toEqual(["alpha", "zeta"]);
  });
});

describe("applyReselect: reset", () => {
  it("replaces every chain with the fresh ones under new ids, drops step thresholds and keeps run thresholds", () => {
    const stored = plan([chain("c1", "GET /a", [step("s1", "GET /a", { changed: true })]), chain("c2", "Mine", [step("s2", null)])], {
      thresholds: [
        { id: "t1", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 900 },
        { id: "t2", scope: { kind: "step", stepId: "s1" }, metric: "p95", comparator: "<=", limit: 400 },
      ],
    });
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")])]);
    const result = applyReselect(stored, fresh, "reset", false, NOW);
    expect(result.plan.chains.map((c) => [c.id, c.steps.map((s) => [s.id, s.changed])])).toEqual([["c3", [["s3", false]]]]);
    expect(result.plan.thresholds.map((t) => t.id)).toEqual(["t1"]);
    expect(result.plan.seedingReport!.seededAt).toBe(NOW);
    expect(result.keptEdited).toEqual([]);
  });

  it("never asks to confirm, because it discards edits on purpose", () => {
    const stored = plan([chain("c1", "GET /a", [step("s1", "GET /a", { changed: true })])]);
    const fresh = freshOf([chain("c1", "GET /b", [step("s1", "GET /b")])]);
    expect(() => applyReselect(stored, fresh, "reset", false, NOW)).not.toThrow();
  });
});

describe("applyReselect: determinism", () => {
  it("gives equal plans for equal inputs", () => {
    const stored = plan([chain("c1", "GET /a", [step("s1", "GET /a")])]);
    const fresh = freshOf([chain("c1", "GET /a", [step("s1", "GET /a")]), chain("c2", "GET /b", [step("s2", "GET /b")])]);
    expect(applyReselect(stored, fresh, "merge", false, NOW)).toEqual(applyReselect(stored, fresh, "merge", false, NOW));
  });
});
