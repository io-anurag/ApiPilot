import { vi } from "vitest";
import type { Environment, PerformancePlan, PerformanceRun, PerformanceStep, ScriptStatus } from "@apipilot/shared-domain";

/** Shared AP-029 frontend fixtures: a plan shaped like the backend's for performance.yaml, and a fetch router. */

export const SECRET = "SEEDED-SECRET-CLIENT-9f1c";

function step(overrides: Partial<PerformanceStep>): PerformanceStep {
  return {
    id: "s",
    operationKey: "GET /x",
    method: "GET",
    path: "/x",
    scenarioId: "sc",
    scenarioDescription: "A scenario",
    scenarioChoice: "only-positive",
    tieBrokenByLowestId: false,
    consumes: [],
    produces: [],
    variableBindings: [],
    dependency: null,
    expectedStatuses: [{ code: "200", source: "specification" }],
    auth: { kind: "oauth2-client-credentials", schemeName: "OrdersAuth" },
    requiredValues: ["baseUrl", "clientId", "clientSecret"],
    ...overrides,
  };
}

export function planFixture(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  const create = step({
    id: "s-create",
    operationKey: "POST /orders",
    method: "POST",
    path: "/orders",
    scenarioDescription: "Create order",
    scenarioChoice: "rule-generated",
    produces: ["orderId"],
    variableBindings: [{ variable: "orderId", role: "produces", field: "orderId" }],
    dependency: { relationshipIds: ["r1"], confidence: "CONFIRMED" },
    expectedStatuses: [{ code: "201", source: "specification" }],
  });
  const read = step({
    id: "s-read",
    operationKey: "GET /orders/{orderId}",
    path: "/orders/{orderId}",
    scenarioDescription: "Get order",
    consumes: ["orderId"],
    variableBindings: [{ variable: "orderId", role: "consumes", field: "orderId", location: "path", producerStepId: "s-create" }],
    dependency: { relationshipIds: ["r1"], confidence: "CONFIRMED" },
  });
  const status = step({ id: "s-status", operationKey: "GET /status", path: "/status", scenarioDescription: "Service status", expectedStatuses: [] });
  const warehouse = step({
    id: "s-warehouse",
    operationKey: "GET /warehouses/{warehouseId}",
    path: "/warehouses/{warehouseId}",
    scenarioDescription: "Get warehouse",
    requiredValues: ["baseUrl", "clientId", "clientSecret", "warehouseId"],
  });
  return {
    source: "guided",
    excludedOperationKeys: [],
    omitted: [],
    journeys: [
      { id: "j1", source: { kind: "workflow", workflowId: "wf" }, steps: [create, read] },
      { id: "j2", source: { kind: "operation" }, steps: [status] },
      { id: "j3", source: { kind: "operation" }, steps: [warehouse] },
    ],
    thinkTimeMs: 0,
    loadProfile: { kind: "smoke", stages: [{ durationMs: 60_000, targetVirtualUsers: 1 }], plannedDurationMs: 60_000 },
    thresholds: [],
    userSuppliedValues: [
      { name: "baseUrl", secret: false, neededBySteps: ["s-create", "s-read", "s-status", "s-warehouse"], source: "base-url" },
      { name: "clientId", secret: true, neededBySteps: ["s-create"], source: "oauth2-client" },
      { name: "clientSecret", secret: true, neededBySteps: ["s-create"], source: "oauth2-client" },
      { name: "warehouseId", secret: false, neededBySteps: ["s-warehouse"], source: "path-parameter" },
    ],
    uniqueValueFields: [],
    fingerprint: "fp-1",
    upstreamFingerprint: "up-1",
    stepsNeedingExpectedStatus: ["s-status"],
    credentialProducerOperationKeys: [],
    bodyEdits: [],
    bodyEditNotices: [],
    discardedBodyEdits: [],
    parameterEdits: [],
    discardedParameterEdits: [],
    ...overrides,
  };
}

export const readyPlan = (): PerformancePlan =>
  planFixture({
    stepsNeedingExpectedStatus: [],
    journeys: planFixture().journeys.map((journey) => ({
      ...journey,
      steps: journey.steps.map((s) => (s.id === "s-status" ? { ...s, expectedStatuses: [{ code: "200", source: "user" as const }] } : s)),
    })),
  });

