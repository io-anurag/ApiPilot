import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActiveViewContext } from "../components/requestChain/activeView";
import type { ApiResult } from "../services/securityLabClient";

export type SecurityProblem =
  | { kind: "no-specification"; message: string }
  | { kind: "error"; message: string; code: string };

export interface UseSecurityResource<T> {
  /** The last reply received; kept while a newer one loads so the view never blanks. */
  data: T | null;
  /** True from the moment a request starts until the latest one settles. */
  loading: boolean;
  problem: SecurityProblem | null;
  refresh: () => void;
}

/**
 * Loads one Security Lab resource and again whenever `deps` change, the Security Lab page becomes the
 * active destination (pages stay mounted while hidden, so work done elsewhere is picked up on return) or
 * `refresh()` is called. A request counter makes a slow, earlier reply unable to overwrite a newer one, and
 * an aborted request never reports. A missing specification is a state of its own, never an error and never
 * an empty result (CLAUDE.md section 39).
 */
export function useSecurityResource<T>(
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  deps: ReadonlyArray<unknown> = [],
  enabled = true,
): UseSecurityResource<T> {
  const active = useContext(ActiveViewContext) === "security";
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<SecurityProblem | null>(null);
  const [token, setToken] = useState(0);
  const sequence = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    if (!active || !enabled) return;
    const mine = ++sequence.current;
    const controller = new AbortController();
    setLoading(true);
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (mine !== sequence.current) return;
        if (result.ok) {
          setData(result.data);
          setProblem(null);
        } else if (result.error === "no_specification") {
          setData(null);
          setProblem({ kind: "no-specification", message: result.message });
        } else {
          setProblem({ kind: "error", message: result.message, code: result.error });
        }
        setLoading(false);
      })
      .catch(() => {
        // Only an aborted request lands here, and it has been superseded; report nothing.
      });
    return () => controller.abort();
  }, [active, enabled, depsKey, token]);

  const refresh = useCallback(() => setToken((n) => n + 1), []);
  return { data, loading, problem, refresh };
}
