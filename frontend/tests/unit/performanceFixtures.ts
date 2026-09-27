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
    scope: "all",
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
