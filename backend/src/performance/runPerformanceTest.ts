import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Environment, PerformanceResult, PerformanceRun } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { getPerformanceRunRepository, type PerformanceRunSettlement } from "../persistence/performanceRunRepository";
import { touch } from "../session/sessionRegistry";
import { sha256Hex } from "./plan/identifiers";
import { createRunDirectory, removeRunDirectory } from "./k6/runDirectory";
import { parseMetricsLine } from "./k6/metricsStream";
import { buildChildEnv } from "./k6/runner";
import type { PerformanceRunner, RunnerHandle } from "./k6/runnerTypes";
import { createAggregate } from "./report/aggregate";
import { deriveFindings } from "./report/findings";
import { evaluateThresholds } from "./report/thresholds";
import type { GeneratedScript } from "./scriptStore";

const logger = createLogger("performance.run");

/**
 * Runs one performance test in the background (specs/031-k6-performance-testing FR-024 to FR-034a;
 * research D7, D8, D11, D18, D19). Started only by `POST /runs`; never retried, scheduled or resumed.
 * It uses the repository with the session id captured before the response, because child-process
 * callbacks are not guaranteed to keep the request's AsyncLocalStorage context.
 */
export interface StartPerformanceRunInput {
  sessionId: string;
  run: PerformanceRun;
  script: GeneratedScript;
  environment: Environment;
  binaryPath: string;
  runner: PerformanceRunner;
  tickIntervalMs: number;
  now: () => Date;
  runDirectoryRoot?: string;
}

/** More unreadable lines than this and the stream is treated as unreadable (D11). */
const MAX_UNREADABLE_LINES = 10;

const liveHandles = new Map<string, RunnerHandle>();

/** AP-034: a user-script run shares this registry, so `cancelLiveRun` stops either kind (specs/034 research R17). */
export function registerLiveRun(runId: string, handle: RunnerHandle): void {
  liveHandles.set(runId, handle);
}

export function unregisterLiveRun(runId: string): void {
  liveHandles.delete(runId);
}

/** Stops a run in progress now, rather than on its next tick (SC-008). Returns false if not live. */
export function cancelLiveRun(runId: string): boolean {
  const handle = liveHandles.get(runId);
  if (!handle) return false;
  handle.cancel();
  return true;
}

/** The environment variables that carry the run's values (D7). An absent or empty value is not set. */
export function valueEnvironment(valueIndex: Record<string, number>, environment: Environment): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, index] of Object.entries(valueIndex)) {
    const value = name === "baseUrl" ? environment.baseUrl : environment.variableValues[name];
    if (value !== undefined && value !== "") values[`APIPILOT_V_${index}`] = value;
  }
  return values;
}

export function withReportFields(result: PerformanceResult, run: PerformanceRun): PerformanceResult {
  const withThresholds = { ...result, thresholdOutcomes: evaluateThresholds(run.planSnapshot.thresholds, result) };
  return { ...withThresholds, findings: deriveFindings(withThresholds, run.planSnapshot) };
}

