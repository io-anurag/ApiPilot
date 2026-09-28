import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Environment,
  K6Readiness,
  PerformancePlan,
  PerformanceRun,
  PerformanceRunSummary,
  ScriptStatus,
} from "@apipilot/shared-domain";
import { summarizeWriteOperations } from "@apipilot/shared-domain";
import type { PerformanceClient } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { PerformanceReportFrame } from "./PerformanceReportFrame";
import { READINESS_REASON, TIER_TONE, formatDuration, runStatusLabel } from "./performanceViewModel";
import { WriteOperationSummary } from "./WriteOperationSummary";

/**
 * Readiness, the run trigger, live progress and cancel, and run history (FR-024 to FR-031,
 * FR-034a, FR-035). The trigger names its target, and the target, load origin and every write
 * operation the run sends (AP-032 FR-011) stay on screen throughout the run. No confirmation step
 * is added on any tier (FR-025).
 */
export const RUN_POLL_INTERVAL_MS = 2_000;

export function PerformanceRunPanel({
  client,
  plan,
  script,
  environment,
  writeListId,
}: Readonly<{
  client: PerformanceClient;
  plan: PerformancePlan;
  script: ScriptStatus | null;
  environment: Environment | null;
  /** The plan screen's write list, for the trigger's link back to it. */
  writeListId?: string;
}>) {
  const { cancelRun, fetchReadiness, fetchRun, fetchRuns, startRun } = client;
  const [readiness, setReadiness] = useState<K6Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [run, setRun] = useState<PerformanceRun | null>(null);
  const [runs, setRuns] = useState<PerformanceRunSummary[]>([]);
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRuns = useCallback(async () => {
    const result = await fetchRuns();
    if (result.ok) setRuns(result.runs);
  }, [fetchRuns]);

  const checkReadiness = useCallback(async (recheck: boolean) => {
    setChecking(true);
    const result = await fetchReadiness(recheck);
    setChecking(false);
    setReadiness(result.ok ? result.readiness : null);
  }, [fetchReadiness]);

  useEffect(() => {
    void checkReadiness(false);
    void refreshRuns().then(async () => {
      const list = await fetchRuns();
      const live = list.ok ? list.runs.find((candidate) => candidate.status === "in-progress") : undefined;
      if (live) {
        const detail = await fetchRun(live.id);
        if (detail.ok) setRun(detail.run);
      }
    });
  }, [checkReadiness, refreshRuns, fetchRuns, fetchRun]);

  useEffect(() => {
    if (run?.status !== "in-progress") return undefined;
    pollTimer.current = setTimeout(async () => {
      const result = await fetchRun(run.id);
      if (!result.ok) return;
      setRun(result.run);
      if (result.run.status !== "in-progress") {
        setCancelling(false);
        setReportRunId(result.run.id);
        void refreshRuns();
      }
    }, RUN_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [run, refreshRuns, fetchRun]);

  const inProgress = run?.status === "in-progress";
  const blockedReason = !script
    ? "Generate the script first."
    : script.outOfDate
      ? "The plan changed after the script was generated. Regenerate it to run."
      : !environment
        ? "Choose a target environment."
        : readiness?.state !== "ready"
          ? "k6 is not available."
          : inProgress
            ? "A run is in progress."
            : null;

  async function handleStart() {
    if (!environment) return;
    setStarting(true);
    setError(null);
    const result = await startRun(environment.id);
    setStarting(false);
    if (!result.ok) {
      setError(result.error === "execution_in_progress" ? "Another run is in progress in this session. Nothing was sent." : result.message);
      if (result.readiness) setReadiness(result.readiness);
      return;
    }
    setReportRunId(null);
    setRun(result.run);
    void refreshRuns();
  }

  async function handleCancel() {
    if (!run) return;
    setCancelling(true);
    const result = await cancelRun(run.id);
    if (result.ok) setRun(result.run);
    else setCancelling(false);
  }

  const stepsById = new Map(plan.journeys.flatMap((journey, journeyIndex) => journey.steps.map((step, stepIndex) => [step.id, { step, where: `J${journeyIndex + 1} · ${stepIndex + 1}` }])));
  const target = run?.environment ?? (environment ? { name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl } : null);
  const stages = plan.loadProfile.stages;
  const peak = Math.max(0, ...stages.map((stage) => stage.targetVirtualUsers));
  const progress = run?.progress;
  const elapsedMs = progress?.elapsedMs ?? 0;
  const plannedMs = run?.plannedDurationMs ?? plan.loadProfile.plannedDurationMs;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {readiness === null ? (
          <StatusBadge label="Checking k6…" />
        ) : readiness.state === "ready" ? (
          <>
            <StatusBadge label="k6 ready" tone="success" />
            <span className="font-mono text-xs">v{readiness.version}</span>
          </>
        ) : (
          <StatusBadge label="k6 unavailable" tone="danger" />
        )}
        <button type="button" className={BUTTON_STYLES.ghost} disabled={checking} onClick={() => void checkReadiness(true)}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
      {readiness?.state === "unavailable" && (
        <ErrorState message={READINESS_REASON[readiness.reason]} detail={readiness.detail} testId="k6-readiness-error">
          <p className="text-xs">The script can still be downloaded and run outside ApiPilot.</p>
        </ErrorState>
      )}

      {target && (
        <section aria-label="Run target" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand-500 bg-brand-50 p-4 dark:bg-brand-500/10">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">TARGET</span>
              <span className="text-lg font-semibold">{target.name}</span>
              <StatusBadge label={`Tier: ${target.tier}`} tone={TIER_TONE[target.tier]} />
              <span className="break-all font-mono text-sm">{target.baseUrl}</span>
            </div>
            <p className="text-sm">Load is generated from the machine running the ApiPilot backend.</p>
            <p className="text-xs text-muted">
              {plan.loadProfile.kind} · {stages.length} stages · {formatDuration(plan.loadProfile.plannedDurationMs)} · peak {peak} VUs:{" "}
              {stages.map((stage) => `${stage.durationMs / 1000} s → ${stage.targetVirtualUsers}`).join(", ")}
            </p>
            {/* AP-032 FR-011: every write operation this run sends, next to the trigger that names the target. */}
            <WriteOperationSummary summary={summarizeWriteOperations(plan.journeys)} variant="trigger" listId={writeListId} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <button type="button" className={BUTTON_STYLES.primary} disabled={blockedReason !== null || starting} onClick={() => void handleStart()}>
              {starting ? "Starting…" : `Run on ${target.name} (${target.tier})`}
            </button>
            {blockedReason && <span className="text-xs text-muted">{blockedReason}</span>}
          </div>
        </section>
      )}
      {error && <ErrorState message={error} testId="performance-run-error" />}

      {run && inProgress && (
        <section aria-labelledby="live-run-title" className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 id="live-run-title" className="text-base font-semibold">
                Run <span className="font-mono">{run.id.slice(0, 8)}</span>
              </h3>
              <StatusBadge {...runStatusLabel(run)} />
            </div>
            <button type="button" className={BUTTON_STYLES.danger} disabled={cancelling || run.cancelRequested} onClick={() => void handleCancel()}>
              {cancelling || run.cancelRequested ? "Cancelling…" : "Cancel run"}
            </button>
          </div>
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

      <section aria-labelledby="performance-runs-title" className="space-y-2">
        <h3 id="performance-runs-title" className="text-base font-semibold">
          Runs in this session
        </h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">No performance runs yet.</p>
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
                {runs.map((summary) => (
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
                        <button type="button" className={BUTTON_STYLES.ghost} onClick={() => setReportRunId(summary.id)}>
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
