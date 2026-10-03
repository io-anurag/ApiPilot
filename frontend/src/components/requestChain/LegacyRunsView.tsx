import { useEffect, useState } from "react";
import { fetchLegacyRuns, LEGACY_SOURCES, legacyReportClient, type LegacyRunSummary } from "../../services/legacyRunsClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "../performance/PerformanceReportFrame";

const STATUS_TEXT: Record<LegacyRunSummary["status"], string> = { "in-progress": "In progress", completed: "Completed", cancelled: "Cancelled", failed: "Failed" };
const STATUS_TONE = { "in-progress": "info", completed: "success", cancelled: "neutral", failed: "danger" } as const;

/** The FR-037 note, word for word (contracts/changes-to-existing-apis.md "Frontend removed"). */
export const LEGACY_RUNS_NOTE = "Recorded before request-chain plans: you can open the report, but it cannot be run again or restored.";

/**
 * Runs recorded from the retired guided, quick and collection plans (specs/037-request-chain-performance
 * FR-037), read only: each report opens exactly as it was rendered, and no run is offered again or
 * restored. Shown only when the session has such runs.
 */
export function LegacyRunsView() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; runs: LegacyRunSummary[] }>({ kind: "loading" });
  const [open, setOpen] = useState<LegacyRunSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLegacyRuns().then((result) => {
      if (!cancelled) setState(result.ok ? { kind: "ready", runs: result.runs } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading" || (state.kind === "ready" && state.runs.length === 0)) return null;
  return (
    <section aria-labelledby="legacy-runs-title" className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="legacy-runs">
      <div className="space-y-0.5">
        <h3 id="legacy-runs-title" className="text-sm font-semibold">
          Earlier runs
        </h3>
        <p className="text-sm text-muted">{LEGACY_RUNS_NOTE}</p>
      </div>
      {state.kind === "error" ? (
        <ErrorState message="Earlier runs could not be loaded." detail={state.message} testId="legacy-runs-error" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Runs recorded before request-chain plans</caption>
            <thead className="border-b border-border text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Started</th>
                <th scope="col" className="py-2 pr-4 font-medium">From</th>
                <th scope="col" className="py-2 pr-4 font-medium">Environment</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Report</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {state.runs.map((run) => (
                <tr key={run.id}>
                  <td className="py-2 pr-4">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4">{LEGACY_SOURCES.find((entry) => entry.source === run.source)?.label}</td>
                  <td className="py-2 pr-4">{run.environment.name}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge label={STATUS_TEXT[run.status]} tone={STATUS_TONE[run.status]} />
                  </td>
                  <td className="py-2 text-right">
                    {run.status !== "in-progress" && (
                      <button type="button" className={BUTTON_STYLES.ghost} aria-label={`View report of the run started ${new Date(run.startedAt).toLocaleString()}`} onClick={() => setOpen(run)}>
                        View report
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <PerformanceReportFrame key={open.id} client={legacyReportClient(open.source)} runId={open.id} />}
    </section>
  );
}
