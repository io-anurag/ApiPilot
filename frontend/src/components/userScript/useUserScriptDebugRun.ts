import { useCallback, useEffect, useRef, useState } from "react";
import type { Environment, K6Readiness, UserScript, UserScriptDebugResult } from "@apipilot/shared-domain";
import { userScriptClient } from "../../services/userScriptClient";
import { triggerBlockedReason } from "./UserScriptRunTrigger";

/**
 * Why a Debug run cannot start, in words; `null` when it can. The same reasons as a run, except the load
 * profile, which a Debug run ignores (specs/053-user-script-debug-run FR-001).
 */
export function debugBlockedReason(script: UserScript, environment: Environment | null, readiness: K6Readiness | null, runInProgress: boolean, debugRunning: boolean): string | null {
  const reason = triggerBlockedReason(script, environment, readiness, runInProgress, { ignoreLoad: true });
  if (reason) return reason;
  return debugRunning ? "A debug run is in progress." : null;
}

type DebugState = { kind: "idle" } | { kind: "running" } | { kind: "done"; result: UserScriptDebugResult } | { kind: "failed"; message: string };

export interface UserScriptDebugRun {
  state: DebugState;
  running: boolean;
  blocked: string | null;
  start: () => void;
  cancel: () => void;
  close: () => void;
  reveal: (valueId: string) => Promise<string | null>;
}

/**
 * The Debug run's state and actions (specs/053-user-script-debug-run; constitution v3.1.0, XVII). Sending
 * starts only when the engineer calls `start`: a Debug run sends real requests, including writes. `cancel`
 * aborts the request, which cancels k6 on the server. The result is kept in this hook's state only; closing
 * it, starting another run or leaving the screen asks the server to forget what it held for reveal, and
 * nothing is written to storage or the URL.
 */
export function useUserScriptDebugRun({
  scriptId,
  script,
  environment,
  readiness,
  runInProgress,
}: Readonly<{
  scriptId: string;
  /** Null while the script is still loading. */
  script: UserScript | null;
  environment: Environment | null;
  readiness: K6Readiness | null;
  runInProgress: boolean;
}>): UserScriptDebugRun {
  const [state, setState] = useState<DebugState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const heldRef = useRef<string | null>(null);

  const discardHeld = useCallback(() => {
    const held = heldRef.current;
    heldRef.current = null;
    if (held) void userScriptClient.discardDebugRun(scriptId, held);
  }, [scriptId]);

  // Leaving the screen cancels a run in flight and releases what the server kept.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      discardHeld();
    },
    [discardHeld],
  );

  const running = state.kind === "running";
  const blocked = script ? debugBlockedReason(script, environment, readiness, runInProgress, running) : "Loading the script…";

  const start = () => {
    if (!script || !environment || running) return;
    void (async () => {
      discardHeld();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ kind: "running" });
      const outcome = await userScriptClient.debugRun(scriptId, { environmentId: environment.id, scriptSha256: script.sha256 }, controller.signal);
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

  const cancel = () => controllerRef.current?.abort();

  const close = () => {
    discardHeld();
    setState({ kind: "idle" });
  };

  const reveal = useCallback(
    async (valueId: string) => {
      const held = heldRef.current;
      if (!held) return null;
      const result = await userScriptClient.revealDebugValue(scriptId, held, valueId);
      return result.ok ? result.value : null;
    },
    [scriptId],
  );

  return { state, running, blocked, start, cancel, close, reveal };
}
