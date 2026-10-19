import { describe, expect, it } from "vitest";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { reviewItems } from "../../../src/securityLab/review/reviewService";
import { flagResolver, listScenarioIds, listScenarios, type ScenarioContext } from "../../../src/securityLab/scenarios/scenarioService";
import { OWNER_A } from "../../fixtures/securityLab/builders";
import { reviewContext, seedScenario } from "../../fixtures/securityLab/seed";

/** specs/057 SC-006 scale: a long-lived owner holds thousands of scenarios, and list and batch review stay responsive. */
const COUNT = 2_000;
const LIST_BUDGET_MS = 300;

function seedMany(): string[] {
  const repo = getSecurityScenarioRepository();
  const ids: string[] = [];
  getSharedConnection().db.transaction(() => {
    for (let index = 0; index < COUNT; index += 1) {
      const id = `ss-${index.toString(16).padStart(16, "0")}`;
      ids.push(id);
      seedScenario(repo, {
        id,
        reviewState: "in_review",
        content: {
          title: `Scenario ${index}`,
          operationKey: `GET /things/${index % 40}`,
          operationPath: `/things/${index % 40}`,
          suggestedSeverity: (["low", "medium", "high"] as const)[index % 3],
        },
      });
    }
  })();
  return ids;
}

function context(): ScenarioContext {
  return {
    ownerId: OWNER_A,
    actor: "tester",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    limits: loadSecurityLabLimits(),
    repo: getSecurityScenarioRepository(),
    hasCredential: () => false,
    configuredSensitiveFields: [],
  };
}

function timed<T>(work: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = work();
  return { result, ms: performance.now() - start };
}

describe(`${COUNT} retained scenarios`, () => {
  it("lists a page, with filters and facet counts, inside the budget", () => {
    seedMany();
    const ctx = context();
    for (const query of [{}, { severity: "high" as const }, { operation: "GET /things/7" }, { q: "Scenario 19" }, { flag: "stale" as const }]) {
      const { result, ms } = timed(() => listScenarios(ctx, { ...query, page: 3, pageSize: 25 }));
      expect(ms, JSON.stringify(query)).toBeLessThan(LIST_BUDGET_MS);
      expect(result.items.length).toBeLessThanOrEqual(25);
    }
    expect(listScenarios(ctx, { pageSize: 25 }).total).toBe(COUNT);
    expect(listScenarios(ctx, { pageSize: 25 }).counts.byReviewState).toEqual({ in_review: COUNT });
  });

  it("derives flags for every scenario on a flag filter without trusting anything stored", () => {
    seedMany();
    const { result, ms } = timed(() => listScenarios(context(), { flag: "specification_not_loaded", pageSize: 100 }));
    // No workflow in this context, so every scenario is flagged, and the total counts all of them.
    expect(result.total).toBe(COUNT);
    expect(ms).toBeLessThan(LIST_BUDGET_MS * 4);
  });

  it("names every id for a batch, and applies a batch of 500 named items with one outcome each", () => {
    seedMany();
    const ctx = context();
    const ids = listScenarioIds(ctx, {});
    expect(ids.total).toBe(COUNT);
    expect(ids.capped).toBe(false);

    const batch = ids.items.slice(0, 500);
    const { result, ms } = timed(() => reviewItems(reviewContext(getSecurityScenarioRepository()), OWNER_A, { action: "approve", items: batch }));
    expect(result).toHaveLength(500);
    expect(result.every((outcome) => outcome.applied)).toBe(true);
    expect(ms).toBeLessThan(5_000);

    const counts = listScenarios(ctx, { pageSize: 1 }).counts.byReviewState;
    expect(counts).toEqual({ approved: 500, in_review: COUNT - 500 });
  });

  it("resolves flags the same way for the list and for a single scenario", () => {
    seedMany();
    const ctx = context();
    const repo = getSecurityScenarioRepository();
    const resolve = flagResolver(ctx);
    const head = repo.getScenario(OWNER_A, "ss-00000000000007cf")!;
    const version = repo.getVersion(OWNER_A, head.id, head.currentVersion)!;
    const listed = listScenarios(ctx, { q: "Scenario 1999", pageSize: 100 }).items.find((item) => item.id === head.id);
    expect(listed?.flags).toEqual(resolve(head, version));
  });
});
