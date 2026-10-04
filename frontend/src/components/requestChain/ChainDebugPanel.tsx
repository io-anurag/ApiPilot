import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainPlan, ChainPlanAnalysis, DebugRunResult, Environment } from "@apipilot/shared-domain";
import { debugRun, discardDebugRun, revealDebugValue } from "../../services/requestChainClient";
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

export interface ChainDebugRun {
  state: DebugState;
  running: boolean;
  blocked: string | null;
  /** Names the target has no value for; the steps that need them are not sent. */
  missing: string[];
  start: () => void;
  cancel: () => void;
  close: () => void;
  reveal: (valueId: string) => Promise<string | null>;
}

/**
 * The Debug run's state and actions (specs/039-chain-debug-run; constitution XVII). Sending starts
 * only when the engineer calls `start`: a Debug run sends real requests, including writes, and every
 * chain runs once. `cancel` aborts the request, which cancels the run on the server. The result is kept
 * in this hook's state only; closing it, starting another run or leaving the screen asks the server to
 * forget what it held for reveal, and nothing is written to storage or the URL. The trigger buttons
 * and the output are separate components so a screen can place them apart (AP-040).
 */
export function useChainDebugRun({
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
}>): ChainDebugRun {
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

  const start = () => {
    if (!environment || running) return;
    void (async () => {
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
    })();
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

  return { state, running, blocked, missing, start, cancel, close, reveal };
}

/** What a Debug run does, and what it masks. Nothing here sends anything. */
export function DebugRunNotes({ missing, compact = false }: Readonly<{ missing: readonly string[]; compact?: boolean }>) {
  // A caption in a narrow column is left-aligned and not hyphenated; the app's justified prose needs a wide measure.
  const caption = compact ? "text-left text-xs hyphens-none" : "";
  return (
    <>
      <p className={`text-sm text-muted ${caption}`}>Runs every chain once and shows each request and response here, so you can see why a step failed or was not sent. It sends real requests, including writes, to the target above.</p>
      {missing.length > 0 && (
        <p className={`text-sm text-warning-700 dark:text-warning-100 ${caption}`} role="note" data-testid="debug-missing-values">
          The target has no value for {missing.join(", ")}. The steps that need them will not be sent, and the output will say so.
        </p>
      )}
      <p className={`text-xs text-muted ${caption}`}>Nothing is stored: the output is gone when you close it or reload the page. Authorization, cookie and API key values, secret values and credentials are masked. Nothing is sent until you start.</p>
    </>
  );
}

/** The Debug run's progress, failure or output. */
export function DebugRunResultView({ debug }: Readonly<{ debug: ChainDebugRun }>) {
  const { state } = debug;
  return (
    <>
      {debug.running && (
        <p className="text-sm" role="status">
          Running the plan once…
        </p>
      )}
      {state.kind === "failed" && <ErrorState message="The Debug run could not run." detail={state.message} testId="debug-run-error" />}
      {state.kind === "done" && <DebugRunOutput result={state.result} onReveal={debug.reveal} />}
    </>
  );
}