export const script = (overrides: Partial<ScriptStatus> = {}): ScriptStatus => ({ planFingerprint: "fp-1", scriptSha256: "abcdef0123456789", stepCount: 4, outOfDate: false, ...overrides });

export const environment = (overrides: Partial<Environment> = {}): Environment => ({
  id: "env-1",
  name: "perf-local",
  tier: "local",
  baseUrl: "http://127.0.0.1:4600",
  variableValues: {},
  requestDelayMs: 0,
  ...overrides,
});

export function runFixture(overrides: Partial<PerformanceRun> = {}): PerformanceRun {
  return {
    id: "run-12345678",
    status: "in-progress",
    environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    planSnapshot: readyPlan(),
    planSource: "guided",
    scriptSha256: "abcdef0123456789",
    k6Version: "1.2.0",
    plannedDurationMs: 60_000,
    startedAt: "2026-09-27T12:00:00.000Z",
    cancelRequested: false,
    ...overrides,
  };
}

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Routes stubbed fetch calls by `METHOD path` (without query) to handlers returning `[status, body]`. */
export function stubFetch(routes: Record<string, (call: Call) => [number, unknown] | Promise<[number, unknown]>>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const call = { method, url, body };
      calls.push(call);
      const key = `${method} ${url.split("?")[0]}`;
      const handler = routes[key];
      const [status, payload] = handler ? await handler(call) : [404, { error: "not_found", message: `No stub for ${key}` }];
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(payload),
        text: () => Promise.resolve(typeof payload === "string" ? payload : JSON.stringify(payload)),
      } as Response;
    }),
  );
  return calls;
}

/**
 * AP-032: a quick plan (specs/032-quick-performance-test), single-step journeys only, shaped like
 * the backend's for quick-performance.yaml, with the login removed as a credential producer.
 */
export function quickStep(method: string, path: string, overrides: Partial<PerformanceStep> = {}): PerformanceStep {
  const id = `s-${method.toLowerCase()}-${path.replace(/[^a-z0-9]+/gi, "-")}`;
  return step({
    id,
    operationKey: `${method} ${path}`,
    method,
    path,
    scenarioDescription: `${method} ${path} happy path`,
    scenarioChoice: "rule-generated",
    auth: { kind: "chained-login", schemeName: "LoginAuth" },
    requiredValues: ["baseUrl", "username", "password"],
    ...overrides,
  });
}

export function quickPlan(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  const steps = [
    quickStep("GET", "/orders"),
    quickStep("POST", "/orders", { expectedStatuses: [{ code: "201", source: "specification" }] }),
    quickStep("PUT", "/orders/{orderId}"),
    quickStep("PATCH", "/orders/{orderId}"),
    quickStep("DELETE", "/orders/{orderId}"),
    quickStep("DELETE", "/products/{productId}"),
    quickStep("GET", "/status", { expectedStatuses: [] }),
  ];
  return planFixture({
    source: "quick",
    excludedOperationKeys: ["POST /auth/login"],
    credentialProducerOperationKeys: ["POST /auth/login"],
    journeys: steps.map((entry) => ({ id: `j-${entry.id}`, source: { kind: "operation" as const }, steps: [entry] })),
    userSuppliedValues: [
      { name: "baseUrl", secret: false, neededBySteps: steps.map((entry) => entry.id), source: "base-url" },
      { name: "password", secret: true, neededBySteps: steps.map((entry) => entry.id), source: "credential" },
    ],
    stepsNeedingExpectedStatus: [steps[6].id],
    ...overrides,
  });
}

export function quickTestView(plan = quickPlan(), scriptStatus: ScriptStatus | null = null) {
  return {
    specification: { filename: "quick-performance.yaml", info: { title: "Quick Performance Fixture", version: "1.0" }, operationCount: 13 },
    plan,
    script: scriptStatus,
  };
}

/**
 * AP-036: a plan built from a collection: a token request run once before the load, a create that
 * captures `customer_id`, and a read that uses it. Not reviewed yet; one finding and one left out.
 */
