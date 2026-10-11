import type { ChainPlan, ChainPlanView } from "@apipilot/shared-domain";
import { analyzeChainPlan } from "@apipilot/shared-domain";
import { environment, stubFetch } from "./performanceFixtures";
import { chainPlanFixture, chainStep, PLAN_ID } from "./requestChainFixtures";

/** Shared by the Performance path's tests (AP-047): a seeded plan, the routes every screen reads, and a plan summary. */

export const QUICK = "/api/quick-performance";
export const PLAN = `/api/chain-plans/${PLAN_ID}`;
export const NO_QUICK_TEST = [404, { error: "quick_test_not_found", message: "none" }] as [number, unknown];

const operation = (key: string) => ({ kind: "operation" as const, operationKey: key, label: key, passwordFields: [] });

/** The plan as seeding two operations of the fixture specification produces it: one single-step chain each. */
export function seededPlan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  return chainPlanFixture({
    name: "Quick Performance Fixture",
    seedingReport: { source: { kind: "specification", filename: "quick-performance.yaml" }, seededAt: "2026-10-03T10:00:00.000Z", items: [] },
    chains: [
      { id: "c1", name: "GET /customers", steps: [chainStep({ id: "s1", name: "listCustomers", url: "{{baseUrl}}/customers", source: operation("GET /customers"), seedDigest: "d1" })] },
      { id: "c2", name: "POST /customers", steps: [chainStep({ id: "s2", name: "createCustomer", method: "POST", url: "{{baseUrl}}/customers", source: operation("POST /customers"), seedDigest: "d2" })] },
    ],
    nextChainNumber: 3,
    nextStepNumber: 3,
    ...overrides,
  });
}

/** `seededPlan` with the step of `key` marked as changed, as the editor shows it after an edit. */
export function withChangedStep(plan: ChainPlan, key: string): ChainPlan {
  return { ...plan, chains: plan.chains.map((chain) => ({ ...chain, steps: chain.steps.map((step) => (step.source.kind === "operation" && step.source.operationKey === key ? { ...step, changed: true } : step)) })) };
}

export const viewWithScript = (plan: ChainPlan, environmentNames: string[] | null = null): ChainPlanView => ({
  plan,
  analysis: analyzeChainPlan(plan, { environmentValueNames: environmentNames }),
  script: { planFingerprint: plan.fingerprint, scriptSha256: "abc123", stepCount: 2, outOfDate: false },
});

/** The routes every screen of the path reads, with no runs of any kind and one local environment. */
export function baseRoutes(extra: Parameters<typeof stubFetch>[0] = {}) {
  return {
    ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [environment({ id: "env-1" })] }] as [number, unknown],
    ["GET /api/chain-plans/readiness"]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "t" } }] as [number, unknown],
    [`GET ${PLAN}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    ["GET /api/test-generation-workflow/performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
    ["GET /api/quick-performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
    ["GET /api/collection-performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
    ...extra,
  };
}

export const planSummary = { id: PLAN_ID, name: "Quick Performance Fixture", chainCount: 2, stepCount: 2, dataSetCount: 0, seedSource: "specification", updatedAt: "2026-10-03T10:00:00.000Z" };
