import { execFile as nodeExecFile, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { LineSplitter } from "./metricsStream";
import type { PerformanceRunner, RunnerExit, RunnerHandle, RunnerStartInput, SpawnErrorKind } from "./runnerTypes";

/**
 * Runs the unmodified generated script with the user's k6 (FR-026, FR-027, FR-033; research D7,
 * D8, D10, D19). No shell, no value in argv, a minimal child environment, `--no-usage-report` so
 * nothing is sent to k6's vendor, and local JSON output only. Cancelling is graceful first
 * (SIGINT) and forced after 5 s; on Windows the child tree is ended with `taskkill /T /F`.
 */

/** Pinned by a unit test: any change here is a reviewed change to what ApiPilot executes. */
export function buildK6Args(runDir: string): string[] {
  return [
    "run",
    "--no-usage-report",
    "--quiet",
    "--no-color",
    "--out",
    `json=${path.join(runDir, "metrics.ndjson")}`,
    path.join(runDir, "script.js"),
  ];
}

const WINDOWS_INHERITED = ["SystemRoot", "TEMP", "TMP"];
const POSIX_INHERITED = ["HOME", "TMPDIR"];

/** What k6 needs to start, and nothing else of the backend's environment. Shared by both builders below. */
function startupEnv(processEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
  const env: Record<string, string> = {};
  const pathKey = Object.keys(processEnv).find((key) => key.toUpperCase() === "PATH");
  if (pathKey && processEnv[pathKey] !== undefined) env[pathKey] = processEnv[pathKey]!;
  for (const key of platform === "win32" ? WINDOWS_INHERITED : POSIX_INHERITED) {
    if (processEnv[key] !== undefined) env[key] = processEnv[key]!;
  }
  return env;
}

/**
 * Only what k6 needs to start, plus the run's values (D7). The backend's own environment,
 * including `.env` values, is not passed on.
 */
export function buildChildEnv(
  processEnv: NodeJS.ProcessEnv,
  values: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env = startupEnv(processEnv, platform);
  for (const [key, value] of Object.entries(values)) {
    if (/^APIPILOT_V_\d+$/.test(key)) env[key] = value;
  }
  return env;
}

/**
 * The system tags a user script's metrics keep (specs/034-run-user-k6-script research R10). On the
 * command line they override a script's own `systemTags`, so the report always has `name`, `url`,
 * `method`, `status`, `group` and `check`. The raw `url` and `name` stay in the run's local metrics
 * file and in memory; the report shows them only through the display-name rule (R14).
 */
export const USER_SCRIPT_SYSTEM_TAGS = [
  "proto",
  "subproto",
  "status",
  "method",
  "url",
  "name",
  "group",
  "check",
  "error",
  "error_code",
  "tls_version",
  "scenario",
  "service",
  "expected_response",
  // k6 replaces a named request's `url` tag with its name, so its host is known only by the
  // address it connected to (research R14, checked against k6 2.3.0 on 2026-10-01).
  "ip",
] as const;

/** A load profile's stages, when the engineer chose one; absent for the script's own load (FR-027). */
export interface UserScriptStage {
  durationMs: number;
  targetVirtualUsers: number;
}

/**
 * Pinned by a unit test: any change here is a reviewed change to what ApiPilot executes for a
 * user-supplied script (constitution XVII, 2026-09-30; research R10). No remote output, no usage
 * report, no summary file option: `handleSummary` is refused by the script check instead, which
 * holds for every k6 version. Stages are passed only as `--stage` options; the script is never
 * rewritten.
 */
export function buildUserScriptK6Args(runDir: string, stages: readonly UserScriptStage[] | null): string[] {
  const args = [
    "run",
    "--no-usage-report",
    "--quiet",
    "--no-color",
    "--log-format",
    "json",
    "--system-tags",
    USER_SCRIPT_SYSTEM_TAGS.join(","),
    "--out",
    `json=${path.join(runDir, "metrics.ndjson")}`,
  ];
  for (const stage of stages ?? []) {
    args.push("--stage", `${Math.round(stage.durationMs / 1000)}s:${stage.targetVirtualUsers}`);
  }
  args.push(path.join(runDir, "script.js"));
  return args;
}

/**
 * The start-up allow-list plus each mapped name with its value (research R11). Mapped names are
 * validated before they get here (`validateMappingName`), so none is `K6_…` or a start-up name; the
 * filter below repeats that rule so this function is safe on its own. Values never reach argv.
 */
export function buildUserScriptChildEnv(
  processEnv: NodeJS.ProcessEnv,
  mapped: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env = startupEnv(processEnv, platform);
  const reserved = new Set(["PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "TMPDIR"]);
  for (const [key, value] of Object.entries(mapped)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^k6_/i.test(key) || reserved.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  return env;
}

export interface K6RunnerDependencies {
  spawn: typeof nodeSpawn;
  execFile: typeof nodeExecFile;
  platform: NodeJS.Platform;
  pollIntervalMs: number;
  forceKillAfterMs: number;
  readChunk: (filePath: string, offset: number) => { text: string; bytes: number };
}

function readChunk(filePath: string, offset: number): { text: string; bytes: number } {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return { text: "", bytes: 0 };
  }
  try {
    const buffer = Buffer.alloc(256 * 1024);
    let text = "";
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, offset + total);
      if (read <= 0) break;
      total += read;
      text += buffer.subarray(0, read).toString("utf-8");
      if (read < buffer.length) break;
    }
    return { text, bytes: total };
  } finally {
    closeSync(fd);
  }
}

function spawnErrorKind(error: NodeJS.ErrnoException): SpawnErrorKind {
  return error.code === "ENOENT" ? "not-found" : "not-executable";
}

export function createK6Runner(dependencies: Partial<K6RunnerDependencies> = {}): PerformanceRunner {
  const deps: K6RunnerDependencies = {
    spawn: nodeSpawn,
    execFile: nodeExecFile,
    platform: process.platform,
    pollIntervalMs: 500,
    forceKillAfterMs: 5_000,
    readChunk,
    ...dependencies,
  };
  return {
    start(input: RunnerStartInput): RunnerHandle {
      let child: ChildProcess;
      let offset = 0;
      let settled = false;
      let cancelRequested = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const splitter = new LineSplitter();
      let resolveDone!: (exit: RunnerExit) => void;
      const done = new Promise<RunnerExit>((resolve) => {
        resolveDone = resolve;
      });

      const drain = () => {
        const chunk = deps.readChunk(input.metricsPath, offset);
        offset += chunk.bytes;
        for (const line of splitter.push(chunk.text)) input.onLine(line);
      };
      const settle = (exit: RunnerExit) => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        if (forceTimer) clearTimeout(forceTimer);
        if (!exit.spawnError) {
          drain();
          for (const line of splitter.flush()) input.onLine(line);
        }
        resolveDone(exit);
      };

      const poller = setInterval(drain, deps.pollIntervalMs);
      try {
        child = deps.spawn(input.binaryPath, input.args ?? buildK6Args(input.runDir), {
          shell: false,
          cwd: input.runDir,
          env: input.env,
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (error) {
        settle({ exitCode: null, cancelled: false, spawnError: spawnErrorKind(error as NodeJS.ErrnoException) });
        return { cancel: () => undefined, done };
      }

      child.on("error", (error: NodeJS.ErrnoException) => {
        settle({ exitCode: null, cancelled: cancelRequested, spawnError: spawnErrorKind(error) });
      });
      child.on("close", (code) => {
        settle({ exitCode: code, cancelled: cancelRequested });
      });
      if (child.stderr) {
        createInterface({ input: child.stderr }).on("line", (line) => input.onStderrLine(line));
      }

      return {
        cancel: () => {
          if (settled || cancelRequested) return;
          cancelRequested = true;
          if (deps.platform === "win32") {
            if (child.pid !== undefined) deps.execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
            return;
          }
          child.kill("SIGINT");
          forceTimer = setTimeout(() => {
            if (!settled) child.kill("SIGKILL");
          }, deps.forceKillAfterMs);
        },
        done,
      };
    },
  };
}
