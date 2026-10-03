import type { Chain, ChainPlan, ChainStep, Extractor } from "@apipilot/shared-domain";
import { LOAD_PROFILE_STARTING_STAGES } from "@apipilot/shared-domain";

/**
 * AP-037 (specs/037-request-chain-performance tasks T003): builders for request-chain plans, so tests
 * state only what they exercise. Every builder is deterministic.
 */
export function step(overrides: Partial<ChainStep> & Pick<ChainStep, "id">): ChainStep {
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

export function chain(id: string, name: string, steps: ChainStep[]): Chain {
  return { id, name, steps };
}

export function bodyExtractor(id: string, name: string, path: string): Extractor {
  return { id, name, source: { kind: "body", path } };
}

export function chainPlan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  const stages = LOAD_PROFILE_STARTING_STAGES.smoke.map((stage) => ({ ...stage }));
  return {
    id: "00000000-0000-4000-8000-000000000037",
    name: "Fixture plan",
    revision: 1,
    chains: [chain("c1", "Chain 1", [])],
    loadProfile: { kind: "smoke", stages, plannedDurationMs: stages.reduce((total, stage) => total + stage.durationMs, 0) },
    thinkTimeMs: 1000,
    thresholds: [],
    targetEnvironmentId: null,
    secretNames: [],
    dataSets: [],
    seedingReport: null,
    nextChainNumber: 2,
    nextStepNumber: 1,
    nextItemNumber: 1,
    fingerprint: "",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

const AUTHORIZATION = { name: "Authorization", value: "Bearer {{token}}" };
const JSON_HEADER = "application/json";

/** User Story 1: the seven-step customer journey, built by hand. */
export function customerLifecyclePlan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  const steps: ChainStep[] = [
    step({
      id: "s1",
      name: "Get a token",
      method: "POST",
      url: "{{baseUrl}}/auth/token",
      body: {
        kind: "form",
        fields: [
          { name: "client_id", value: "{{client_id}}" },
          { name: "client_secret", value: "{{client_secret}}" },
        ],
      },
      runs: "once-before-load",
      extractors: [bodyExtractor("x1", "token", "access_token")],
    }),
    step({
      id: "s2",
      name: "Create a customer",
      method: "POST",
      url: "{{baseUrl}}/api/v1/customers",
      headers: [AUTHORIZATION],
      body: { kind: "raw", contentType: JSON_HEADER, text: '{"name":"{{$randomFullName}}","email":"{{$randomEmail}}"}' },
      expectedStatuses: ["201"],
      extractors: [bodyExtractor("x2", "customer_id", "id")],
    }),
    step({
      id: "s3",
      name: "List customers",
      url: "{{baseUrl}}/api/v1/customers",
      query: [
        { name: "page", value: "1" },
        { name: "size", value: "20" },
      ],
      headers: [AUTHORIZATION],
    }),
    step({
      id: "s4",
      name: "Replace the customer",
      method: "PUT",
      url: "{{baseUrl}}/api/v1/customers/{{customer_id}}",
      headers: [AUTHORIZATION],
      body: { kind: "raw", contentType: JSON_HEADER, text: '{"name":"Replaced"}' },
    }),
    step({
      id: "s5",
      name: "Get the customer",
      url: "{{baseUrl}}/api/v1/customers/{{customer_id}}",
      headers: [AUTHORIZATION],
      checks: [{ id: "k3", kind: "field-equals", path: "id", expected: { type: "text", value: "{{customer_id}}" } }],
    }),
    step({
      id: "s6",
      name: "Update the customer",
      method: "PATCH",
      url: "{{baseUrl}}/api/v1/customers/{{customer_id}}",
      headers: [AUTHORIZATION],
      body: { kind: "raw", contentType: JSON_HEADER, text: '{"name":"Updated"}' },
    }),
    step({
      id: "s7",
      name: "Delete the customer",
      method: "DELETE",
      url: "{{baseUrl}}/api/v1/customers/{{customer_id}}",
      headers: [AUTHORIZATION],
      expectedStatuses: ["204"],
    }),
  ];
  return chainPlan({
    name: "Customer lifecycle",
    chains: [chain("c1", "Customer lifecycle", steps)],
    secretNames: ["client_secret"],
    nextChainNumber: 2,
    nextStepNumber: 8,
    nextItemNumber: 4,
    ...overrides,
  });
}

/** User Story 6: the customer journey taking names and emails from a data set, row per iteration. */
export function dataSetPlan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  const plan = customerLifecyclePlan(overrides);
  plan.chains[0].steps[1] = {
    ...plan.chains[0].steps[1],
    headers: [...plan.chains[0].steps[1].headers, { name: "X-Tenant-Id", value: "{{tenant_id}}" }],
    body: { kind: "raw", contentType: "application/json", text: '{"name":"{{first_name}} {{last_name}}","email":"{{email}}"}' },
  };
  return {
    ...plan,
    dataSets: [
      {
        id: "d1",
        name: "customers",
        mode: "row-per-iteration",
        columns: ["tenant_id", "first_name", "last_name", "email", "username", "password"].map((name) => ({ name, secret: name === "password" })),
        rowCount: 50,
        sizeBytes: 3927,
        sha256: "0".repeat(64),
      },
    ],
    ...overrides,
  };
}
