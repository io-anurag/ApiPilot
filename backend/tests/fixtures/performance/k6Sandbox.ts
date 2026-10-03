import vm from "node:vm";

/**
 * Runs a generated k6 script in a Node `vm` context with k6's modules stubbed (tasks T030), so
 * tests exercise the script's own runtime (auth, extraction, missing data, cut-short journeys,
 * per-virtual-user refresh, unique values) without k6. Only the module syntax is adapted:
 * `import` lines are dropped and `export` keywords removed; the script's code is otherwise run
 * exactly as generated.
 *
 * AP-037 (specs/037-request-chain-performance tasks T005): `k6/execution` is stubbed as `exec`
 * (`vu.idInTest` is the sandbox's virtual user; `scenario.iterationInTest` comes from a counter that
 * sandboxes of several virtual users may share; `test.abort` records its reason and throws
 * `SandboxAbort`), `k6/data`'s `SharedArray` calls its factory once, and `open(path)` reads only from
 * the `files` option, failing the test for any other path. In k6 each virtual user has its own
 * runtime, so a test of several virtual users loads one sandbox per virtual user.
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
  /** AP-035: response headers, keyed as k6 reports them (canonical case). */
  headers?: Record<string, string>;
  /** AP-037: `response.timings.duration`, for response-time checks. */
  durationMs?: number;
}

/** AP-037: thrown by the stubbed `exec.test.abort`, as k6 stops the test there. */
export class SandboxAbort extends Error {
  constructor(readonly reason: string) {
    super(`k6 test aborted: ${reason}`);
  }
}

/** AP-037: the test-wide iteration counter `exec.scenario.iterationInTest` reads. */
export interface IterationCounter {
  next: number;
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
  /** AP-037: reasons passed to `exec.test.abort`, in order. */
  aborts: string[];
  /** AP-037: paths the script passed to `open()`. */
  opened: string[];
  setup(): unknown;
  iterate(data: unknown, iteration?: number): void;
  setVu(vu: number): void;
}

export function loadScript(
  script: string,
  options: {
    env: Record<string, string>;
    respond: (request: SandboxRequest) => SandboxResponse;
    vu?: number;
    /** AP-037: the files `open()` may read, by path. */
    files?: Record<string, string>;
    /** AP-037: share one counter between the sandboxes of several virtual users. */
    iterations?: IterationCounter;
  },
): K6Sandbox {
  const requests: SandboxRequest[] = [];
  const metrics: SandboxMetric[] = [];
  const checks: SandboxCheck[] = [];
  const sleeps: number[] = [];
  const clock = { now: Date.parse("2026-09-27T12:00:00.000Z") };
  const aborts: string[] = [];
  const opened: string[] = [];
  const iterations = options.iterations ?? { next: 0 };
  let iterationInTest = 0;

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
        headers: { ...(response.headers ?? {}) },
        timings: { duration: response.durationMs ?? 0 },
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
    exec: {
      vu: {
        get idInTest() {
          return sandbox.__VU;
        },
      },
      scenario: {
        get iterationInTest() {
          return iterationInTest;
        },
      },
      test: {
        abort(reason: string) {
          aborts.push(reason);
          throw new SandboxAbort(reason);
        },
      },
    },
    SharedArray: class SharedArray {
      constructor(_name: string, factory: () => unknown[]) {
        return factory();
      }
    },
    open(path: string) {
      opened.push(path);
      const content = options.files?.[path];
      if (content === undefined) throw new Error(`The script opened a file it may not read: ${path}`);
      return content;
    },
    __ENV: { ...options.env },
    __VU: options.vu ?? 1,
    __ITER: 0,
    // AP-036: `$isoTimestamp` constructs a date from the run's clock; `Date.now()` is the sandbox clock.
    Date: class SandboxDate extends Date {
      static now(): number {
        return clock.now;
      }
    },
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
    aborts,
    opened,
    setup: () => (sandbox.setup as () => unknown)(),
    iterate(data, iteration = 0) {
      sandbox.__ITER = iteration;
      iterationInTest = iterations.next;
      iterations.next += 1;
      // AP-036: k6 passes setup data to virtual users with `undefined` written as `null`.
      (sandbox.__default as (d: unknown) => void)(JSON.parse(JSON.stringify(data, (_key, value: unknown) => (value === undefined ? null : value))));
    },
    setVu(vu) {
      sandbox.__VU = vu;
    },
  };
}
