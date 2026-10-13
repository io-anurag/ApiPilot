import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createLogger } from "../logger";
import type { NewmanExecutionResult, NewmanHeaderList } from "./mapNewmanResult";

/**
 * Runs Newman items in a child process under Node's permission model (`--permission`), so that
 * the scripts of an uploaded, unverified collection never execute inside the backend process.
 *
 * What the child is denied (no `--allow-*` grant is given for any of these): writing to the file
 * system, reading anywhere except the installed packages Newman itself needs, spawning processes,
 * creating workers, loading native addons, WASI. The backend's database, its credential key file
 * and the rest of the user's disk are therefore unreachable from the child even if a script were to
 * escape postman-sandbox's own vm context (which is not itself a security boundary).
 *
 * What it does NOT restrict: network access. Node 24's permission model has no network control, and
 * a collection's requests (and `pm.sendRequest`) legitimately need the network, so a script can
 * still reach any host the machine can. Uploaded collections remain a trust-the-collection model;
 * this isolation limits the blast radius of an escape, it does not make a hostile script safe.
 *
 * The collection and the environment go in over IPC and a JSON-safe summary comes back; nothing is
 * shared through the file system. The environment the child starts with is empty apart from proxy
 * settings and (on Windows) the variables the runtime needs, so the backend's own environment
 * (which can hold secrets) is not inherited.
 */

const logger = createLogger("execution.newmanSandbox");

/** Upper bound for one item in the sandbox: a script that never returns must not hang the run. */
const SANDBOX_ITEM_TIMEOUT_MS = 120_000;

/**
 * The JavaScript the child evaluates (`node -e`). Plain CommonJS on purpose: a string needs no
 * build-time copying (tsc does not emit `.cjs` assets) and nothing but Newman has to be readable.
 * The Newman entry path arrives in the environment, never interpolated into this source.
 */
const CHILD_SOURCE = `
const newman = require(process.env.APIPILOT_NEWMAN_ENTRY);
const headersOf = (list) =>
  list && typeof list.all === "function"
    ? list.all().map((h) => ({ key: h.key, value: h.value, disabled: Boolean(h.disabled) }))
    : [];
const plain = (execution) => {
  if (!execution) return null;
  const { request, response, requestError, assertions } = execution;
  return {
    request: request
      ? { url: request.url ? request.url.toString() : undefined, headers: headersOf(request.headers), body: request.body ? request.body.toString() : undefined }
      : undefined,
    response: response
      ? { code: response.code, responseTime: response.responseTime, headers: headersOf(response.headers), text: typeof response.text === "function" ? response.text() : undefined }
      : undefined,
    requestError: requestError ? { code: requestError.code, message: requestError.message } : undefined,
    assertions: (assertions || []).map((a) => ({
      assertion: a.assertion,
      skipped: Boolean(a.skipped),
      error: a.error ? { name: a.error.name, message: a.error.message } : undefined,
    })),
  };
};
process.on("message", ({ id, options }) => {
  const reply = (message) => process.send({ id, ...message });
  try {
    newman.run(options, (err, summary) => {
      if (err) return reply({ type: "error", message: String(err && err.message) });
      reply({
        type: "result",
        execution: plain(summary.run.executions[0]),
        environment: summary.environment.toObject(false, true),
      });
    });
  } catch (err) {
    reply({ type: "error", message: String(err && err.message) });
  }
});
`;

/** The reply's execution, JSON-safe: header lists are arrays and the body is already a string. */
interface SandboxedExecution {
  request?: { url?: string; headers: SandboxedHeader[]; body?: string };
  response?: { code?: number; responseTime?: number; headers: SandboxedHeader[]; text?: string };
  requestError?: { code?: string; message?: string };
  assertions: NewmanExecutionResult["assertions"];
}

interface SandboxedHeader {
  key: string;
  value: string;
  disabled: boolean;
}

type ChildReply = { id: number } & (
  | { type: "result"; execution: SandboxedExecution | null; environment: Record<string, unknown> }
  | { type: "error"; message: string }
);

export interface NewmanSandboxResult {
  execution: NewmanExecutionResult;
  environment: Record<string, unknown>;
}

export class NewmanSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewmanSandboxError";
  }
}

/** Every `node_modules` directory Newman's dependencies can live in (hoisted to the workspace root or nested). */
function readableModuleDirectories(newmanEntry: string): string[] {
  const directories = new Set<string>();
  let current = path.dirname(newmanEntry);
  for (;;) {
    if (path.basename(current) === "node_modules") directories.add(current);
    const candidate = path.join(current, "node_modules");
    if (existsSync(candidate)) directories.add(candidate);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [...directories];
}

/** Resolved lazily: only a run that actually uses the sandbox needs it, and tests can run without it. */
function resolveNewmanEntry(): string {
  return createRequire(import.meta.url).resolve("newman");
}

/**
 * The runtime arguments the child is started with. Exported so a test can prove the restriction at
 * the process level, using exactly these flags, instead of trusting that they are applied.
 */
export function buildSandboxExecArgv(newmanEntry: string = resolveNewmanEntry()): string[] {
  return [
    "--permission",
    ...readableModuleDirectories(newmanEntry).map((directory) => `--allow-fs-read=${directory}`),
    "--disable-warning=DEP0176",
  ];
}

const ENVIRONMENT_PASSTHROUGH = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // The Windows runtime misbehaves (DNS, TLS, crypto) without these.
  "SystemRoot",
  "windir",
];

