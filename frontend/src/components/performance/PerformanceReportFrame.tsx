import { useEffect, useState } from "react";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";

/**
 * Shows a run's report (FR-035; research D17).
 *
 * Security-relevant: this is the app's first embedded HTML. The frame is `sandbox=""`, which
 * grants no permissions at all (no scripts, forms, same-origin access, popups or navigation). The
 * HTML itself is rendered by the server from the stored run, with every string escaped and a
 * Content-Security-Policy that lets it load nothing. The download link serves the same bytes.
 */
export function PerformanceReportFrame({ client, runId }: Readonly<{ client: Pick<PerformanceRunsClient, "fetchReport" | "reportDownloadUrl">; runId: string }>) {
  const { fetchReport, reportDownloadUrl } = client;
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; html: string } | { kind: "error"; message: string }>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchReport(runId).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { kind: "ready", html: result.html } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, [runId, fetchReport]);

  return (
    <section aria-labelledby="performance-report-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="performance-report-title" className="text-base font-semibold">
          Report · run <span className="font-mono">{runId.slice(0, 8)}</span>
        </h3>
        <a className={BUTTON_STYLES.primary} href={reportDownloadUrl(runId)} download>
          Download report (HTML)
        </a>
      </div>
      {state.kind === "loading" && <Skeleton className="h-96 w-full rounded bg-slate-200 dark:bg-slate-600" />}
      {state.kind === "error" && <ErrorState message="The report could not be loaded." detail={state.message} testId="performance-report-error" />}
      {state.kind === "ready" && (
        <iframe
          sandbox=""
          srcDoc={state.html}
          title={`Performance report for run ${runId.slice(0, 8)}`}
          className="h-160 w-full rounded-lg border border-border bg-white"
        />
      )}
    </section>
  );
}
