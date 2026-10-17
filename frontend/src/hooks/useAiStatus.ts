import { useEffect, useState } from "react";
import { fetchAiStatus, type AiStatus } from "../services/aiStatusClient";

export type AiStatusState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; status: AiStatus }
  | { kind: "unavailable"; message: string };

/**
 * The AI provider's readiness for Home's status tile (AP-054). Reads only while `active`, once per
 * visit, aborts on leaving and never polls. A failed read is "unavailable" with its message, not a
 * guess about the provider.
 */
export function useAiStatus(active: boolean): AiStatusState {
  const [state, setState] = useState<AiStatusState>({ kind: "idle" });

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetchAiStatus(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { kind: "ready", status: result.status } : { kind: "unavailable", message: result.message });
    });
    return () => controller.abort();
  }, [active]);

  return active ? state : { kind: "idle" };
}
