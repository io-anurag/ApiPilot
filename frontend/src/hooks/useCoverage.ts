import { useCallback, useEffect, useRef, useState } from "react";
import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { fetchCoverage, type CoverageQueryParams } from "../services/coverageClient";

export type CoverageProblem =
  | { kind: "no-workflow"; message: string }
  | { kind: "error"; message: string };

export interface UseCoverage {
  /** The last snapshot received; kept while a newer one loads so the view never blanks. */
  snapshot: CoverageSnapshot | null;
  /** True from the moment a request starts until the latest one settles. */
  loading: boolean;
  problem: CoverageProblem | null;
  refresh: () => void;
}

/**
 * Loads the coverage snapshot for `query` and again whenever `query` changes, `active` becomes
 * true (views stay mounted while hidden, so work done elsewhere is picked up on return) or
 * `refresh()` is called. A request counter makes a slow, earlier reply unable to overwrite a newer
 * one (FR-035), and an aborted request never reports.
 */
export function useCoverage(query: CoverageQueryParams, active: boolean): UseCoverage {
  const [snapshot, setSnapshot] = useState<CoverageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<CoverageProblem | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const sequence = useRef(0);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (!active) return;
    const mine = ++sequence.current;
    const controller = new AbortController();
    setLoading(true);
    fetchCoverage(JSON.parse(queryKey) as CoverageQueryParams, controller.signal)
      .then((result) => {
        if (mine !== sequence.current) return;
        if (result.ok) {
          setSnapshot(result.snapshot);
          setProblem(null);
        } else if (result.error === "no_active_workflow") {
          setSnapshot(null);
          setProblem({ kind: "no-workflow", message: result.message });
        } else {
          setProblem({ kind: "error", message: result.message });
        }
        setLoading(false);
      })
      .catch(() => {
        // Only an aborted request lands here, and it has been superseded; report nothing.
      });
    return () => controller.abort();
  }, [queryKey, active, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  return { snapshot, loading, problem, refresh };
}
