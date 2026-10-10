import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Environment, K6Readiness, UserScriptResult, UserScriptRun } from "@apipilot/shared-domain";
import { getEnvironment } from "../../execution/environmentStore";
import { findExecutionInProgress } from "../../execution/executionSlot";
import { createLogger } from "../../logger";
import { getUserScriptRunRepository, type UserScriptRunSettlement } from "../../persistence/userScriptRunRepository";
import type { StoredUserScript } from "../../persistence/userScriptRepository";
import { getSessionId } from "../../session/sessionContext";
import { touch } from "../../session/sessionRegistry";
import { LoadOverrideUnavailableError, UserScriptChangedError, UserScriptNotConfirmedError, UserScriptRefusedError } from "../errors";
import { parseMetricsLine } from "../k6/metricsStream";
import { createRunDirectory, removeRunDirectory } from "../k6/runDirectory";
import { buildUserScriptChildEnv, buildUserScriptK6Args } from "../k6/runner";
import type { K6Probe, PerformanceRunner } from "../k6/runnerTypes";
import { finishLiveSnapshotSource, registerLiveSnapshotSource } from "../live/liveRunRegistry";
import { createUserScriptAggregate } from "../report/userScriptAggregate";
import { withUserScriptReportFields } from "../report/userScriptFindings";
import { registerLiveRun, unregisterLiveRun } from "../runPerformanceTest";
import { exitMeaningOf, settledStatusOf } from "./exitCodes";
import { createStderrFilter } from "./stderrFilter";
import { checkFor, getStoredUserScript, sha256OfBytes } from "./userScriptStore";

const logger = createLogger("performance.userScriptRun");

/**
 * Starts and runs one user-supplied script (specs/034-run-user-k6-script FR-013 to FR-023, FR-029;
 * research R10 to R13, R17; constitution XVII exception of 2026-09-30). `startUserScriptRun` is
 * called only by `POST /api/user-scripts/:id/runs`, the engineer's explicit trigger: nothing here is
 * scheduled, retried or resumed. The bytes executed are a copy of the stored bytes, checked against
 * the confirmed SHA-256 after they are written and before k6 starts; they are never rewritten.
 */

export interface UserScriptRunDependencies {
  runner: PerformanceRunner;
  probe: K6Probe;
  tickIntervalMs: number;
  now: () => Date;
  runDirectoryRoot?: string;
}

/** `409 k6_unavailable`, with the readiness the probe returned. */
export class K6NotReadyError extends Error {
  constructor(public readonly readiness: K6Readiness) {
    super("k6 is not available on the machine running ApiPilot.");
    this.name = "K6NotReadyError";
  }
}

/** `409 execution_in_progress`, with the run that holds the slot. */
export class ExecutionSlotTakenError extends Error {
  constructor(public readonly runId: string) {
    super("Another execution run is in progress in this session.");
    this.name = "ExecutionSlotTakenError";
  }
}

/** More unreadable metrics lines than this and the stream is treated as unreadable (as AP-029). */
const MAX_UNREADABLE_LINES = 10;

/** Research R12: each mapped name with its value from the environment; absent or empty values are not set. */
export function mappedValues(script: Pick<StoredUserScript, "settings">, environment: Environment): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of script.settings.mapping) {
    const value = entry.source.kind === "base-url" ? environment.baseUrl : environment.variableValues[entry.source.valueName];
    if (value !== undefined && value !== "") values[entry.name] = value;
  }
  return values;
}

