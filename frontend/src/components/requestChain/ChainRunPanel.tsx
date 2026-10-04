import type { ChainPlan, ChainPlanAnalysis, ChainRun, ChainRunSummary, Environment, ScriptStatus } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "../performance/PerformanceReportFrame";
import type { PerformanceRuns } from "../performance/usePerformanceRuns";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";
import { ChainDebugPanel } from "./ChainDebugPanel";
import { RunTargetSummary } from "./RunTargetSummary";

type Runs = PerformanceRuns<ChainRun, ChainRunSummary, string>;

const STATUS_TEXT: Record<ChainRun["status"], string> = { "in-progress": "In progress", completed: "Completed", cancelled: "Cancelled", failed: "Failed" };
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
 * The run trigger and the plan's runs (FR-031, FR-035; constitution XVII). The trigger names the
 * target environment by name, tier and base URL and lists the chains with their step counts, every
 * write step, every host and every data set; starting is the engineer's explicit act. Run again
 * repeats the newest ended run only while its script and data are unchanged; restoring a run's plan
 * never starts one.
 */
type ChainRunProps = Readonly<{
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

export function ChainRunPanel(props: ChainRunProps) {
  return (
    <div className="space-y-4">
      <ChainRunTrigger {...props} />
      <ChainRunHistory {...props} />
    </div>
  );
}

/**
 * The Run card: one target summary and the load run and Debug run triggers. `flush` drops its own
 * border so the Run setup tab can group it with the setup items in one card.
 */
export function ChainRunTrigger({ plan, analysis, script, environment, runs, dirty, flush = false }: ChainRunProps & Readonly<{ flush?: boolean }>) {
  const blocked = runBlockedReason({ script, analysis, environment, runs, dirty });
  // The Debug run runs every chain once; the load run skips a chain whose steps all run once before load.
  const summaryChains = plan.chains
    .filter((chain) => chain.steps.length > 0)
    .map((chain) => (chain.steps.some((step) => step.runs !== "once-before-load") ? chain : { ...chain, note: "once before load only; not in the load run" }));

  return (
      <section aria-labelledby="chain-run-title" className={`space-y-3 bg-surface p-4 ${flush ? "lg:col-span-2" : "rounded-lg border border-border"}`}>
        <h3 id="chain-run-title" className="text-sm font-semibold">
          Run
        </h3>
        <RunTargetSummary plan={plan} analysis={analysis} environment={environment} chains={summaryChains} />
        <div className="space-y-4 border-t border-border pt-3">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Load run</h4>
            <p className="text-xs text-muted">Load is generated from the machine running the ApiPilot backend. Nothing is sent until you start the run.</p>
            <div className="flex flex-wrap items-center gap-3">
              {!runs.inProgress ? (
                <button type="button" className={BUTTON_STYLES.primary} disabled={blocked !== null || runs.starting} onClick={() => environment && void runs.start(environment.id)}>
                  {runs.starting ? "Starting…" : `Start run on ${environment?.name ?? "…"}`}
                </button>
              ) : (
                <button type="button" className={BUTTON_STYLES.danger} disabled={runs.cancelling} onClick={() => void runs.cancel()}>
                  {runs.cancelling ? "Cancelling…" : "Cancel run"}
                </button>
              )}
              {blocked && !runs.inProgress && <span className="text-xs text-muted" data-testid="run-blocked">{blocked}</span>}
            </div>
            {runs.run && runs.inProgress && (
              <p className="text-sm" role="status">
                Running · {Math.round((runs.run.progress?.elapsedMs ?? 0) / 1000)} s · {runs.run.progress?.requestsSoFar ?? 0} requests · {runs.run.progress?.failuresSoFar ?? 0} failures
              </p>
            )}
            {runs.error && <ErrorState message={runs.error} testId="chain-run-error" />}
          </div>
          <div className="border-t border-border pt-3">
            <ChainDebugPanel plan={plan} analysis={analysis} environment={environment} dirty={dirty} loadRunInProgress={runs.inProgress} />
          </div>
        </div>
      </section>
  );
}

/** The plan's last run, restore controls and run list with the opened report. */
export function ChainRunHistory({ plan, script, environments, runs, runsClient, onRestore }: ChainRunProps) {
  const latest = runs.latestFinished;
  const againBlocked = latest ? runAgainBlockedReason(latest, { plan, script, environments, runs }) : null;
  const latestEnvironment = latest ? environments.find((candidate) => candidate.id === latest.environment.id) : undefined;

  return (
    <div className="space-y-4">
      {latest && (
        <section aria-labelledby="chain-last-run-title" className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h3 id="chain-last-run-title" className="text-sm font-semibold">
            Last run · {new Date(latest.startedAt).toLocaleString()}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_STYLES.secondary} disabled={againBlocked !== null || runs.starting} onClick={() => void runs.start(latest.environment.id)}>
              Run again on {latestEnvironment?.name ?? latest.environment.name}
            </button>
            {againBlocked && <span className="text-xs text-muted" data-testid="run-again-blocked">{againBlocked}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Restore this run's plan:</span>
            <button type="button" className={BUTTON_STYLES.ghost} disabled={runs.inProgress} onClick={() => onRestore(latest.id, "plan")}>
              Into this plan
            </button>
            <button type="button" className={BUTTON_STYLES.ghost} onClick={() => onRestore(latest.id, "new-plan")}>
              As a new plan
            </button>
            <span className="text-xs text-muted">Restoring generates the script; it never starts a run.</span>
          </div>
        </section>
      )}

      <section aria-labelledby="chain-runs-title" className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h3 id="chain-runs-title" className="text-sm font-semibold">
          Runs of this plan
        </h3>
        {runs.runs.length === 0 ? (
          <p className="text-sm text-muted">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">Started</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Environment</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-1 font-medium"><span className="sr-only">Report</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.runs.map((summary) => (
                  <tr key={summary.id}>
                    <td className="py-1 pr-3">{new Date(summary.startedAt).toLocaleString()}</td>
                    <td className="py-1 pr-3">{summary.environment.name}</td>
                    <td className="py-1 pr-3">
                      <StatusBadge label={summary.failure?.category === "setup-step-failed" ? "Failed: a Once before load step failed" : STATUS_TEXT[summary.status]} tone={STATUS_TONE[summary.status]} />
                    </td>
                    <td className="py-1 text-right">
                      {summary.status !== "in-progress" && (
                        <button type="button" className={BUTTON_STYLES.ghost} onClick={() => runs.showReport(summary.id)}>
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
        {runs.reportRunId && <PerformanceReportFrame client={runsClient} runId={runs.reportRunId} />}
      </section>
    </div>
  );
}
