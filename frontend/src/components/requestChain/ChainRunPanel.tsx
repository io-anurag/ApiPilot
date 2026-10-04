import type { ChainPlan, ChainPlanAnalysis, ChainRun, ChainRunSummary, Environment, ScriptStatus } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "../performance/PerformanceReportFrame";
import type { PerformanceRuns } from "../performance/usePerformanceRuns";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";

type Runs = PerformanceRuns<ChainRun, ChainRunSummary, string>;

export const STATUS_TEXT: Record<ChainRun["status"], string> = { "in-progress": "In progress", completed: "Completed", cancelled: "Cancelled", failed: "Failed" };
const STATUS_TONE = { "in-progress": "info", completed: "success", cancelled: "neutral", failed: "danger" } as const;

/** Why a run cannot start, in words; `null` when it can (FR-031, AP-029 FR-024 to FR-029). */
export function runBlockedReason(input: { script: ScriptStatus | null; analysis: ChainPlanAnalysis; environment: Environment | null; runs: Runs; dirty: boolean }): string | null {
  if (input.dirty) return "Saving your latest change…";
  if (input.analysis.blockers.length > 0) return "Fix the plan's problems first.";
  if (!input.script) return "Generate the script first.";
  if (input.script.outOfDate) return "The plan changed after the script was generated. Regenerate it first.";
  if (!input.environment) return "Choose the target environment.";
  if (input.runs.readiness?.state !== "ready") return "k6 is not ready on the machine running ApiPilot.";
  if (input.runs.inProgress) return "A run is in progress.";
  return null;
}

/** Why Run again is not offered for the newest ended run, or `null` (AP-029 FR-024a; FR-035). */
export function runAgainBlockedReason(run: ChainRun, input: { plan: ChainPlan; script: ScriptStatus | null; environments: readonly Environment[]; runs: Runs }): string | null {
  // An edit marks the script out of date before it is regenerated, while its SHA-256 still matches the run.
  if (!input.script || input.script.outOfDate || input.script.scriptSha256 !== run.scriptSha256) return "The script changed since this run.";
  if (!input.environments.some((environment) => environment.id === run.environment.id)) return "This run's environment no longer exists.";
  const changed = run.snapshot.dataSets.find((dataSet) => input.plan.dataSets.find((current) => current.id === dataSet.id)?.sha256 !== dataSet.sha256);
  if (changed) return `The data set ${changed.name} changed since this run.`;
  if (input.runs.inProgress) return "A run is in progress.";
  if (input.runs.readiness?.state !== "ready") return "k6 is not ready on the machine running ApiPilot.";
  return null;
}

/**
 * The inputs of the run screens: the plan, what was derived from it, the chosen environment, the
 * script, and the plan's runs (FR-031, FR-035; constitution XVII). Starting a run is the engineer's
 * explicit act and happens on the Run setup tab (`RunLaunchCard`), which names the target, the chains,
 * the hosts and every write; this tab reads what ran. Run again repeats the newest ended run only
 * while its script and data are unchanged; restoring a run's plan never starts one.
 */
export type ChainRunProps = Readonly<{
  plan: ChainPlan;
  analysis: ChainPlanAnalysis;
  script: ScriptStatus | null;
  environment: Environment | null;
  environments: readonly Environment[];
  runs: Runs;
  runsClient: PerformanceRunsClient<ChainRun, ChainRunSummary, string>;
  dirty: boolean;
  onRestore: (runId: string, into: "plan" | "new-plan") => void;
}>;

/** The chains a run summary lists. The Debug run runs every chain once; the load run skips a chain whose steps all run once before load. */
export function summarizeChains(plan: ChainPlan): { id: string; name: string; steps: readonly unknown[]; note?: string }[] {
  return plan.chains
    .filter((chain) => chain.steps.length > 0)
    .map((chain) => (chain.steps.some((step) => step.runs !== "once-before-load") ? chain : { ...chain, note: "once before load only; not in the load run" }));
}

const SECTION_LABEL = "text-xs font-semibold uppercase tracking-wide text-muted";
const FULL_BUTTON = "w-full justify-center text-center";

/**
 * The Runs & reports tab (AP-040): the plan's runs and the open report on the left, and on the right
 * the run in progress with Cancel, the last run with Run again, and Restore. Starting a run is on Run
 * setup; the last run's card links there.
 */
