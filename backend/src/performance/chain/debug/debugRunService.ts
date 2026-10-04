import { randomUUID } from "node:crypto";
import type { DebugRunResult } from "@apipilot/shared-domain";
import { getEnvironment } from "../../../execution/environmentStore";
import { findExecutionInProgress } from "../../../execution/executionSlot";
import { createLogger } from "../../../logger";
import { getSessionId } from "../../../session/sessionContext";
import { DebugRunBlockedError, DebugRunInProgressError, DebugValueNotFoundError, PlanHasBlockersError } from "../../errors";
import { runTagOf } from "../../runPerformanceTest";
import { getPlan, viewOf } from "../chainPlanStore";
import { loadFirstDataRows } from "./firstDataRows";
import { getHeldValues } from "./heldValues";
import { runDebugRun } from "./runDebugRun";
import type { Sender } from "./sender";

const logger = createLogger("performance.chainDebugRun");

/**
 * The application layer of the Debug run (specs/039-chain-debug-run): checks the preconditions,
 * runs the executor, keeps the revealable values for the reveal call, and logs the outcome. It
 * creates no run record, report or run directory (FR-010), and logs only ids, counts, a duration and
 * an outcome category (FR-012): never a URL, header, body, extracted value or environment value.
 *
 * A Debug run does not take the session's execution slot, because it is not a stored run; it refuses
 * to start while another execution holds the slot, so it never competes with a load run for a target,
 * and an in-memory per-plan flag keeps two Debug runs of one plan from overlapping (FR-023).
 */
const running = new Set<string>();

export interface DebugRunServiceDependencies {
  sender: Sender;
  nowMs: () => number;
}

export async function executeDebugRun(planId: string, environmentId: string, signal: AbortSignal, deps: DebugRunServiceDependencies): Promise<DebugRunResult> {
  const sessionId = getSessionId();
  const plan = getPlan(planId);
  const view = viewOf(plan);
  if (view.analysis.blockers.length > 0) throw new PlanHasBlockersError(view.analysis.blockers);
  const environment = getEnvironment(environmentId);
  const inProgress = findExecutionInProgress();
  if (inProgress) throw new DebugRunBlockedError(inProgress.runId);
  const key = `${sessionId}:${plan.id}`;
  if (running.has(key)) throw new DebugRunInProgressError();
  running.add(key);
  const debugRunId = randomUUID();
  const startedAtMs = deps.nowMs();
  logger.info("chain_debug_run_started", { planId: plan.id, chainCount: plan.chains.length });
  try {
    const data = loadFirstDataRows(sessionId, plan);
    const { result, revealable } = await runDebugRun(
      { debugRunId, plan, analysis: view.analysis, environment, data, runTag: runTagOf(debugRunId), signal },
      { sender: deps.sender, nowMs: deps.nowMs },
    );
    if (signal.aborted) {
      logger.info("chain_debug_run_cancelled", { planId: plan.id, durationMs: deps.nowMs() - startedAtMs });
      getHeldValues().discard(sessionId, plan.id, debugRunId);
      return result;
    }
    getHeldValues().hold(sessionId, plan.id, debugRunId, revealable);
    const steps = [...result.setup, ...result.chains.flatMap((chain) => chain.steps)];
    logger.info("chain_debug_run_finished", {
      planId: plan.id,
      outcome: result.outcome,
      stepsSent: steps.filter((step) => step.status === "sent").length,
      stepsNotSent: steps.filter((step) => step.status === "not-sent").length,
      durationMs: deps.nowMs() - startedAtMs,
    });
    return result;
  } finally {
    running.delete(key);
  }
}

/** One revealed value, or `DebugValueNotFoundError` for any reason the value is not available. */
export function revealDebugValue(planId: string, debugRunId: string, valueId: string): string {
  const sessionId = getSessionId();
  const plan = getPlan(planId);
  const value = getHeldValues().reveal(sessionId, plan.id, debugRunId, valueId);
  if (value === null) throw new DebugValueNotFoundError();
  logger.info("chain_debug_value_revealed", { planId: plan.id });
  return value;
}

export function discardDebugRun(planId: string, debugRunId: string): void {
  getHeldValues().discard(getSessionId(), getPlan(planId).id, debugRunId);
}

/** Tests only. */
export function resetDebugRunsForTests(): void {
  running.clear();
}
