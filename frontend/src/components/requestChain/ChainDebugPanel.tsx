import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainPlan, ChainPlanAnalysis, DebugRunResult, Environment } from "@apipilot/shared-domain";
import { debugRun, discardDebugRun, revealDebugValue } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { DebugRunOutput } from "./DebugRunOutput";

/** Why a Debug run cannot start, in words; `null` when it can. */
export function debugBlockedReason(input: { analysis: ChainPlanAnalysis; environment: Environment | null; dirty: boolean; loadRunInProgress: boolean }): string | null {
  if (input.dirty) return "Saving your latest change…";
  if (input.analysis.blockers.length > 0) return "Fix the plan's problems first.";
  if (!input.environment) return "Choose the target environment.";
  if (input.loadRunInProgress) return "A run is in progress.";
  return null;
}

type DebugState = { kind: "idle" } | { kind: "running" } | { kind: "done"; result: DebugRunResult } | { kind: "failed"; message: string };

/**
 * The Debug run trigger and its output (specs/039-chain-debug-run; constitution XVII). It sits inside
 * the Run card, under the one `RunTargetSummary` that describes what both runs do to the target, and
 * sending starts only when the engineer presses Start: a Debug run sends real requests, including
 * writes, and every chain runs once. Cancel aborts the request, which cancels the run on the server. The result is kept in this
 * component's state only; closing it, starting another run or leaving the screen asks the server to
 * forget what it held for reveal, and nothing is written to storage or the URL.
 */
export function ChainDebugPanel({
  plan,
  analysis,
  environment,
  dirty,
  loadRunInProgress,
}: Readonly<{
  plan: ChainPlan;
  analysis: ChainPlanAnalysis;
  environment: Environment | null;
  dirty: boolean;
  loadRunInProgress: boolean;
}>) {
  const [state, setState] = useState<DebugState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const heldRef = useRef<string | null>(null);
  const planId = plan.id;

  const discardHeld = useCallback(() => {
    const held = heldRef.current;
    heldRef.current = null;
    if (held) void discardDebugRun(planId, held);
  }, [planId]);

  // Leaving the screen cancels a run in flight and releases what the server kept.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      discardHeld();
    },
    [discardHeld],
  );

  const blocked = debugBlockedReason({ analysis, environment, dirty, loadRunInProgress });
  const running = state.kind === "running";
  const missing = analysis.requiredValues.filter((value) => value.provided === false).map((value) => value.name);

  const start = async () => {
    if (!environment || running) return;
    discardHeld();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ kind: "running" });
    const outcome = await debugRun(planId, environment.id, controller.signal);
    if (controllerRef.current !== controller) return;
    controllerRef.current = null;
    if (outcome.ok) {
      heldRef.current = outcome.result.debugRunId;
      setState({ kind: "done", result: outcome.result });
    } else if (outcome.error === "aborted") {
      setState({ kind: "idle" });
    } else {
      setState({ kind: "failed", message: outcome.message });
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
  };

  const close = () => {
    discardHeld();
    setState({ kind: "idle" });
  };

  const reveal = useCallback(
    async (valueId: string) => {
      const held = heldRef.current;
      if (!held) return null;
      const result = await revealDebugValue(planId, held, valueId);
      return result.ok ? result.value : null;
    },
    [planId],
  );

  return (
    <section aria-labelledby="chain-debug-title" className="space-y-3">
      <h4 id="chain-debug-title" className="text-sm font-semibold">
        Debug run
      </h4>
      <p className="text-sm text-muted">Runs every chain once and shows each request and response here, so you can see why a step failed or was not sent. It sends real requests, including writes, to the target above.</p>
      {missing.length > 0 && (
        <p className="text-sm text-warning-700 dark:text-warning-100" role="note" data-testid="debug-missing-values">
          The target has no value for {missing.join(", ")}. The steps that need them will not be sent, and the output will say so.
        </p>
      )}
      <p className="text-xs text-muted">Nothing is stored: the output is gone when you close it or reload the page. Authorization, cookie and API key values, secret values and credentials are masked. Nothing is sent until you start.</p>
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className={BUTTON_STYLES.danger} onClick={cancel}>
            Cancel debug run
          </button>
        ) : (
          <button type="button" className={BUTTON_STYLES.primary} disabled={blocked !== null} onClick={() => void start()}>
            {`Start debug run on ${environment?.name ?? "…"}`}
          </button>
        )}
        {state.kind === "done" && (
          <button type="button" className={BUTTON_STYLES.secondary} onClick={close}>
            Close output
          </button>
        )}
        {blocked && !running && (
          <span className="text-xs text-muted" data-testid="debug-blocked">
            {blocked}
          </span>
        )}
      </div>
      {running && (
        <p className="text-sm" role="status">
          Running the plan once…
        </p>
      )}
      {state.kind === "failed" && <ErrorState message="The Debug run could not run." detail={state.message} testId="debug-run-error" />}
      {state.kind === "done" && <DebugRunOutput result={state.result} onReveal={reveal} />}
    </section>
  );
}
