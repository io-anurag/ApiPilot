import type { Environment, K6Readiness, UserScript, UserScriptRun, UserScriptRunSummary } from "@apipilot/shared-domain";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";
import type { UserScriptStartInput } from "../../services/userScriptClient";
import { formatDateTimeUtc, formatTimeUtc } from "../../dateTime";
import { BUTTON_STYLES } from "../controlStyles";
import { CodeBlock } from "../CodeBlock";
import { StatusBadge } from "../StatusBadge";
import { Card } from "../patterns/Card";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { LiveRunDashboard } from "../liveRun/LiveRunDashboard";
import { PerformanceReportFrame } from "../performance/PerformanceReportFrame";
import { loadProfileSummary, runStatusLabel, TIER_TONE } from "../performance/performanceViewModel";
import type { PerformanceRuns } from "../performance/usePerformanceRuns";
import { PanelState, ScriptPanel } from "./ScriptPanel";
import { runAgainBlockedReason } from "./UserScriptRunTrigger";

const SECTION_LABEL = "text-base font-semibold text-text-primary";
const FULL_BUTTON = "w-full justify-center text-center";

/**
 * What a Run k6 Script run leaves to read, laid out as the Performance Run step's second half
 * (specs/051-user-script-page-redesign FR-004; AP-040): the run in progress with Cancel, then the last
 * run with Run again and what it used, above the script's runs, then the open report. Starting a run is
 * the launch card's job (`UserScriptRunTrigger`); the target stays on screen through a run in that card
 * (AP-034 FR-023). k6's message for a run it could not start is shown only here, never in the list or the
 * report.
 */
