import type { Environment, K6Readiness, PerformancePlan, PerformanceRun, ScriptStatus } from "@apipilot/shared-domain";
import { summarizeWriteOperations } from "@apipilot/shared-domain";
import type { PerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "./PerformanceReportFrame";
import { READINESS_REASON, TIER_TONE, formatDuration, runStatusLabel } from "./performanceViewModel";
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

/** Why the trigger is disabled, or `null` when a run can start. */
function runBlockedReason(script: ScriptStatus | null, environment: Environment | null, readiness: K6Readiness | null, inProgress: boolean): string | null {
  if (!script) return "Generate the script first.";
  if (script.outOfDate) return "The plan changed after the script was generated. Regenerate it to run.";
  if (!environment) return "Choose a target environment.";
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

function runTarget(run: PerformanceRun | null, environment: Environment | null) {
  return run?.environment ?? (environment ? { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl } : null);
}

export function PerformanceRunTrigger({
  runs,
  plan,
  script,
  environment,
  onStarted,
  onSelectOperation,
}: Readonly<{
  runs: PerformanceRuns;
  plan: PerformancePlan;
  script: ScriptStatus | null;
  environment: Environment | null;
  onStarted?: () => void;
  /** Opens a write operation's details in the plan's table. */
  onSelectOperation?: (operationKey: string) => void;
}>) {
  const { readiness, checking, checkReadiness, run, inProgress, starting, error, start } = runs;
  const blockedReason = runBlockedReason(script, environment, readiness, inProgress);
  const target = runTarget(run, environment);
  const stages = plan.loadProfile.stages;
  const peak = Math.max(0, ...stages.map((stage) => stage.targetVirtualUsers));

  async function handleStart() {
    if (!environment) return;
    if (await start(environment.id)) onStarted?.();
  }

  let triggerLabel = "Run performance test";
  if (starting) triggerLabel = "Starting…";
  else if (target) triggerLabel = `Run on ${target.name} (${target.tier})`;

  const trigger = (
    <>
      {/* AP-032 FR-011: every write operation this run sends, next to the trigger that names the target. */}
      <WriteOperationSummary summary={summarizeWriteOperations(plan.journeys)} variant="trigger" onSelect={onSelectOperation} />
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

export function PerformanceRunActivity({
  runs,
  client,
  plan,
}: Readonly<{
  runs: PerformanceRuns;
  client: PerformanceClient;
  plan: PerformancePlan;
}>) {
  const { run, inProgress, runs: history, reportRunId, showReport, cancelling, cancel } = runs;
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
