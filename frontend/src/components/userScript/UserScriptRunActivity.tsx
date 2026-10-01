import type { UserScriptRun, UserScriptRunSummary } from "@apipilot/shared-domain";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";
import type { UserScriptStartInput } from "../../services/userScriptClient";
import { BUTTON_STYLES } from "../controlStyles";
import { CodeBlock } from "../CodeBlock";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "../performance/PerformanceReportFrame";
import { formatDuration, runStatusLabel, TIER_TONE } from "../performance/performanceViewModel";
import type { PerformanceRuns } from "../performance/usePerformanceRuns";
import { LOAD_ORIGIN } from "./UserScriptRunTrigger";

/**
 * A script's live run, its failure message, its report and its run history (AP-034 FR-019,
 * FR-023, FR-029, FR-035). The target stays on screen throughout a run. k6's message for a run it
 * could not start is shown only here, never in the list or the report.
 */
export function UserScriptRunActivity({
  runs,
  client,
}: Readonly<{
  runs: PerformanceRuns<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>;
  client: PerformanceRunsClient<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>;
}>) {
  const { run, inProgress, runs: history, reportRunId, showReport, cancelling, cancel } = runs;
  const progress = run?.progress;
  const elapsedMs = progress?.elapsedMs ?? 0;
  const plannedMs = run?.plannedDurationMs ?? null;

  return (
    <div className="space-y-5">
      {run && inProgress && (
        <section aria-labelledby="user-script-live-title" className="space-y-4 rounded-lg border border-border bg-surface p-5" data-testid="user-script-live">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 id="user-script-live-title" className="text-base font-semibold">
                Run <span className="font-mono">{run.id.slice(0, 8)}</span>
              </h3>
              <StatusBadge {...runStatusLabel(run)} />
            </div>
            <button type="button" className={BUTTON_STYLES.danger} disabled={cancelling || run.cancelRequested} onClick={() => void cancel()}>
              {cancelling || run.cancelRequested ? "Cancelling…" : "Cancel run"}
            </button>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-semibold text-muted">TARGET</span>
            <span className="font-semibold">{run.environment.name}</span>
            <StatusBadge label={`Tier: ${run.environment.tier}`} tone={TIER_TONE[run.environment.tier]} />
            <span className="break-all font-mono text-xs">{run.environment.baseUrl}</span>
            <span className="text-xs text-muted">{LOAD_ORIGIN}</span>
          </p>
          <p className="text-xs text-muted">
            Hosts written in the script: {run.snapshot.hostsFound.length === 0 ? "none found" : run.snapshot.hostsFound.join(", ")}. ApiPilot cannot restrict where the script sends requests.
          </p>
          <p className="text-sm">
            <strong className="font-mono">{formatDuration(elapsedMs)}</strong> <span className="text-muted">elapsed</span>
            {plannedMs !== null && (
              <>
                {" "}
                <span className="text-muted">of</span> <strong className="font-mono">{formatDuration(plannedMs)}</strong> <span className="text-muted">planned</span>
              </>
            )}
          </p>
          <dl className="grid grid-cols-3 gap-3">
            {[
              ["Virtual users", progress?.currentVirtualUsers ?? 0],
              ["Requests so far", progress?.requestsSoFar ?? 0],
              ["Failures so far", progress?.failuresSoFar ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-chrome p-3">
                <dt className="text-xs font-semibold text-muted">{label}</dt>
                <dd className="font-mono text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {run && !inProgress && run.status === "failed" && (
        <section aria-labelledby="user-script-failed-title" className="space-y-2 rounded-lg border border-danger-300 bg-surface p-5 dark:border-danger-500/50" data-testid="user-script-failed">
          <h3 id="user-script-failed-title" className="text-base font-semibold">
            Run <span className="font-mono">{run.id.slice(0, 8)}</span> failed · {run.failure?.category ?? "unknown"}
          </h3>
          {run.failure?.k6Message ? <CodeBlock label="k6's message (at most 2,000 characters)" content={run.failure.k6Message} /> : <p className="text-sm text-muted">k6 printed no error message.</p>}
        </section>
      )}

      {reportRunId && <PerformanceReportFrame client={client} runId={reportRunId} />}

      <section aria-labelledby="user-script-runs-title" className="space-y-2 rounded-lg border border-border bg-surface p-5">
        <h3 id="user-script-runs-title" className="text-base font-semibold">
          Runs of this script
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No runs yet. Start one from Run setup; its live progress shows here and the report opens when it ends.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-chrome text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Run</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Environment</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Script SHA-256</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Started</th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    <span className="sr-only">Report</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((summary) => (
                  <tr key={summary.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{summary.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge {...runStatusLabel(summary)} />
                    </td>
                    <td className="px-3 py-2">
                      {summary.environment.name} <StatusBadge label={summary.environment.tier} tone={TIER_TONE[summary.environment.tier]} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" title={summary.snapshot.scriptSha256}>
                      {summary.snapshot.scriptSha256.slice(0, 12)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{summary.startedAt}</td>
                    <td className="px-3 py-2">
                      {summary.status === "in-progress" ? (
                        <span className="text-xs text-muted">After it ends</span>
                      ) : (
                        <button type="button" className={BUTTON_STYLES.ghost} onClick={() => showReport(summary.id)}>
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
      </section>
    </div>
  );
}
