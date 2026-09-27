import { useCallback, useEffect, useState } from "react";
import type { Environment, PerformancePlan, ScriptStatus, UserSuppliedValueStatus } from "@apipilot/shared-domain";
import { LOAD_PROFILE_STARTING_STAGES } from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import {
  fetchPlan,
  fetchValueStatuses,
  generateScript,
  resetPlan,
  scriptDownloadUrl,
  updatePlan,
  type PerformanceErrorResult,
  type PlanUpdate,
} from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { JourneyList } from "./JourneyList";
import { LoadProfileEditor } from "./LoadProfileEditor";
import { PerformanceRunPanel } from "./PerformanceRunPanel";
import { ThresholdEditor } from "./ThresholdEditor";
import { ValuesChecklist } from "./ValuesChecklist";

/**
 * The Performance Testing stage (AP-029, specs/031-k6-performance-testing): plan, script and runs.
 * Opening it calls `GET /plan`, which builds the plan and makes this the active stage (contract).
 * Every edit goes to the server, which validates it; this component shows the result.
 */
const PANEL = "space-y-3 rounded-lg border border-border bg-surface p-5";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

export function PerformanceTestingStage({ onAdvanced }: Readonly<{ onAdvanced?: () => void }>) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [plan, setPlan] = useState<PerformancePlan | null>(null);
  const [script, setScript] = useState<ScriptStatus | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [values, setValues] = useState<UserSuppliedValueStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const loadValues = useCallback(async (id: string | null) => {
    if (!id) {
      setValues([]);
      return;
    }
    const result = await fetchValueStatuses(id);
    setValues(result.ok ? result.values : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [planResult, environmentResult] = await Promise.all([fetchPlan(), fetchEnvironments()]);
      if (cancelled) return;
      if (!planResult.ok) {
        setState({ kind: "error", message: planResult.message });
        return;
      }
      setPlan(planResult.plan);
      setScript(planResult.script);
      const list = environmentResult.ok ? environmentResult.environments : [];
      setEnvironments(list);
      const first = list[0]?.id ?? null;
      setEnvironmentId(first);
      await loadValues(first);
      setState({ kind: "ready" });
      onAdvanced?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadValues, onAdvanced]);

  function explain(result: PerformanceErrorResult): string {
    if (result.error === "dependency_order_violation" && result.variable) {
      return `That order would run a step before the step that produces ${result.variable}. The order is unchanged.`;
    }
    return result.message;
  }

  async function apply(update: PlanUpdate, success?: string) {
    setBusy(true);
    setProblem(null);
    const result = await updatePlan(update);
    setBusy(false);
    if (!result.ok) {
      setProblem(explain(result));
      setAnnouncement(explain(result));
      return;
    }
    setPlan(result.plan);
    setScript(result.script);
    if (success) setAnnouncement(success);
    void loadValues(environmentId);
    onAdvanced?.();
  }

  async function handleGenerate() {
    setBusy(true);
    setProblem(null);
    const result = await generateScript();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setScript(result.script);
    onAdvanced?.();
  }

  async function handleReset() {
    setBusy(true);
    const result = await resetPlan();
    setBusy(false);
    if (result.ok) {
      setPlan(result.plan);
      setScript(result.script);
      void loadValues(environmentId);
    } else setProblem(result.message);
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-sm text-muted">Building the performance plan…</p>
        <Skeleton className="h-40 w-full rounded bg-slate-200 dark:bg-slate-600" />
      </div>
    );
  }
  if (state.kind === "error" || !plan) {
    return <ErrorState message="The performance plan could not be loaded." detail={state.kind === "error" ? state.message : undefined} testId="performance-plan-error" />;
  }

  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const stepLabel = (stepId: string) => steps.find((step) => step.id === stepId)?.operationKey ?? stepId;
  const environment = environments.find((candidate) => candidate.id === environmentId) ?? null;
  const needsStatus = plan.stepsNeedingExpectedStatus.map(stepLabel);

  return (
    <div className="space-y-5" data-testid="performance-testing-stage">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Performance Testing</h2>
          <p className="max-w-3xl text-sm text-muted">Build a k6 load test from the approved scenarios and workflows. Nothing is sent to any system until you trigger a run.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={`${plan.journeys.length} journeys · ${steps.length} steps`} />
          <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => void handleReset()}>
            Reset plan
          </button>
        </div>
      </div>
      {problem && <ErrorState message={problem} testId="performance-plan-problem" />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="space-y-5">
          <section className={PANEL} aria-labelledby="performance-scope-title">
            <h3 id="performance-scope-title" className="text-base font-semibold">
              Operations in scope
            </h3>
            <div className="flex flex-wrap gap-5 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="performance-scope" checked={plan.scope === "selection"} disabled={busy} onChange={() => void apply({ scope: "selection" })} />
                API review selection
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="performance-scope" checked={plan.scope === "all"} disabled={busy} onChange={() => void apply({ scope: "all" })} />
                All analyzed operations
              </label>
            </div>
            <p className="text-sm text-muted">One positive scenario per operation. Negative scenarios are never run under load. Write operations are included; remove any you do not want sent to the target.</p>
            {plan.excludedOperationKeys.length > 0 && (
              <p className="text-sm">
                Removed: <span className="font-mono text-xs">{plan.excludedOperationKeys.join(", ")}</span>{" "}
                <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => void apply({ excludedOperationKeys: [] })}>
                  Restore all
                </button>
              </p>
            )}
            {plan.omitted.length > 0 && (
              <p className="text-sm text-muted">
                Left out (no positive scenario): <span className="font-mono text-xs">{plan.omitted.map((entry) => entry.operationKey).join(", ")}</span>
              </p>
            )}
          </section>

          <section className={PANEL} aria-labelledby="performance-journeys-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="performance-journeys-title" className="text-base font-semibold">
                Journeys
              </h3>
              <span className="text-sm text-muted">Every virtual user runs every journey, in this order, on each iteration.</span>
            </div>
            {steps.length === 0 ? (
              <EmptyState message="Nothing to test" description="No operation in scope has a positive scenario." testId="performance-plan-empty" />
            ) : (
              <JourneyList
                journeys={plan.journeys}
                busy={busy}
                announcement={announcement}
                onExpectedStatuses={(stepId, codes) => void apply({ expectedStatuses: { [stepId]: codes } })}
                onRemoveOperation={(operationKey) => void apply({ excludedOperationKeys: [...plan.excludedOperationKeys, operationKey] }, `${operationKey} removed from the plan.`)}
                onStepOrder={(journeyId, stepIds) => void apply({ stepOrder: { [journeyId]: stepIds } }, "Step moved.")}
                onJourneyOrder={(journeyIds) => void apply({ journeyOrder: journeyIds }, "Journey moved.")}
              />
            )}
            <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
              Think time between steps
              <input
                type="number"
                min={0}
                step={0.5}
                defaultValue={plan.thinkTimeMs / 1000}
                key={plan.thinkTimeMs}
                disabled={busy}
                onBlur={(event) => {
                  const ms = Math.round(Number(event.target.value) * 1000);
                  if (Number.isFinite(ms) && ms >= 0 && ms !== plan.thinkTimeMs) void apply({ thinkTimeMs: ms });
                }}
                className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
                aria-label="Think time between steps in seconds"
              />
              s
            </label>
          </section>
        </div>

        <div className="space-y-5">
          <section className={PANEL} aria-labelledby="performance-profile-title">
            <h3 id="performance-profile-title" className="text-base font-semibold">
              Load profile
            </h3>
            <LoadProfileEditor
              profile={plan.loadProfile}
              startingStages={(kind) => LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))}
              busy={busy}
              onSave={(profile) => void apply({ loadProfile: profile }, "Load profile saved.")}
            />
          </section>

          <section className={PANEL} aria-labelledby="performance-thresholds-title">
            <h3 id="performance-thresholds-title" className="text-base font-semibold">
              Thresholds
            </h3>
            <ThresholdEditor
              thresholds={plan.thresholds}
              steps={steps.map((step) => ({ id: step.id, label: step.operationKey }))}
              busy={busy}
              onSave={(thresholds) => void apply({ thresholds })}
            />
          </section>

          <section className={PANEL} aria-labelledby="performance-environment-title">
            <h3 id="performance-environment-title" className="text-base font-semibold">
              Target environment and values
            </h3>
            <EnvironmentPicker
              environments={environments}
              selectedId={environmentId}
              suggestedNames={plan.userSuppliedValues.map((value) => value.name)}
              onSelect={(id) => {
                setEnvironmentId(id);
                void loadValues(id);
              }}
              onSaved={(saved) => {
                setEnvironments((current) => [...current.filter((candidate) => candidate.id !== saved.id), saved]);
                setEnvironmentId(saved.id);
                void loadValues(saved.id);
              }}
            />
            {environment && <ValuesChecklist values={values} stepLabel={stepLabel} />}
          </section>

          <section className={PANEL} aria-labelledby="performance-script-title">
            <h3 id="performance-script-title" className="text-base font-semibold">
              k6 script
            </h3>
            {needsStatus.length > 0 && (
              <div role="status" className="rounded-md border border-warning-500 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-100">
                <strong>
                  {needsStatus.length === 1 ? "1 step needs" : `${needsStatus.length} steps need`} an expected status
                </strong>{" "}
                before the script can be generated: <span className="font-mono">{needsStatus.join(", ")}</span>.
              </div>
            )}
            {script?.outOfDate && <StatusBadge label="Out of date — regenerate" tone="warning" />}
            {script && !script.outOfDate && (
              <p className="text-sm">
                <StatusBadge label="Script current" tone="success" /> <span className="font-mono text-xs">sha256 {script.scriptSha256.slice(0, 12)}…</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON_STYLES.primary} disabled={busy || needsStatus.length > 0 || steps.length === 0} onClick={() => void handleGenerate()}>
                {script ? "Regenerate script" : "Generate script"}
              </button>
              {script && !script.outOfDate && (
                <>
                  <a className={BUTTON_STYLES.secondary} href={scriptDownloadUrl("script")} download>
                    Download script
                  </a>
                  <a className={BUTTON_STYLES.secondary} href={scriptDownloadUrl("environment-template")} download>
                    Download environment template
                  </a>
                </>
              )}
            </div>
            <p className="text-xs text-muted">The same plan always gives a byte-identical script. It never contains a secret; values reach k6 only at run time.</p>
          </section>
        </div>
      </div>

      <section className={PANEL} aria-labelledby="performance-run-title">
        <h3 id="performance-run-title" className="text-base font-semibold">
          Run
        </h3>
        <PerformanceRunPanel plan={plan} script={script} environment={environment} />
      </section>
    </div>
  );
}