/** Research R17's checks, in order; then the run record and the background run. */
export async function startUserScriptRun(scriptId: string, body: { environmentId?: unknown; scriptSha256?: unknown }, deps: UserScriptRunDependencies): Promise<UserScriptRun> {
  // 1. The script exists.
  const stored = getStoredUserScript(scriptId);
  // 2. It still passes the current check.
  const check = checkFor(stored.content, stored.sha256);
  if (!check.accepted) throw new UserScriptRefusedError(check.problems);
  // 3. It is confirmed, and the trigger showed its current SHA-256.
  if (!stored.confirmation || stored.confirmation.sha256 !== stored.sha256) throw new UserScriptNotConfirmedError();
  if (body.scriptSha256 !== stored.sha256) throw new UserScriptChangedError();
  // 4. A load profile override needs a default function (FR-027).
  if (stored.settings.load.kind === "profile" && !check.hasDefaultFunction) throw new LoadOverrideUnavailableError();
  // 5. k6 is ready, probed now (FR-021).
  const probe = await deps.probe({ recheck: true });
  if (probe.readiness.state !== "ready" || !probe.binaryPath) throw new K6NotReadyError(probe.readiness);
  // 6. The environment exists.
  const environment = getEnvironment(typeof body.environmentId === "string" ? body.environmentId : "");
  // 7. The shared slot. The check and the insert are synchronous, with no await between them.
  const inProgress = findExecutionInProgress();
  if (inProgress) throw new ExecutionSlotTakenError(inProgress.runId);

  const load = stored.settings.load;
  const run: UserScriptRun = {
    id: randomUUID(),
    source: "user-script",
    status: "in-progress",
    environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
    snapshot: {
      scriptId: stored.id,
      scriptName: stored.name,
      scriptSha256: stored.sha256,
      load,
      mapping: stored.settings.mapping.map((entry) => ({ name: entry.name, source: entry.source })),
      thresholds: stored.settings.thresholds,
      hostsFound: check.hosts,
    },
    k6Version: probe.readiness.version,
    k6ExitCode: null,
    exitMeaning: null,
    plannedDurationMs: load.kind === "profile" ? load.profile.plannedDurationMs : null,
    startedAt: deps.now().toISOString(),
    cancelRequested: false,
  };
  const sessionId = getSessionId();
  getUserScriptRunRepository().create(sessionId, run);
  void runUserScript({ sessionId, run, content: stored.content, values: mappedValues(stored, environment), binaryPath: probe.binaryPath, deps }).catch((error: Error) =>
    logger.error("user_script_run_unhandled_error", { runId: run.id, errorCategory: error.name }),
  );
  return run;
}

interface RunUserScriptInput {
  sessionId: string;
  run: UserScriptRun;
  content: Buffer;
  values: Record<string, string>;
  binaryPath: string;
  deps: UserScriptRunDependencies;
}

