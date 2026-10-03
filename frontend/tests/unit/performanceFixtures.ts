import { vi } from "vitest";
import type { Environment, PerformanceStep } from "@apipilot/shared-domain";

/** Shared performance frontend fixtures: a legacy plan step, an environment, the quick test view, and a fetch router. */

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

export const environment = (overrides: Partial<Environment> = {}): Environment => ({
  id: "env-1",
  name: "perf-local",
  tier: "local",
  baseUrl: "http://127.0.0.1:4600",
  variableValues: {},
  requestDelayMs: 0,
  ...overrides,
});

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

/** AP-032: a quick plan's step (specs/032-quick-performance-test), as stored in a legacy run's snapshot. */
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

/** AP-032 since AP-037 phase two: the quick test is its uploaded specification, a seeding source. */
export function quickTestView() {
  return { specification: { filename: "quick-performance.yaml", info: { title: "Quick Performance Fixture", version: "1.0" }, operationCount: 13 } };
}
