import { useState } from "react";
import type { Environment, K6Readiness, PerformancePlan, PerformanceRun, PerformanceRunSummary, ScriptStatus } from "@apipilot/shared-domain";
import { summarizeWriteOperations } from "@apipilot/shared-domain";
import type { PerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "./PerformanceReportFrame";
import { READINESS_REASON, TIER_TONE, formatDuration, runStatusLabel } from "./performanceViewModel";
import type { RestoreOutcome } from "./restoreFromRun";
import type { PerformanceRuns } from "./usePerformanceRuns";
import { WriteOperationSummary } from "./WriteOperationSummary";

/**
 * The run trigger and the run activity (FR-024 to FR-031, FR-034a, FR-035), both driven by one
 * `usePerformanceRuns` state. The trigger sits in the plan's run-setup column and names its target;
 * the target, load origin and every write operation the run sends (AP-032 FR-011) are shown beside
 * it, and the live run repeats the target for as long as it runs. No confirmation step is added on
 * any tier (FR-025).
 */
const LOAD_ORIGIN = "Load is generated from the machine running the ApiPilot backend.";

/**
 * A rerun promises the same test: generation is byte-deterministic (FR-020), so an equal script
 * hash means the plan is unchanged since that run. A plan rebuilt since (for example after a
 * backend restart, which loses the plan) has no script or a different one.
 */
function planChangedSince(script: ScriptStatus | null, run: PerformanceRunSummary): boolean {
  return !script || script.outOfDate || script.scriptSha256 !== run.scriptSha256;
}

/** Why the trigger is disabled, or `null` when a run can start. */
function runBlockedReason(
  script: ScriptStatus | null,
  environment: Environment | null,
  readiness: K6Readiness | null,
  inProgress: boolean,
  rerunOf: PerformanceRunSummary | undefined,
): string | null {
  // Checked first, so a rebuilt plan says so rather than only asking for a script.
  if (rerunOf && planChangedSince(script, rerunOf)) return `The plan changed since run ${rerunOf.id.slice(0, 8)}.`;
  if (!script) return "Generate the script first.";
  if (script.outOfDate) return "The plan changed after the script was generated. Regenerate it to run.";
  if (!environment) return rerunOf ? `The environment run ${rerunOf.id.slice(0, 8)} used no longer exists.` : "Choose a target environment.";
  if (readiness?.state !== "ready") return "k6 is not available.";
  if (inProgress) return "A run is in progress.";
  return null;
}

function ReadinessBadge({ readiness }: Readonly<{ readiness: K6Readiness | null }>) {
  if (readiness === null) return <StatusBadge label="Checking k6…" />;
  if (readiness.state !== "ready") return <StatusBadge label="k6 unavailable" tone="danger" />;
  return (
    <>
      <StatusBadge label="k6 ready" tone="success" />
      <span className="font-mono text-xs">v{readiness.version}</span>
    </>
  );
}

/**
 * The live run's recorded target while it runs, otherwise the environment the trigger starts on. An
 * ended run's environment is never shown, so the trigger cannot name one target and start another
 * (FR-025).
 */
function runTarget(run: PerformanceRun | null, environment: Environment | null) {
  if (run?.status === "in-progress") return run.environment;
  return environment ? { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl } : null;
}

export function PerformanceRunTrigger({
  runs,
  plan,
  script,
  environment,
  onStarted,
  onSelectOperation,
  rerunOf,
}: Readonly<{
  runs: PerformanceRuns;
  plan: PerformancePlan;
  script: ScriptStatus | null;
  environment: Environment | null;
  onStarted?: () => void;
  /** Opens a write operation's details in the plan's table. */
  onSelectOperation?: (operationKey: string) => void;
  /** The ended run this trigger repeats; it then runs only while the script is unchanged since. */
  rerunOf?: PerformanceRunSummary;
}>) {
  const { readiness, checking, checkReadiness, run, inProgress, starting, error, start } = runs;
  const blockedReason = runBlockedReason(script, environment, readiness, inProgress, rerunOf);
  const target = runTarget(run, environment);
  const stages = plan.loadProfile.stages;
  const peak = Math.max(0, ...stages.map((stage) => stage.targetVirtualUsers));

  async function handleStart() {
    if (!environment) return;
    if (await start(environment.id)) onStarted?.();
  }

  const incomplete = plan.journeys.filter((journey) => journey.incompleteReason !== undefined);
  let triggerLabel = "Run performance test";
  if (starting) triggerLabel = "Starting…";
  else if (target) triggerLabel = `${rerunOf ? "Run again" : "Run"} on ${target.name} (${target.tier})`;

  const trigger = (
    <>
      {/* AP-032 FR-011: every write operation this run sends, next to the trigger that names the target. */}
      <WriteOperationSummary summary={summarizeWriteOperations(plan.journeys)} variant="trigger" onSelect={onSelectOperation} />
      {/* AP-035 FR-025: a journey the script leaves out is named where the run starts. */}
      {incomplete.length > 0 && (
        <p className="text-xs" data-testid="run-trigger-incomplete">
          <StatusBadge label="Not run" tone="warning" />{" "}
          {incomplete.map((journey) => `${journey.source.kind === "user" ? journey.source.name : journey.id} (incomplete: ${journey.incompleteReason!.missingOperationKeys.join(", ")} not in the plan)`).join("; ")}
        </p>
      )}
      <button type="button" className={`${BUTTON_STYLES.primary} w-full py-2`} disabled={blockedReason !== null || starting} onClick={() => void handleStart()}>
        {triggerLabel}
      </button>
      {blockedReason && <p className="text-center text-xs text-muted">{blockedReason}</p>}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ReadinessBadge readiness={readiness} />
        <button type="button" className={`${BUTTON_STYLES.ghost} ml-auto`} disabled={checking} onClick={() => void checkReadiness(true)}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
      {readiness?.state === "unavailable" && (
        <ErrorState message={READINESS_REASON[readiness.reason]} detail={readiness.detail} testId="k6-readiness-error">
          <p className="text-xs">The script can still be downloaded and run outside ApiPilot.</p>
        </ErrorState>
      )}

      {target ? (
        <section aria-label="Run target" className="space-y-3 rounded-md border border-brand-500 bg-brand-50 p-3 dark:bg-brand-500/10">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">TARGET</span>
              <span className="font-semibold">{target.name}</span>
              <StatusBadge label={`Tier: ${target.tier}`} tone={TIER_TONE[target.tier]} />
            </div>
            <p className="break-all font-mono text-xs">{target.baseUrl}</p>
            <p className="text-xs">{LOAD_ORIGIN}</p>
            <p className="text-xs text-muted">
              {plan.loadProfile.kind} · {stages.length} stages · {formatDuration(plan.loadProfile.plannedDurationMs)} · peak {peak} VUs:{" "}
              {stages.map((stage) => `${stage.durationMs / 1000} s → ${stage.targetVirtualUsers}`).join(", ")}
            </p>
          </div>
          {trigger}
        </section>
      ) : (
        <div className="space-y-3">{trigger}</div>
      )}
      {error && <ErrorState message={error} testId="performance-run-error" />}
    </div>
  );
}

/**
 * FR-024a, FR-024b (amended 2026-09-30): repeats the newest ended run. When the plan changed since
 * (it is in memory only, so a backend restart rebuilds it), the run's recorded settings can be
 * restored first; the user still starts the run.
 */
function RunAgain({
  runs,
  plan,
  script,
  lastRun,
  environment,
  onSelectOperation,
  onRestore,
}: Readonly<{
  runs: PerformanceRuns;
  plan: PerformancePlan;
  script: ScriptStatus | null;
  lastRun: PerformanceRunSummary;
  environment: Environment | null;
  onSelectOperation?: (operationKey: string) => void;
  onRestore?: (runId: string) => Promise<RestoreOutcome>;
}>) {
  const [restoring, setRestoring] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const run = lastRun.id.slice(0, 8);
  const changed = planChangedSince(script, lastRun);

  async function restore() {
    if (!onRestore) return;
    setRestoring(true);
    setOutcome(await onRestore(lastRun.id));
    setRestoring(false);
  }

  return (
    <section aria-labelledby="rerun-title" className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div className="space-y-1">
        <h3 id="rerun-title" className="text-base font-semibold">
          Run again
        </h3>
        <p className="text-sm text-muted">
          Repeats run <span className="font-mono">{run}</span> with the same script (<span className="font-mono">{lastRun.scriptSha256.slice(0, 8)}</span>) on the same
          environment. The environment&apos;s values are read as they are now.
        </p>
      </div>
      {changed && onRestore && (
        <div className="space-y-2 rounded-md border border-warning-500 bg-warning-50 p-3 text-sm dark:bg-warning-500/10">
          <p>
            The current plan is not the one run <span className="font-mono">{run}</span> used. A backend restart, a new upload or a reset rebuilds the plan with its
            defaults. Restore that run&apos;s removed operations, order, load profile, think time, thresholds and expected statuses to run it again, or start the
            current plan from Run setup.
          </p>
          <button type="button" className={BUTTON_STYLES.secondary} disabled={restoring} onClick={() => void restore()}>
            {restoring ? "Restoring…" : `Restore run ${run}'s settings`}
          </button>
        </div>
      )}
      {outcome && (
        <p role="status" data-testid="rerun-restore-outcome" className={outcome.ok ? "text-sm" : "text-sm text-danger-700 dark:text-danger-100"}>
          {outcome.message}
        </p>
      )}
      <PerformanceRunTrigger runs={runs} plan={plan} script={script} environment={environment} onSelectOperation={onSelectOperation} rerunOf={lastRun} />
    </section>
  );
}

export function PerformanceRunActivity({
  runs,
  client,
  plan,
  script,
  environments,
  onSelectOperation,
  onRestore,
}: Readonly<{
  runs: PerformanceRuns;
  client: PerformanceClient;
  plan: PerformancePlan;
  script: ScriptStatus | null;
  /** The session's environments, to resolve the last run's environment as it is now. */
  environments: readonly Environment[];
  onSelectOperation?: (operationKey: string) => void;
  /** Rebuilds a past run's settings on the current plan and generates the script (FR-024b). */
  onRestore?: (runId: string) => Promise<RestoreOutcome>;
}>) {
  const { run, inProgress, runs: history, reportRunId, showReport, cancelling, cancel } = runs;
  // Newest first (contract). A rerun is the user's explicit trigger like any other (FR-024).
  const lastRun = history[0]?.status === "in-progress" ? undefined : history[0];
  const stepsById = new Map(plan.journeys.flatMap((journey, journeyIndex) => journey.steps.map((step, stepIndex) => [step.id, { step, where: `J${journeyIndex + 1} · ${stepIndex + 1}` }])));
  const progress = run?.progress;
  const elapsedMs = progress?.elapsedMs ?? 0;
  const plannedMs = run?.plannedDurationMs ?? plan.loadProfile.plannedDurationMs;

  return (
    <div className="space-y-5">
      {run && inProgress && (
        <section aria-labelledby="live-run-title" className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 id="live-run-title" className="text-base font-semibold">
                Run <span className="font-mono">{run.id.slice(0, 8)}</span>
              </h3>
              <StatusBadge {...runStatusLabel(run)} />
            </div>
            <button type="button" className={BUTTON_STYLES.danger} disabled={cancelling || run.cancelRequested} onClick={() => void cancel()}>
              {cancelling || run.cancelRequested ? "Cancelling…" : "Cancel run"}
            </button>
          </div>
          {/* AP-029 FR-025: the target stays on screen throughout the run. */}
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="live-run-target">
            <span className="text-xs font-semibold text-muted">TARGET</span>
            <span className="font-semibold">{run.environment.name}</span>
            <StatusBadge label={`Tier: ${run.environment.tier}`} tone={TIER_TONE[run.environment.tier]} />
            <span className="break-all font-mono text-xs">{run.environment.baseUrl}</span>
            <span className="text-xs text-muted">{LOAD_ORIGIN}</span>
          </p>
          <div>
            <div className="mb-1.5 text-sm">
              <strong className="font-mono">{formatDuration(elapsedMs)}</strong> <span className="text-muted">elapsed of</span>{" "}
              <strong className="font-mono">{formatDuration(plannedMs)}</strong> <span className="text-muted">planned</span>
            </div>
            <div role="progressbar" aria-label="Elapsed time" aria-valuemin={0} aria-valuemax={Math.round(plannedMs / 1000)} aria-valuenow={Math.round(elapsedMs / 1000)} className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="h-full bg-brand-600 dark:bg-brand-400" style={{ width: `${Math.min(100, (100 * elapsedMs) / Math.max(1, plannedMs))}%` }} />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Virtual users", progress?.currentVirtualUsers ?? 0],
              ["Requests so far", progress?.requestsSoFar ?? 0],
              ["Failures", progress?.failuresSoFar ?? 0],
              ["Journeys cut short", progress?.journeysCutShortSoFar ?? 0],
              ["Token refreshes", progress?.tokenRefreshesSoFar ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-chrome p-3">
                <dt className="text-xs font-semibold text-muted">{label}</dt>
                <dd className="font-mono text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {progress && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Progress by step</caption>
                <thead>
                  <tr className="bg-chrome text-left text-xs text-muted">
                    <th scope="col" className="px-3 py-2 font-semibold">Step</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Requests</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Failures</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Not sent</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.steps.map((entry) => {
                    const known = stepsById.get(entry.stepId);
                    const notSent = [
                      entry.notSent.missingData > 0 ? `Missing data × ${entry.notSent.missingData}` : "",
                      entry.notSent.dependencyNotAttempted > 0 ? `Dependency not attempted × ${entry.notSent.dependencyNotAttempted}` : "",
                    ].filter(Boolean);
                    return (
                      <tr key={entry.stepId} className="border-t border-border">
                        <td className="px-3 py-2">
                          {known ? (
                            <span className="flex items-center gap-2">
                              <HttpMethodBadge method={known.step.method} />
                              <span className="font-mono text-xs">{known.step.path}</span>
                              <span className="text-xs text-muted">{known.where}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-xs">{entry.stepId}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{entry.requests}</td>
                        <td className="px-3 py-2 text-right font-mono">{entry.failures}</td>
                        <td className="px-3 py-2 text-xs">{notSent.length > 0 ? notSent.join(" · ") : <span className="text-muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">The run continues on the server if you close this page. The report opens here automatically when it ends.</p>
        </section>
      )}

      {lastRun && !inProgress && (
        <RunAgain
          key={lastRun.id}
          runs={runs}
          plan={plan}
          script={script}
          lastRun={lastRun}
          environment={environments.find((candidate) => candidate.id === lastRun.environment.id) ?? null}
          onSelectOperation={onSelectOperation}
          onRestore={onRestore}
        />
      )}

      {reportRunId && <PerformanceReportFrame client={client} runId={reportRunId} />}

      <section aria-labelledby="performance-runs-title" className="space-y-2 rounded-lg border border-border bg-surface p-5">
        <h3 id="performance-runs-title" className="text-base font-semibold">
          Runs in this session
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No performance runs yet. Start one from the plan&apos;s run setup; its live progress shows here and the report opens when it ends.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-chrome text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2 font-semibold">Run</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Environment</th>
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
