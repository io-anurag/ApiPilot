import { execFile as nodeExecFile, type ExecFileException } from "node:child_process";
import type { K6Readiness, K6UnavailableReason } from "@apipilot/shared-domain";
import { createLogger } from "../../logger";
import { defaultK6BinaryName, resolveK6BinaryPath } from "../config";
import type { K6Probe, K6ProbeResult } from "./runnerTypes";

const logger = createLogger("performance.k6Readiness");

/**
 * k6 readiness (FR-027; specs/031-k6-performance-testing research D9). The binary is the optional
 * `K6_BINARY_PATH`, else the first `k6` on PATH. ApiPilot never downloads, bundles or installs it.
 * The probe runs `k6 version` with no shell and a 5-second timeout, requires 1.0.0 or later, and
 * follows the AI readiness pattern: explicit states, a reason, and no automatic retry loop.
 */
export const MINIMUM_K6_VERSION = [1, 0, 0] as const;
const CACHE_MS = 30_000;
const VERSION_PATTERN = /k6 v(\d+)\.(\d+)\.(\d+)/;

type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number; shell: false; windowsHide: true },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => void;

export interface K6ProbeDependencies {
  execFile: ExecFile;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  now: () => Date;
}

function defaultDependencies(): K6ProbeDependencies {
  return {
    execFile: nodeExecFile as unknown as ExecFile,
    env: process.env,
    platform: process.platform,
    now: () => new Date(),
  };
}

function isAtLeastMinimum(version: [number, number, number]): boolean {
  for (let index = 0; index < 3; index++) {
    if (version[index] !== MINIMUM_K6_VERSION[index]) return version[index] > MINIMUM_K6_VERSION[index];
  }
  return true;
}

function unavailable(reason: K6UnavailableReason, checkedAt: string, detail?: string): K6Readiness {
  return detail ? { state: "unavailable", reason, detail, checkedAt } : { state: "unavailable", reason, checkedAt };
}

export function interpretProbe(
  error: ExecFileException | null,
  stdout: string,
  checkedAt: string,
): K6Readiness {
  if (error) {
    if (error.code === "ENOENT") return unavailable("not-found", checkedAt);
    return unavailable("not-executable", checkedAt);
  }
  const match = VERSION_PATTERN.exec(stdout);
  if (!match) return unavailable("version-unreadable", checkedAt);
  const version: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const text = version.join(".");
  if (!isAtLeastMinimum(version)) {
    return unavailable("unsupported-version", checkedAt, `found ${text}, need ≥ ${MINIMUM_K6_VERSION.join(".")}`);
  }
  return { state: "ready", version: text, checkedAt };
}

/** Creates a probe with its own short cache; `recheck` always probes again. */
export function createK6Probe(dependencies: Partial<K6ProbeDependencies> = {}): K6Probe {
  const deps = { ...defaultDependencies(), ...dependencies };
  let cached: { atMs: number; result: K6ProbeResult } | undefined;
  return ({ recheck }) => {
    const nowMs = deps.now().getTime();
    if (!recheck && cached && nowMs - cached.atMs < CACHE_MS) return Promise.resolve(cached.result);
    const binaryPath = resolveK6BinaryPath(deps.env) ?? defaultK6BinaryName(deps.platform);
    return new Promise((resolve) => {
      deps.execFile(binaryPath, ["version"], { timeout: 5_000, shell: false, windowsHide: true }, (error, stdout) => {
        const readiness = interpretProbe(error, String(stdout ?? ""), deps.now().toISOString());
        const result: K6ProbeResult = readiness.state === "ready" ? { readiness, binaryPath } : { readiness };
        cached = { atMs: deps.now().getTime(), result };
        logger.info("k6_readiness", readiness.state === "ready" ? { state: readiness.state, version: readiness.version } : { state: readiness.state, reason: readiness.reason });
        resolve(result);
      });
    });
  };
}