async function runUserScript(input: RunUserScriptInput): Promise<void> {
  const { sessionId, run, deps } = input;
  const repository = getUserScriptRunRepository();
  const startedAtMs = Date.parse(run.startedAt);
  const aggregate = createUserScriptAggregate({ plannedDurationMs: run.plannedDurationMs, startedAtMs });
  const stderr = createStderrFilter();
  // AP-045: the live dashboard reads this run's figures from memory.
  registerLiveSnapshotSource({ sessionId, runId: run.id, kind: "user-script", plannedDurationMs: run.plannedDurationMs, parts: aggregate.liveParts });

  const settle = (settlement: UserScriptRunSettlement, result?: UserScriptResult) => {
    const settled = repository.settle(sessionId, run.id, settlement, deps.now().toISOString(), result);
    finishLiveSnapshotSource(run.id, settled.status === "in-progress" ? "failed" : settled.status, deps.now().getTime());
    touch(sessionId);
    const counts = stderr.counts();
    logger.info("user_script_run_settled", {
      runId: run.id,
      status: settled.status,
      exitCode: settlement.exitCode ?? -1,
      requestCount: result?.totals.requests ?? 0,
      stderrLineCount: counts.lines,
      consoleLineCount: counts.consoleLines,
      durationMs: deps.now().getTime() - startedAtMs,
    });
    if (settlement.status === "failed") logger.error("user_script_run_failed", { runId: run.id, errorCategory: settlement.failure?.category ?? "unknown" });
  };
  const resultAt = (endMs: number, exitCode: number | null) => {
    const meaning = exitMeaningOf(exitCode);
    return withUserScriptReportFields(aggregate.toResult(endMs), { ...run, exitMeaning: meaning }, exitCode);
  };
  // AP-045 US4: the series is stored once, with the finished result, not with every checkpoint.
  const finalResultAt = (endMs: number, exitCode: number | null) => ({ ...resultAt(endMs, exitCode), liveSeries: aggregate.storedLiveSeries(endMs) });

  let runDir: string | undefined;
  try {
    runDir = createRunDirectory(run.id, deps.runDirectoryRoot);
    const scriptPath = path.join(runDir, "script.js");
    const metricsPath = path.join(runDir, "metrics.ndjson");
    writeFileSync(scriptPath, input.content, { mode: 0o600 });
    // FR-017: the copy is re-read and must hash to the confirmed SHA-256, or k6 never starts.
    if (sha256OfBytes(readFileSync(scriptPath)) !== run.snapshot.scriptSha256) {
      settle({ status: "failed", failure: { category: "script-integrity-failed" }, exitCode: null, exitMeaning: null });
      return;
    }

    let unreadable = 0;
    let metricsUnreadable = false;
    let userCancelled = false;
    const handle = deps.runner.start({
      runDir,
      scriptPath,
      metricsPath,
      binaryPath: input.binaryPath,
      args: buildUserScriptK6Args(runDir, run.snapshot.load.kind === "profile" ? run.snapshot.load.profile.stages : null),
      env: buildUserScriptChildEnv(process.env, input.values),
      onLine: (line) => {
        const parsed = parseMetricsLine(line, { acceptAllMetrics: true });
        if (parsed.kind === "unreadable") {
          unreadable += 1;
          if (unreadable > MAX_UNREADABLE_LINES && !metricsUnreadable) {
            metricsUnreadable = true;
            handle.cancel();
          }
          return;
        }
        aggregate.add(parsed);
      },
      // FR-040: console output is dropped unread; k6's own errors are kept in memory only (R13).
      onStderrLine: (line) => stderr.onLine(line),
    });
    registerLiveRun(run.id, handle);
    logger.info("user_script_run_started", { runId: run.id, environmentTier: run.environment.tier, loadKind: run.snapshot.load.kind });

    const tick = setInterval(() => {
      const nowMs = deps.now().getTime();
      try {
        repository.checkpoint(sessionId, run.id, { progress: aggregate.progress(nowMs), result: resultAt(nowMs, null) });
        touch(sessionId);
        if (!userCancelled && repository.isCancelRequested(sessionId, run.id)) {
          userCancelled = true;
          handle.cancel();
        }
      } catch (error) {
        logger.error("user_script_run_tick_failed", { runId: run.id, errorCategory: (error as Error).name });
      }
    }, deps.tickIntervalMs);

    const exit = await handle.done;
    clearInterval(tick);
    unregisterLiveRun(run.id);
    if (!userCancelled && repository.isCancelRequested(sessionId, run.id)) userCancelled = true;
    const endMs = deps.now().getTime();
    repository.checkpoint(sessionId, run.id, { progress: aggregate.progress(endMs) });

    if (exit.spawnError) {
      settle({ status: "failed", failure: { category: "k6-unavailable" }, exitCode: null, exitMeaning: null });
      return;
    }
    if (metricsUnreadable) {
      settle({ status: "failed", failure: { category: "metrics-unreadable" }, exitCode: exit.exitCode, exitMeaning: exitMeaningOf(exit.exitCode) }, finalResultAt(endMs, exit.exitCode));
      return;
    }
    if (userCancelled || exit.cancelled) {
      settle({ status: "cancelled", cancelReason: "user-requested", exitCode: null, exitMeaning: null }, finalResultAt(endMs, null));
      return;
    }
    const status = settledStatusOf(exit.exitCode, aggregate.requestCount);
    const exitMeaning = exitMeaningOf(exit.exitCode);
    const result = aggregate.requestCount > 0 ? finalResultAt(endMs, exit.exitCode) : undefined;
    if (status === "failed") {
      const k6Message = stderr.keptErrorText();
      settle({ status: "failed", failure: { category: "k6-exited-with-error", ...(k6Message ? { k6Message } : {}) }, exitCode: exit.exitCode, exitMeaning }, result);
    } else {
      settle({ status: "completed", exitCode: exit.exitCode, exitMeaning }, result);
    }
  } catch (error) {
    unregisterLiveRun(run.id);
    logger.error("user_script_run_unhandled_error", { runId: run.id, errorCategory: (error as Error).name });
    try {
      settle({ status: "failed", failure: { category: "k6-exited-with-error" }, exitCode: null, exitMeaning: null });
    } catch {
      // The run row is gone (its session expired): nothing left to record.
    }
  } finally {
    // FR-041: the working copy is removed when the run ends.
    if (runDir) removeRunDirectory(run.id, deps.runDirectoryRoot);
  }
}