export function UserScriptRunActivity({
  runs,
  client,
  script,
  environments,
  readiness,
  onRunAgain,
  onGoToSetup,
}: Readonly<{
  runs: PerformanceRuns<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>;
  client: PerformanceRunsClient<UserScriptRun, UserScriptRunSummary, UserScriptStartInput>;
  script: UserScript;
  environments: readonly Environment[];
  readiness: K6Readiness | null;
  /** Starts a run on this environment: Run again (AP-034 FR-019: only the engineer's click). */
  onRunAgain: (environmentId: string) => void;
  onGoToSetup: () => void;
}>) {
  const { run, inProgress, runs: history, reportRunId, showReport, cancelling, cancel, latestFinished: latest } = runs;
  const againBlocked = latest ? runAgainBlockedReason(latest, { script, environments, readiness, inProgress }) : null;
  const latestEnvironment = latest ? environments.find((candidate) => candidate.id === latest.environment.id) : undefined;

  return (
    <div className="min-w-0 space-y-5">
      {run && inProgress && (
        <div data-testid="user-script-live">
          <LiveRunDashboard
            key={run.id}
            kind="user-script"
            runId={run.id}
            meta={`${run.environment.name} · ${run.snapshot.scriptName} · started ${formatTimeUtc(run.startedAt)}`}
            actions={
              <button type="button" className={BUTTON_STYLES.danger} disabled={cancelling || run.cancelRequested} onClick={() => void cancel()}>
                {cancelling || run.cancelRequested ? "Cancelling…" : "Cancel run"}
              </button>
            }
          />
        </div>
      )}

      {run && !inProgress && run.status === "failed" && (
        <ScriptPanel
          title={`Run ${run.id.slice(0, 8)} failed · ${run.failure?.category ?? "unknown"}`}
          titleId="user-script-failed-title"
          meta="k6 could not complete this run."
          aside={<PanelState tone="blocked" label="Failed" />}
          testId="user-script-failed"
        >
          {run.failure?.k6Message ? <CodeBlock label="k6's message (at most 2,000 characters)" content={run.failure.k6Message} /> : <p className="text-sm text-muted">k6 printed no error message.</p>}
        </ScriptPanel>
      )}

      <aside aria-label="Run actions" className="grid gap-4 md:grid-cols-2">
        <Card as="section" aria-labelledby="user-script-last-run-title" className="flex flex-col gap-3">
          <h3 id="user-script-last-run-title" className={SECTION_LABEL}>
            Last run
          </h3>
          {latest ? (
            <>
              <p className="text-base font-semibold">{formatDateTimeUtc(latest.startedAt)}</p>
              <p className="flex flex-wrap gap-1.5">
                <StatusBadge {...runStatusLabel(latest)} />
                <StatusBadge label={latestEnvironment?.name ?? latest.environment.name} />
              </p>
              <div className="mt-auto space-y-2 pt-1">
                <button
                  type="button"
                  className={`${BUTTON_STYLES.primary} ${FULL_BUTTON} py-2.5`}
                  disabled={againBlocked !== null || runs.starting}
                  onClick={() => onRunAgain(latest.environment.id)}
                >
                  Run again on {latestEnvironment?.name ?? latest.environment.name}
                </button>
                {againBlocked && (
                  <p className="text-left text-xs text-muted hyphens-none" data-testid="run-again-blocked">
                    {againBlocked}
                  </p>
                )}
                <button type="button" className={`${BUTTON_STYLES.secondary} ${FULL_BUTTON} py-2.5`} onClick={onGoToSetup}>
                  Go to Run setup
                </button>
                <p className="text-left text-xs text-muted hyphens-none">Run again is offered only while the script and its confirmation are unchanged since this run and its environment still exists. When it is blocked, the reason appears here in words.</p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">No finished run yet.</p>
              <button type="button" className={`${BUTTON_STYLES.secondary} ${FULL_BUTTON} py-2.5`} onClick={onGoToSetup}>
                Go to Run setup
              </button>
            </>
          )}
        </Card>

        {latest && (
          <Card as="section" aria-labelledby="user-script-used-title" className="flex flex-col gap-3">
            <h3 id="user-script-used-title" className={SECTION_LABEL}>
              This run used
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted">Script</dt>
                <dd className="break-words font-semibold">
                  {latest.snapshot.scriptName} <span className="font-mono text-xs font-normal" title={latest.snapshot.scriptSha256}>sha256 {latest.snapshot.scriptSha256.slice(0, 12)}…</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Load</dt>
                <dd className="font-semibold">{latest.snapshot.load.kind === "script" ? "The script's own load settings" : loadProfileSummary(latest.snapshot.load.profile)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Thresholds set in ApiPilot</dt>
                <dd className="font-semibold">{latest.snapshot.thresholds.length === 0 ? "None" : String(latest.snapshot.thresholds.length)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Hosts written in the script</dt>
                <dd className="font-mono text-xs">{latest.snapshot.hostsFound.length === 0 ? <span className="font-sans text-sm font-normal text-muted">None found.</span> : latest.snapshot.hostsFound.join(", ")}</dd>
              </div>
            </dl>
            <p className="mt-auto text-left text-xs text-muted hyphens-none">The settings are read from the run&apos;s record. Nothing here changes the script or starts a run.</p>
          </Card>
        )}
      </aside>

      <Card as="section" aria-labelledby="user-script-runs-title">
        <div className="mb-3.5">
          <h3 id="user-script-runs-title" className="text-base font-semibold text-text-primary">
            Runs of this script
          </h3>
          <p className="text-xs text-muted">Open a run to read its report. Reports are rendered by the server and never run scripts.</p>
        </div>
        {history.length === 0 ? (
          <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-text-secondary" data-testid="user-script-runs-empty">
            No runs yet. Start one from the card above; its live progress shows here and the report opens when it ends.
          </p>
        ) : (
          <div role="region" aria-label="Runs table" tabIndex={0} className={`${TABLE_STYLES.scroll} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}>
            <table className={TABLE_STYLES.table}>
              <caption className="sr-only">Runs of this script</caption>
              <thead>
                <tr>
                  <th scope="col" className={TABLE_STYLES.th}>Started</th>
                  <th scope="col" className={TABLE_STYLES.th}>Environment</th>
                  <th scope="col" className={TABLE_STYLES.th}>Status</th>
                  <th scope="col" className={TABLE_STYLES.th}>Script SHA-256</th>
                  <th scope="col" className={TABLE_STYLES.th}>
                    <span className="sr-only">Report</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((summary) => {
                  const open = summary.id === reportRunId;
                  return (
                    <tr key={summary.id} className={open ? "bg-lime-pale" : ""}>
                      <td className={`${TABLE_STYLES.tdMono} border-l-2 ${open ? "border-l-brand-500" : "border-l-transparent"}`}>{formatDateTimeUtc(summary.startedAt)}</td>
                      <td className={TABLE_STYLES.td}>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {summary.environment.name} <StatusBadge label={summary.environment.tier} tone={TIER_TONE[summary.environment.tier]} />
                        </span>
                      </td>
                      <td className={TABLE_STYLES.td}>
                        <StatusBadge {...runStatusLabel(summary)} />
                      </td>
                      <td className={TABLE_STYLES.tdMono} title={summary.snapshot.scriptSha256}>
                        {summary.snapshot.scriptSha256.slice(0, 12)}…
                      </td>
                      <td className={`${TABLE_STYLES.td} text-right`}>
                        {open ? (
                          <span aria-current="true" className="text-sm font-semibold text-brand-700">
                            Viewing report
                          </span>
                        ) : (
                          summary.status !== "in-progress" && (
                            <button type="button" className={BUTTON_STYLES.ghost} onClick={() => showReport(summary.id)}>
                              View report
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reportRunId && !(inProgress && run?.id === reportRunId) && <LiveRunDashboard key={reportRunId} kind="user-script" runId={reportRunId} meta={`Run ${reportRunId.slice(0, 8)}`} />}

      {reportRunId && (
        <Card>
          <PerformanceReportFrame client={client} runId={reportRunId} />
        </Card>
      )}
    </div>
  );
}