export async function startPerformanceRun(input: StartPerformanceRunInput): Promise<void> {
  const { sessionId, run } = input;
  const repository = getPerformanceRunRepository();
  const startedAtMs = Date.parse(run.startedAt);
  const aggregate = createAggregate(run.planSnapshot, run.plannedDurationMs, startedAtMs);
  const settle = (settlement: PerformanceRunSettlement, result?: PerformanceResult) => {
    const settled = repository.settle(sessionId, run.id, settlement, input.now().toISOString(), result);
    touch(sessionId);
    logger.info("performance_run_settled", {
      runId: run.id,
      planSource: run.planSource,
      status: settled.status,
      cancelReason: settled.cancelReason ?? "",
      requestCount: result?.totals.requests ?? 0,
      durationMs: input.now().getTime() - startedAtMs,
    });
    if (settlement.status === "failed") logger.error("performance_run_failed", { runId: run.id, errorCategory: settlement.failure.category });
  };

  let runDir: string | undefined;
  try {
    runDir = createRunDirectory(run.id, input.runDirectoryRoot);
    const scriptPath = path.join(runDir, "script.js");
    const metricsPath = path.join(runDir, "metrics.ndjson");
    writeFileSync(scriptPath, input.script.script, { encoding: "utf-8", mode: 0o600 });
    // FR-026: only the unmodified generated script runs. The file is re-read and compared by hash
    // before k6 is spawned; any difference fails the run and k6 never starts.
    if (sha256Hex(readFileSync(scriptPath, "utf-8")) !== run.scriptSha256) {
      settle({ status: "failed", failure: { category: "script-integrity-failed" } });
      return;
    }

    let unreadable = 0;
    let pointCount = 0;
    let metricsUnreadable = false;
    let userCancelled = false;
    let stderrLines = 0;
    const handle = input.runner.start({
      runDir,
      scriptPath,
      metricsPath,
      binaryPath: input.binaryPath,
      env: buildChildEnv(process.env, valueEnvironment(input.script.valueIndex, input.environment)),
      onLine: (line) => {
        const parsed = parseMetricsLine(line);
        if (parsed.kind === "point") {
          pointCount += 1;
          aggregate.ingest(parsed.point);
        } else if (parsed.kind === "unreadable") {
          unreadable += 1;
          if (unreadable > MAX_UNREADABLE_LINES && !metricsUnreadable) {
            metricsUnreadable = true;
            handle.cancel();
          }
        }
      },
      // k6's stderr can carry resolved URLs or response text, so it is counted, never logged (D23).
      onStderrLine: () => {
        stderrLines += 1;
      },
    });
    liveHandles.set(run.id, handle);
    logger.info("performance_run_started", {
      runId: run.id,
      planSource: run.planSource,
      environmentTier: run.environment.tier,
      stepCount: run.planSnapshot.journeys.reduce((total, journey) => total + journey.steps.length, 0),
      plannedDurationMs: run.plannedDurationMs,
    });

    const tick = setInterval(() => {
      const nowMs = input.now().getTime();
      try {
        repository.checkpoint(sessionId, run.id, {
          progress: aggregate.progress(nowMs),
          result: withReportFields(aggregate.toResult(nowMs), run),
        });
        touch(sessionId);
        if (!userCancelled && repository.isCancelRequested(sessionId, run.id)) {
          userCancelled = true;
          handle.cancel();
        }
      } catch (error) {
        logger.error("performance_run_tick_failed", { runId: run.id, errorCategory: (error as Error).name });
      }
    }, input.tickIntervalMs);

    const exit = await handle.done;
    clearInterval(tick);
    liveHandles.delete(run.id);
    if (!userCancelled && repository.isCancelRequested(sessionId, run.id)) userCancelled = true;
    const endMs = input.now().getTime();
    const result = withReportFields(aggregate.toResult(endMs), run);
    repository.checkpoint(sessionId, run.id, { progress: aggregate.progress(endMs) });
    if (stderrLines > 0) logger.info("performance_run_stderr", { runId: run.id, lineCount: stderrLines });

    if (exit.spawnError) settle({ status: "failed", failure: { category: "k6-unavailable" } });
    else if (metricsUnreadable) settle({ status: "failed", failure: { category: "metrics-unreadable" } }, result);
    else if (userCancelled || exit.cancelled) settle({ status: "cancelled", cancelReason: "user-requested" }, result);
    else if (exit.exitCode !== 0 && pointCount === 0) settle({ status: "failed", failure: { category: "k6-exited-with-error" } });
    else settle({ status: "completed" }, result);
  } catch (error) {
    liveHandles.delete(run.id);
    logger.error("performance_run_unhandled_error", { runId: run.id, errorCategory: (error as Error).name });
    try {
      settle({ status: "failed", failure: { category: "k6-exited-with-error" } });
    } catch {
      // The run row itself is gone (its session expired): nothing left to record.
    }
  } finally {
    if (runDir) removeRunDirectory(run.id, input.runDirectoryRoot);
  }
}