export function ChainRunPanel({ plan, script, environments, runs, runsClient, onRestore, onGoToSetup }: ChainRunProps & Readonly<{ onGoToSetup: () => void }>) {
  const latest = runs.latestFinished;
  const againBlocked = latest ? runAgainBlockedReason(latest, { plan, script, environments, runs }) : null;
  const latestEnvironment = latest ? environments.find((candidate) => candidate.id === latest.environment.id) : undefined;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <section aria-labelledby="chain-runs-title" className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="px-5 py-4">
            <h3 id="chain-runs-title" className="text-base font-semibold">
              Runs of this plan
            </h3>
            <p className="text-xs text-muted">Open a run to read its report. Reports are rendered by the server and never run scripts.</p>
          </div>
          {runs.runs.length === 0 ? (
            <p className="border-t border-border px-5 py-4 text-sm text-muted">No runs yet. Start one from Run setup.</p>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Runs of this plan</caption>
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Started</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Environment</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold"><span className="sr-only">Report</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border border-t border-border">
                  {runs.runs.map((summary) => {
                    const open = summary.id === runs.reportRunId;
                    return (
                      <tr key={summary.id} className={open ? "bg-brand-50 dark:bg-brand-500/10" : ""}>
                        <td className="px-5 py-3 font-mono text-xs">{new Date(summary.startedAt).toLocaleString()}</td>
                        <td className="px-5 py-3">{summary.environment.name}</td>
                        <td className="px-5 py-3">
                          <StatusBadge label={summary.failure?.category === "setup-step-failed" ? "Failed: a Once before load step failed" : STATUS_TEXT[summary.status]} tone={STATUS_TONE[summary.status]} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          {open ? (
                            <span aria-current="true" className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                              Viewing report
                            </span>
                          ) : (
                            summary.status !== "in-progress" && (
                              <button type="button" className={BUTTON_STYLES.ghost} onClick={() => runs.showReport(summary.id)}>
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
        </section>

        {runs.reportRunId && (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <PerformanceReportFrame client={runsClient} runId={runs.reportRunId} />
          </div>
        )}
      </div>

      <aside aria-label="Run actions" className="space-y-4 lg:sticky lg:top-4">
        {(runs.inProgress || runs.error) && (
          <section aria-labelledby="chain-active-run-title" className="space-y-3 rounded-2xl border border-border bg-surface p-5">
            <h3 id="chain-active-run-title" className={SECTION_LABEL}>
              {runs.inProgress ? "Run in progress" : "Run"}
            </h3>
            {runs.run && runs.inProgress && (
              <p className="text-sm" role="status">
                Running · {Math.round((runs.run.progress?.elapsedMs ?? 0) / 1000)} s · {runs.run.progress?.requestsSoFar ?? 0} requests · {runs.run.progress?.failuresSoFar ?? 0} failures
              </p>
            )}
            {runs.inProgress && (
              <button type="button" className={`${BUTTON_STYLES.danger} ${FULL_BUTTON}`} disabled={runs.cancelling} onClick={() => void runs.cancel()}>
                {runs.cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            )}
            {runs.error && <ErrorState message={runs.error} testId="chain-run-error" />}
          </section>
        )}

        <section aria-labelledby="chain-last-run-title" className="space-y-3 rounded-2xl border border-border bg-surface p-5">
          <h3 id="chain-last-run-title" className={SECTION_LABEL}>
            Last run
          </h3>
          {latest ? (
            <>
              <p className="text-base font-semibold">{new Date(latest.startedAt).toLocaleString()}</p>
              <p className="flex flex-wrap gap-1.5">
                <StatusBadge label={STATUS_TEXT[latest.status]} tone={STATUS_TONE[latest.status]} />
                <StatusBadge label={latestEnvironment?.name ?? latest.environment.name} />
              </p>
              <div className="space-y-2 pt-1">
                <button type="button" className={`${BUTTON_STYLES.primary} ${FULL_BUTTON} py-2.5`} disabled={againBlocked !== null || runs.starting} onClick={() => void runs.start(latest.environment.id)}>
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
        </section>

        {latest && (
          <section aria-labelledby="chain-restore-title" className="space-y-3 rounded-2xl border border-border bg-surface p-5">
            <h3 id="chain-restore-title" className={SECTION_LABEL}>
              Restore this run&apos;s plan
            </h3>
            <p className="text-left text-xs text-muted hyphens-none">Restoring generates the script; it never starts a run.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON_STYLES.secondary} disabled={runs.inProgress} onClick={() => onRestore(latest.id, "plan")}>
                Into this plan
              </button>
              <button type="button" className={BUTTON_STYLES.secondary} onClick={() => onRestore(latest.id, "new-plan")}>
                As a new plan
              </button>
            </div>
          </section>
        )}

        <p className="rounded-2xl border border-border bg-surface p-4 text-left text-xs text-muted hyphens-none">
          Run again is offered only while the script, environment and data sets are unchanged since this run. When it is blocked, the reason appears here in words.
        </p>
      </aside>
    </div>
  );
}
