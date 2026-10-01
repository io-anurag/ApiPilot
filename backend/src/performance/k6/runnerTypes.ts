import type { K6Readiness } from "@apipilot/shared-domain";

/**
 * The boundary between run orchestration and the k6 process (specs/031-k6-performance-testing
 * research D8, D10, D19). The real implementation (`runner.ts`) spawns k6; tests inject a fake
 * that replays recorded metrics lines, so `npm test` never needs k6.
 */
export interface RunnerStartInput {
  runDir: string;
  scriptPath: string;
  metricsPath: string;
  binaryPath: string;
  /** Exactly the child's environment (research D7): an allow-list plus `APIPILOT_V_<n>` values. */
  env: Record<string, string>;
  /**
   * AP-034 (specs/034-run-user-k6-script research R10): a user-script run's pinned argument list
   * (`buildUserScriptK6Args`). Absent for a generated run, which uses `buildK6Args(runDir)`.
   */
  args?: string[];
  onLine(line: string): void;
  onStderrLine(line: string): void;
}

export type SpawnErrorKind = "not-found" | "not-executable";

export interface RunnerExit {
  exitCode: number | null;
  cancelled: boolean;
  /** Set when k6 could not be started at all (removed or made unusable after the probe). */
  spawnError?: SpawnErrorKind;
}

export interface RunnerHandle {
  /** Stops load generation: graceful first, then forced (research D19). Idempotent. */
  cancel(): void;
  /** Settles once k6 has exited and every line written so far has been delivered. Never rejects. */
  done: Promise<RunnerExit>;
}

export interface PerformanceRunner {
  start(input: RunnerStartInput): RunnerHandle;
}

/**
 * A readiness probe's result. `binaryPath` is for the runner only and never leaves the backend
 * (contract: no response contains the k6 binary path).
 */
export interface K6ProbeResult {
  readiness: K6Readiness;
  binaryPath?: string;
}

export type K6Probe = (options: { recheck: boolean }) => Promise<K6ProbeResult>;
