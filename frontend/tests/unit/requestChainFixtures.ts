import { analyzeChainPlan, type ChainPlan, type ChainPlanView, type ChainStep } from "@apipilot/shared-domain";

/** AP-037 (specs/037-request-chain-performance): request-chain plans shaped like the backend's. */

export const PLAN_ID = "11111111-1111-4111-8111-111111111111";

export function chainStep(overrides: Partial<ChainStep> & Pick<ChainStep, "id">): ChainStep {
  return {
    name: `Step ${overrides.id}`,
    method: "GET",
    url: "{{baseUrl}}/health",
    query: [],
    headers: [],
    body: { kind: "none" },
    expectedStatuses: ["200"],
    extractors: [],
    checks: [],
    runs: "every-iteration",
    thinkTimeMs: null,
    source: { kind: "added" },
    seedDigest: null,
    changed: false,
    ...overrides,
  };
}

export function chainPlanFixture(overrides: Partial<ChainPlan> = {}): ChainPlan {
  return {
    id: PLAN_ID,
    name: "Customer lifecycle",
    revision: 1,
    chains: [{ id: "c1", name: "Chain 1", steps: [] }],
    loadProfile: { kind: "smoke", stages: [{ durationMs: 60_000, targetVirtualUsers: 1 }], plannedDurationMs: 60_000 },
    thinkTimeMs: 1000,
    thresholds: [],
    targetEnvironmentId: null,
    secretNames: [],
    dataSets: [],
    seedingReport: null,
    nextChainNumber: 2,
    nextStepNumber: 1,
    nextItemNumber: 1,
    fingerprint: "fp-chain-1",
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
    ...overrides,
  };
}

/** The customer journey's first steps, enough for editor tests. */
export function lifecyclePlan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  return chainPlanFixture({
    chains: [
      {
        id: "c1",
        name: "Customer lifecycle",
        steps: [
          chainStep({
            id: "s1",
            name: "Get a token",
            method: "POST",
            url: "{{baseUrl}}/auth/token",
            body: { kind: "form", fields: [{ name: "client_id", value: "{{client_id}}" }] },
            runs: "once-before-load",
            extractors: [{ id: "x1", name: "token", source: { kind: "body", path: "access_token" } }],
          }),
          chainStep({
            id: "s2",
            name: "Create a customer",
            method: "POST",
            url: "{{baseUrl}}/api/v1/customers",
            headers: [{ name: "Authorization", value: "Bearer {{token}}" }],
            body: { kind: "raw", contentType: "application/json", text: '{"name":"Ada"}' },
            expectedStatuses: ["201"],
            extractors: [{ id: "x2", name: "customer_id", source: { kind: "body", path: "id" } }],
          }),
          chainStep({ id: "s3", name: "Get the customer", url: "{{baseUrl}}/api/v1/customers/{{customer_id}}", headers: [{ name: "Authorization", value: "Bearer {{token}}" }] }),
        ],
      },
    ],
    nextStepNumber: 4,
    nextItemNumber: 3,
    ...overrides,
  });
}

export function viewOf(plan: ChainPlan, environmentValueNames: string[] | null = null): ChainPlanView {
  return { plan, analysis: analyzeChainPlan(plan, { environmentValueNames }), script: null };
}
