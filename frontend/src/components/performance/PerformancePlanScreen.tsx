import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  Environment,
  PerformancePlan,
  ScriptStatus,
  UserSuppliedValueStatus,
} from "@apipilot/shared-domain";
import {
  LOAD_PROFILE_STARTING_STAGES,
  summarizeWriteOperations,
} from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import type {
  PerformanceClient,
  PerformanceErrorResult,
  PlanUpdate,
} from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { Tabs } from "../Tabs";
import { CountedOperationList } from "./CountedOperationList";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { JourneyList, type FocusRequest } from "./JourneyList";
import { LoadProfileEditor } from "./LoadProfileEditor";
import { PerformanceRunActivity, PerformanceRunTrigger } from "./PerformanceRunPanel";
import { SetupItem, type SetupItemState } from "./SetupItem";
import { ThresholdEditor } from "./ThresholdEditor";
import {
  OMITTED_REASON_LABEL,
  formatDuration,
  loadProfileSummary,
  removalReason,
} from "./performanceViewModel";
import { usePerformanceRuns } from "./usePerformanceRuns";
import { ValuesChecklist } from "./ValuesChecklist";
import { WriteOperationSummary } from "./WriteOperationSummary";

/**
 * The one performance plan screen (AP-029's stage body, shared with AP-032's quick performance
 * test; specs/032-quick-performance-test FR-012a, research Q16): plan, script and runs for one
 * plan source. Opening it calls `GET /plan` through `client` (on the guided path that builds the
 * plan and makes the stage active). Every edit goes to the server, which validates it; this
 * component shows the result.
 *
 * Layout: a Plan tab with the operations table on the left and a sticky run-setup checklist on the
 * right (load profile, thresholds, environment, script and the run trigger, each with its state),
 * and a Runs tab with live progress, the report and the session's runs. Starting a run switches to
 * the Runs tab, where the live run repeats its target (AP-029 FR-025).
 */

type LoadState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

export interface PlanScopeContext {
  plan: PerformancePlan;
  busy: boolean;
  apply: (update: PlanUpdate, success?: string) => Promise<void>;
}