export function collectionPlanFixture(overrides: Partial<NonNullable<PerformancePlan["collection"]>> = {}, plan: Partial<PerformancePlan> = {}): PerformancePlan {
  const create = step({
    id: "s-create",
    operationKey: "POST /api/v1/customers",
    method: "POST",
    path: "/api/v1/customers",
    scenarioDescription: "Create customer",
    scenarioChoice: "collection-request",
    expectedStatuses: [{ code: "201", source: "collection" }],
    auth: { kind: "chained-login", schemeName: "s-token" },
    collectionRequest: { itemId: "req-create", name: "Create customer", folderPath: ["Customers"] },
    captures: [
      {
        name: "customer_id",
        source: { kind: "body", path: "id", segments: [{ field: "id" }] },
        documented: null,
        origin: { kind: "collection-script", scope: "collectionVariables", owner: { kind: "request", itemId: "req-create" }, line: 2 },
      },
    ],
  });
  const read = step({
    id: "s-read",
    operationKey: "GET /api/v1/customers/{{customer_id}}",
    path: "/api/v1/customers/{{customer_id}}",
    scenarioDescription: "Get customer",
    scenarioChoice: "collection-request",
    expectedStatuses: [{ code: "200", source: "collection" }],
    auth: { kind: "chained-login", schemeName: "s-token" },
    collectionRequest: { itemId: "req-read", name: "Get customer", folderPath: ["Customers"] },
    bindings: [{ target: { kind: "reference", name: "customer_id", locations: ["url"] }, captureStepId: "s-create", captureName: "customer_id", state: "active" }],
  });
  return planFixture({
    source: "collection",
    journeys: [{ id: "j-collection", source: { kind: "collection", collectionId: "c-1", collectionName: "APIFoundry" }, steps: [create, read] }],
    stepsNeedingExpectedStatus: [],
    userSuppliedValues: [
      { name: "baseUrl", secret: false, neededBySteps: ["s-token", "s-create", "s-read"], source: "base-url" },
      { name: "client_secret", secret: false, neededBySteps: ["s-token"], source: "collection-variable" },
    ],
    collection: {
      collectionId: "c-1",
      collectionName: "APIFoundry",
      collectionTier: "local",
      collectionDigest: "d".repeat(64),
      collectionState: "current",
      orderedRequestIds: ["req-token", "req-create", "req-read", "req-upload"],
      excludedRequestIds: [],
      excludedRequests: [],
      leftOut: [{ itemId: "req-upload", name: "Upload", folderPath: [], method: "POST", path: "/upload", reason: "unsupported-body", detail: "formdata" }],
      credentialRequests: [
        {
          stepId: "s-token",
          request: { itemId: "req-token", name: "Get token", folderPath: ["Auth"], method: "POST", path: "/auth/token" },
          expectedStatuses: [{ code: "200", source: "collection" }],
          captures: [
            {
              name: "access_token",
              source: { kind: "body", path: "access_token", segments: [{ field: "access_token" }] },
              documented: null,
              origin: { kind: "collection-script", scope: "environment", owner: { kind: "request", itemId: "req-token" }, line: 1 },
            },
          ],
          usedBy: [{ captureName: "access_token", stepIds: ["s-create", "s-read"] }],
          requiredValues: ["baseUrl", "client_secret"],
        },
      ],
      findings: [
        { kind: "send-request", owner: { kind: "collection" }, event: "test", stepIds: ["s-create", "s-read"], line: 3, column: null, excerpt: 'pm.sendRequest("x", () => {});', detail: null },
        { kind: "prerequest-not-converted", owner: { kind: "folder", folderId: "f-1", folderName: "Customers" }, event: "prerequest", stepIds: ["s-create", "s-read"], line: null, column: null, excerpt: null, detail: null },
        { kind: "scope-precedence", owner: { kind: "request", itemId: "req-create" }, event: "test", stepIds: ["s-create"], line: 2, column: null, excerpt: null, detail: "customer_id" },
      ],
      baseUrlVariable: "baseUrl",
      hosts: [],
      generatedValueCount: 0,
      addedBindings: [],
      review: { reviewed: false, conversionDigest: "c".repeat(64) },
      ...overrides,
    },
    ...plan,
  });
}