/** The backend's own environment (API keys, DB path) is deliberately not inherited. */
export function buildSandboxEnvironment(
  source: NodeJS.ProcessEnv,
  newmanEntry: string,
): Record<string, string> {
  const environment: Record<string, string> = { APIPILOT_NEWMAN_ENTRY: newmanEntry };
  for (const key of ENVIRONMENT_PASSTHROUGH) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function asHeaderList(headers: SandboxedHeader[]): NewmanHeaderList {
  return { all: () => headers };
}

function toExecutionResult(execution: SandboxedExecution | null): NewmanExecutionResult {
  if (!execution) return {};
  const { request, response, requestError, assertions } = execution;
  return {
    ...(request
      ? {
          request: {
            ...(request.url !== undefined ? { url: { toString: () => request.url as string } } : {}),
            headers: asHeaderList(request.headers),
            ...(request.body !== undefined ? { body: { toString: () => request.body as string } } : {}),
          },
        }
      : {}),
    ...(response
      ? {
          response: {
            code: response.code,
            responseTime: response.responseTime,
            headers: asHeaderList(response.headers),
            text: () => response.text ?? "",
          },
        }
      : {}),
    ...(requestError ? { requestError } : {}),
    assertions,
  };
}

interface PendingRun {
  resolve: (result: NewmanSandboxResult) => void;
  reject: (error: NewmanSandboxError) => void;
  timer: NodeJS.Timeout;
}

/**
 * One permission-restricted child process that runs Newman items one after another. Starting a
 * Newman process costs about a second and a half, so a run of an uploaded collection shares one
 * child across its items (`close()` ends it) instead of paying that per request. The child is
 * started on first use, and again on the next use if it died (a script that crashed or hung it).
 */
export class NewmanSandbox {
  private child: ChildProcess | undefined;
  private readonly pending = new Map<number, PendingRun>();
  private nextId = 1;

  /** Runs `newman.run(options)` in the child and resolves to its summarized outcome. */
  run(options: Record<string, unknown>): Promise<NewmanSandboxResult> {
    return new Promise((resolve, reject) => {
      const child = this.ensureChild();
      const id = this.nextId++;
      const timer = setTimeout(() => {
        logger.error("newman_sandbox_timeout", { timeoutMs: SANDBOX_ITEM_TIMEOUT_MS });
        // A script that never returns: the whole child goes, not just this item.
        this.discardChild("The sandboxed request did not finish in time.");
      }, SANDBOX_ITEM_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, options }, (error) => {
        if (error) {
          this.settle(id, (run) => run.reject(new NewmanSandboxError("The sandboxed request process could not be reached.")));
        }
      });
    });
  }

  close(): void {
    this.discardChild("The sandbox was closed.");
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child;
    const newmanEntry = resolveNewmanEntry();
    const child = spawn(process.execPath, [...buildSandboxExecArgv(newmanEntry), "-e", CHILD_SOURCE], {
      env: buildSandboxEnvironment(process.env, newmanEntry),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    child.on("message", (reply: ChildReply) => {
      this.settle(reply.id, (run) => {
        if (reply.type === "error") run.reject(new NewmanSandboxError(reply.message));
        else run.resolve({ execution: toExecutionResult(reply.execution), environment: reply.environment });
      });
    });
    child.once("error", (error) => {
      logger.error("newman_sandbox_spawn_failed", { errorCategory: error.name });
      if (this.child === child) this.discardChild("The sandboxed request process could not be started.");
    });
    // `disconnect` (not `exit`) is the failure signal: it fires only after every message already
    // sent has been delivered, so a reply followed immediately by the child's end is not lost.
    child.once("disconnect", () => {
      if (this.child !== child) return;
      logger.error("newman_sandbox_disconnected", {});
      this.discardChild("The sandboxed request process ended unexpectedly.");
    });
    this.child = child;
    return child;
  }

  private settle(id: number, action: (run: PendingRun) => void): void {
    const run = this.pending.get(id);
    if (!run) return;
    this.pending.delete(id);
    clearTimeout(run.timer);
    action(run);
  }

  /** Kills the child and fails everything still waiting on it. */
  private discardChild(reason: string): void {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const id of [...this.pending.keys()]) {
      this.settle(id, (run) => run.reject(new NewmanSandboxError(reason)));
    }
  }
}