export function PerformancePlanScreen({
  client,
  title,
  lead,
  scopeNote,
  emptyState,
  onAdvanced,
  testId,
}: Readonly<{
  client: PerformanceClient;
  title: string;
  lead: ReactNode;
  /** The path's own content at the top of the operations section (guided: the selection note). */
  scopeNote: (context: PlanScopeContext) => ReactNode;
  /** Shown instead of the journey list when the plan has no journeys and nothing was removed. */
  emptyState?: ReactNode;
  onAdvanced?: () => void;
  testId: string;
}>) {
  const {
    fetchPlan,
    fetchValueStatuses,
    fetchStepRequest,
    generateScript,
    resetPlan,
    scriptDownloadUrl,
    updatePlan,
  } = client;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [plan, setPlan] = useState<PerformancePlan | null>(null);
  const [script, setScript] = useState<ScriptStatus | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  // An environments failure is shown as such, never as an empty list (CLAUDE.md §39).
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [values, setValues] = useState<UserSuppliedValueStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [tab, setTab] = useState<"plan" | "runs">("plan");
  const runs = usePerformanceRuns(client);

  const loadValues = useCallback(
    async (id: string | null) => {
      if (!id) {
        setValues([]);
        return;
      }
      const result = await fetchValueStatuses(id);
      setValues(result.ok ? result.values : []);
    },
    [fetchValueStatuses],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [planResult, environmentResult] = await Promise.all([
        fetchPlan(),
        fetchEnvironments(),
      ]);
      if (cancelled) return;
      if (!planResult.ok) {
        setState({ kind: "error", message: planResult.message });
        return;
      }
      setPlan(planResult.plan);
      setScript(planResult.script);
      const list = environmentResult.ok ? environmentResult.environments : [];
      if (!environmentResult.ok) {
        setEnvironmentError(
          environmentResult.error === "stage_not_active"
            ? "Environments open once a quick performance test exists or the guided workflow's Postman collection is generated."
            : environmentResult.message,
        );
      }
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
  }, [loadValues, onAdvanced, fetchPlan]);

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
    return (
      <ErrorState
        message="The performance plan could not be loaded."
        detail={state.kind === "error" ? state.message : undefined}
        testId="performance-plan-error"
      />
    );
  }

  const steps = plan.journeys.flatMap((journey) => journey.steps);
  const stepLabel = (stepId: string) =>
    steps.find((step) => step.id === stepId)?.operationKey ?? stepId;
  const environment =
    environments.find((candidate) => candidate.id === environmentId) ?? null;
  const needsStatus = plan.stepsNeedingExpectedStatus.map(stepLabel);
  const writeSummary = summarizeWriteOperations(plan.journeys);
  const writeListId = `${testId}-write-operations`;
  const noOperations = steps.length === 0 && plan.excludedOperationKeys.length > 0;
  let generateBlockedReason: string | null = null;
  if (noOperations) generateBlockedReason = "The plan has no operations";
  else if (steps.length === 0) generateBlockedReason = "The plan has nothing to test";
  else if (needsStatus.length > 0)
    generateBlockedReason = "Every step needs an expected status";
  const exclude = (keys: readonly string[], success: string) =>
    void apply(
      { excludedOperationKeys: [...new Set([...plan.excludedOperationKeys, ...keys])] },
      success,
    );
  const removeMethod = (method: string) => {
    const keys = [
      ...new Set(
        steps
          .filter((step) => step.method.toUpperCase() === method)
          .map((step) => step.operationKey),
      ),
    ];
    exclude(
      keys,
      `${keys.length} ${method} operation${keys.length === 1 ? "" : "s"} removed.`,
    );
  };
  const focusStep = (stepId: string) =>
    setFocusRequest((current) => ({ stepId, nonce: (current?.nonce ?? 0) + 1 }));

  // Each run-setup item's state and one-line summary, derived here rather than in JSX (§43).
  const missingValues = values.filter((value) => !value.present).length;
  const operationsState: SetupItemState =
    steps.length === 0 || needsStatus.length > 0 ? "attention" : "done";
  let environmentState: SetupItemState = "todo";
  let environmentSummary = "None chosen yet.";
  if (environment) {
    environmentState = missingValues > 0 ? "attention" : "done";
    environmentSummary =
      missingValues > 0
        ? `${environment.name} · ${missingValues} of ${values.length} values missing`
        : `${environment.name} · every value present`;
  }
  let scriptState: SetupItemState = "todo";
  let scriptSummary = "Not generated yet.";
  if (generateBlockedReason) scriptSummary = `Waiting: ${generateBlockedReason.toLowerCase()}.`;
  if (script?.outOfDate) {
    scriptState = "attention";
    scriptSummary = "Out of date: the plan changed after it was generated.";
  } else if (script) {
    scriptState = "done";
    scriptSummary = "Current.";
  }
  const thresholdCount = plan.thresholds.length;

  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="max-w-3xl text-sm text-muted">{lead}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={`${plan.journeys.length} journeys · ${steps.length} steps`} />
          <button
            type="button"
            className={BUTTON_STYLES.secondary}
            disabled={busy}
            onClick={() => void handleReset()}
          >
            Reset plan
          </button>
        </div>
      </div>
      {problem && <ErrorState message={problem} testId="performance-plan-problem" />}

      <Tabs
        label="Performance test"
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "runs", label: `Runs & reports (${runs.runs.length})` },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      <div
        hidden={tab !== "plan"}
        className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]"
      >
        <section
          className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
          aria-labelledby="performance-journeys-title"
        >
          <div className="space-y-1">
            <h3 id="performance-journeys-title" className="text-base font-semibold">
              Operations
            </h3>
            {scopeNote({ plan, busy, apply })}
            <p className="text-sm text-muted">
              One positive scenario per operation; negative scenarios are never run under load.
              Every virtual user runs every journey, in this order, on each iteration.
            </p>
          </div>

          <WriteOperationSummary
            summary={writeSummary}
            variant="plan"
            listId={writeListId}
            actions={
              writeSummary.total > 0 && (
                <button
                  type="button"
                  className={BUTTON_STYLES.secondary}
                  disabled={busy}
                  onClick={() =>
                    exclude(
                      writeSummary.operations.map((entry) => entry.operationKey),
                      `${writeSummary.total} write operations removed.`,
                    )
                  }
                >
                  Remove all write operations
                </button>
              )
            }
          />

          {(plan.excludedOperationKeys.length > 0 || plan.omitted.length > 0) && (
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {plan.excludedOperationKeys.length > 0 && (
                <div className="space-y-1.5">
                  <CountedOperationList
                    label={(count) => `${count} operation${count === 1 ? "" : "s"} removed`}
                    testId="performance-removed-list"
                    entries={plan.excludedOperationKeys.map((operationKey) => ({
                      operationKey,
                      detail: removalReason(operationKey, plan.credentialProducerOperationKeys),
                      action: (
                        <button
                          type="button"
                          className={BUTTON_STYLES.ghost}
                          disabled={busy}
                          aria-label={`Restore ${operationKey}`}
                          onClick={() =>
                            void apply(
                              {
                                excludedOperationKeys: plan.excludedOperationKeys.filter(
                                  (key) => key !== operationKey,
                                ),
                              },
                              `${operationKey} restored.`,
                            )
                          }
                        >
                          Restore
                        </button>
                      ),
                    }))}
                  />
                  {plan.excludedOperationKeys.length > 1 && (
                    <button
                      type="button"
                      className={BUTTON_STYLES.ghost}
                      disabled={busy}
                      onClick={() =>
                        void apply(
                          { excludedOperationKeys: [] },
                          "Every removed operation restored.",
                        )
                      }
                    >
                      Restore all
                    </button>
                  )}
                </div>
              )}
              <CountedOperationList
                label={(count) => `${count} operation${count === 1 ? "" : "s"} left out`}
                testId="performance-omitted-list"
                entries={plan.omitted.map((entry) => ({
                  operationKey: entry.operationKey,
                  detail: OMITTED_REASON_LABEL[entry.reason],
                }))}
              />
            </div>
          )}

          {noOperations && (
            <EmptyState
              message="The plan has no operations"
              description="Every operation was removed. Restore one to generate a script."
              testId="performance-plan-no-operations"
            />
          )}
          {!noOperations &&
            steps.length === 0 &&
            (emptyState ?? (
              <EmptyState
                message="Nothing to test"
                description="No operation in scope has a positive scenario."
                testId="performance-plan-empty"
              />
            ))}
          {steps.length > 0 && (
            <JourneyList
              loadPreview={fetchStepRequest}
              journeys={plan.journeys}
              busy={busy}
              announcement={announcement}
              onExpectedStatuses={(stepId, codes) =>
                void apply({ expectedStatuses: { [stepId]: codes } })
              }
              onRemoveOperations={exclude}
              onRemoveMethod={removeMethod}
              onStepOrder={(journeyId, stepIds) =>
                void apply({ stepOrder: { [journeyId]: stepIds } }, "Step moved.")
              }
              onJourneyOrder={(journeyIds) =>
                void apply({ journeyOrder: journeyIds }, "Journey moved.")
              }
              focusRequest={focusRequest}
            />
          )}
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>Think time between steps</span>
            <input
              type="number"
              min={0}
              step={0.5}
              defaultValue={plan.thinkTimeMs / 1000}
              key={plan.thinkTimeMs}
              disabled={busy}
              onBlur={(event) => {
                const ms = Math.round(Number(event.target.value) * 1000);
                if (Number.isFinite(ms) && ms >= 0 && ms !== plan.thinkTimeMs)
                  void apply({ thinkTimeMs: ms });
              }}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              aria-label="Think time between steps in seconds"
            />
            <span>s</span>
          </label>
        </section>

        {/* Sticky on wide screens, so what still blocks a run stays in view while the table
            scrolls. The height is bounded to the viewport (a genuine layout value, CLAUDE.md §31)
            so a long checklist scrolls inside itself instead of running off screen. */}
        <aside
          aria-labelledby="performance-setup-title"
          className="min-w-0 rounded-lg border border-border bg-surface xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
        >
          <h3
            id="performance-setup-title"
            className="border-b border-border px-4 py-3 text-base font-semibold"
          >
            Run setup
          </h3>
          <ol className="divide-y divide-border">
            <SetupItem
              state={operationsState}
              title="Operations"
              titleId="performance-setup-operations"
              summary={
                <>
                  {steps.length} step{steps.length === 1 ? "" : "s"} · {writeSummary.total}{" "}
                  write{writeSummary.total === 1 ? "" : "s"}
                  {needsStatus.length > 0 && (
                    <span className="font-medium text-warning-700 dark:text-warning-100">
                      {" · "}
                      {needsStatus.length} without an expected status
                    </span>
                  )}
                </>
              }
            />
            <SetupItem
              state="done"
              title="Load profile"
              titleId="performance-profile-title"
              summary={loadProfileSummary(plan.loadProfile)}
              collapsible
            >
              <LoadProfileEditor
                profile={plan.loadProfile}
                startingStages={(kind) =>
                  LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))
                }
                busy={busy}
                onSave={(profile) => void apply({ loadProfile: profile }, "Load profile saved.")}
              />
            </SetupItem>
            <SetupItem
              state={thresholdCount > 0 ? "done" : "optional"}
              title="Thresholds (optional)"
              titleId="performance-thresholds-title"
              summary={
                thresholdCount > 0
                  ? `${thresholdCount} threshold${thresholdCount === 1 ? "" : "s"}`
                  : "None set, so the report gives no pass/fail verdict."
              }
              collapsible
              actionLabel={thresholdCount > 0 ? "Edit" : "Add"}
            >
              <ThresholdEditor
                thresholds={plan.thresholds}
                steps={steps.map((step) => ({ id: step.id, label: step.operationKey }))}
                busy={busy}
                onSave={(thresholds) => void apply({ thresholds })}
              />
            </SetupItem>
            <SetupItem
              state={environmentState}
              title="Target environment and values"
              titleId="performance-environment-title"
              summary={environmentSummary}
            >
              {environmentError && (
                <ErrorState
                  message="The environments could not be loaded."
                  detail={environmentError}
                  testId="performance-environments-error"
                />
              )}
              <EnvironmentPicker
                environments={environments}
                selectedId={environmentId}
                suggestedNames={plan.userSuppliedValues.map((value) => value.name)}
                onSelect={(id) => {
                  setEnvironmentId(id);
                  void loadValues(id);
                }}
                onSaved={(saved) => {
                  setEnvironments((current) => [
                    ...current.filter((candidate) => candidate.id !== saved.id),
                    saved,
                  ]);
                  setEnvironmentId(saved.id);
                  void loadValues(saved.id);
                }}
              />
              {environment && <ValuesChecklist values={values} stepLabel={stepLabel} />}
            </SetupItem>
            <SetupItem
              state={scriptState}
              title="k6 script"
              titleId="performance-script-title"
              summary={scriptSummary}
            >
              {needsStatus.length > 0 && (
                <div
                  role="status"
                  className="space-y-2 rounded-md border border-warning-500 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-100"
                >
                  <p>
                    <strong>
                      {needsStatus.length === 1
                        ? "1 step needs"
                        : `${needsStatus.length} steps need`}{" "}
                      an expected status
                    </strong>{" "}
                    before the script can be generated.
                  </p>
                  <CountedOperationList
                    label={(count) => `${count} step${count === 1 ? "" : "s"} to set`}
                    testId="performance-needs-status-list"
                    entries={plan.stepsNeedingExpectedStatus.map((stepId) => ({
                      operationKey: stepLabel(stepId),
                      action: (
                        <button
                          type="button"
                          className={BUTTON_STYLES.ghost}
                          onClick={() => focusStep(stepId)}
                          aria-label={`Set the expected status of ${stepLabel(stepId)}`}
                        >
                          Set status
                        </button>
                      ),
                    }))}
                  />
                </div>
              )}
              {script?.outOfDate && <StatusBadge label="Out of date — regenerate" tone="warning" />}
              {script && !script.outOfDate && (
                <p className="text-sm">
                  <StatusBadge label="Script current" tone="success" />{" "}
                  <span className="font-mono text-xs">
                    sha256 {script.scriptSha256.slice(0, 12)}…
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={BUTTON_STYLES.primary}
                  disabled={busy || generateBlockedReason !== null}
                  onClick={() => void handleGenerate()}
                >
                  {script ? "Regenerate script" : "Generate script"}
                </button>
                {generateBlockedReason && (
                  <span data-testid="performance-generate-blocked" className="text-xs text-muted">
                    {generateBlockedReason}.
                  </span>
                )}
              </div>
              {script && !script.outOfDate && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <a className={BUTTON_STYLES.ghost} href={scriptDownloadUrl("script")} download>
                    Download script
                  </a>
                  <a
                    className={BUTTON_STYLES.ghost}
                    href={scriptDownloadUrl("environment-template")}
                    download
                  >
                    Download environment template
                  </a>
                </div>
              )}
              <p className="text-xs text-muted">
                The same plan always gives a byte-identical script. It never contains a secret;
                values reach k6 only at run time.
              </p>
            </SetupItem>
          </ol>
          <section
            aria-labelledby="performance-run-title"
            className="space-y-2 border-t border-border bg-chrome px-4 py-3 dark:bg-white/5"
          >
            <h4 id="performance-run-title" className="text-sm font-semibold">
              Run
            </h4>
            <PerformanceRunTrigger
              runs={runs}
              plan={plan}
              script={script}
              environment={environment}
              writeListId={writeListId}
              onStarted={() => setTab("runs")}
              onViewRuns={() => setTab("runs")}
            />
            <p className="text-xs text-muted">
              Planned duration {formatDuration(plan.loadProfile.plannedDurationMs)}. Nothing is
              sent to the target until you press Run.
            </p>
          </section>
        </aside>
      </div>

      <div hidden={tab !== "runs"}>
        <PerformanceRunActivity runs={runs} client={client} plan={plan} />
      </div>
    </div>
  );
}
