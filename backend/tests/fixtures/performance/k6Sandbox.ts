import vm from "node:vm";

/**
 * Runs a generated k6 script in a Node `vm` context with k6's modules stubbed (tasks T030), so
 * tests exercise the script's own runtime (auth, extraction, missing data, cut-short journeys,
 * per-virtual-user refresh, unique values) without k6. Only the module syntax is adapted:
 * `import` lines are dropped and `export` keywords removed; the script's code is otherwise run
 * exactly as generated.
 */
export interface SandboxRequest {
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
  tags: Record<string, string>;
  responseType: string;
}

export interface SandboxResponse {
  status: number;
  body?: unknown;
}

export interface SandboxMetric {
  name: string;
  value: number;
  tags: Record<string, string>;
}

export interface SandboxCheck {
  name: string;
  passed: boolean;
  tags: Record<string, string>;
}

export interface K6Sandbox {
  requests: SandboxRequest[];
  metrics: SandboxMetric[];
  checks: SandboxCheck[];
  sleeps: number[];
  clock: { now: number };
  setup(): unknown;
  iterate(data: unknown, iteration?: number): void;
  setVu(vu: number): void;
}

export function loadScript(
  script: string,
  options: { env: Record<string, string>; respond: (request: SandboxRequest) => SandboxResponse; vu?: number },
): K6Sandbox {
  const requests: SandboxRequest[] = [];
  const metrics: SandboxMetric[] = [];
  const checks: SandboxCheck[] = [];
  const sleeps: number[] = [];
  const clock = { now: Date.parse("2026-09-27T12:00:00.000Z") };

  class Counter {
    constructor(private readonly name: string) {}
    add(value: number, tags: Record<string, string> = {}) {
      metrics.push({ name: this.name, value, tags });
    }
  }

  const http = {
    request(method: string, url: string, body: string | null, params: { headers: Record<string, string>; tags: Record<string, string>; responseType: string }) {
      const request: SandboxRequest = { method, url, body, headers: params.headers, tags: params.tags, responseType: params.responseType };
      requests.push(request);
      const response = options.respond(request);
      const text = response.body === undefined ? "" : typeof response.body === "string" ? response.body : JSON.stringify(response.body);
      return {
        status: response.status,
        body: text,
        json() {
          return JSON.parse(text);
        },
      };
    },
  };

  const sandbox: Record<string, unknown> = {
    http,
    check(response: unknown, sets: Record<string, (r: unknown) => boolean>, tags: Record<string, string>) {
      let all = true;
      for (const [name, fn] of Object.entries(sets)) {
        const passed = Boolean(fn(response));
        checks.push({ name, passed, tags });
        all = all && passed;
      }
      return all;
    },
    sleep(seconds: number) {
      sleeps.push(seconds);
      clock.now += seconds * 1000;
    },
    Counter,
    encoding: { b64encode: (text: string) => Buffer.from(text, "utf-8").toString("base64") },
    __ENV: { ...options.env },
    __VU: options.vu ?? 1,
    __ITER: 0,
    Date: { now: () => clock.now },
  };
  vm.createContext(sandbox);
  const code = script
    .replace(/^import .*$/gm, "")
    .replace(/^export default function/m, "function __default")
    .replace(/^export (const|function) /gm, "$1 ");
  vm.runInContext(code, sandbox);

  return {
    requests,
    metrics,
    checks,
    sleeps,
    clock,
    setup: () => (sandbox.setup as () => unknown)(),
    iterate(data, iteration = 0) {
      sandbox.__ITER = iteration;
      (sandbox.__default as (d: unknown) => void)(JSON.parse(JSON.stringify(data)));
    },
    setVu(vu) {
      sandbox.__VU = vu;
    },
  };
}
