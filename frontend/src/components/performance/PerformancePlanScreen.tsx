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
import { JourneyList, type ListRequest } from "./JourneyList";
import { LoadProfileEditor } from "./LoadProfileEditor";
import { PendingBar, type PendingItem } from "./PendingBar";
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
import { WriteOperationSummary, writeCountLabel } from "./WriteOperationSummary";

/**
 * The one performance plan screen (AP-029's stage body, shared with AP-032's quick performance
 * test; specs/032-quick-performance-test FR-012a, research Q16): plan, script and runs for one
 * plan source. Opening it calls `GET /plan` through `client` (on the guided path that builds the
 * plan and makes the stage active). Every edit goes to the server, which validates it; this
 * component shows the result.
 *
 * Layout, in the order a test is prepared: a pending bar above the tabs says what still blocks a
 * run, with the action that fixes each item; the Plan tab holds the operations table at full
 * width; the Run setup tab holds the environment, load profile, thresholds and script beside the
 * run trigger; and the Runs & reports tab holds live progress, the report and the session's runs.
 * Starting a run switches to Runs & reports, where the live run repeats its target (AP-029
 * FR-025).
 */
type PlanTab = "plan" | "setup" | "runs";

const RUN_TITLE_ID = "performance-run-title";
const ENVIRONMENT_TITLE_ID = "performance-environment-title";

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
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [tab, setTab] = useState<PlanTab>("plan");
  // A heading to move focus to once the tab it is on is shown (the pending bar's actions).
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const runs = usePerformanceRuns(client);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

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
  const goTo = (next: PlanTab, focusId?: string) => {
    setTab(next);
    if (focusId) setFocusTarget(focusId);
  };
  const nextNonce = (current: ListRequest | null) => (current?.nonce ?? 0) + 1;
  const showNeedsStatus = () => {
    setTab("plan");
    setListRequest((current) => ({ kind: "show-needs-status", nonce: nextNonce(current) }));
  };
  const openOperation = (operationKey: string) => {
    setTab("plan");
    setListRequest((current) => ({ kind: "open-operation", operationKey, nonce: nextNonce(current) }));
  };
  const setStatusOf = (stepId: string) => {
    setTab("plan");
    setListRequest((current) => ({ kind: "set-status", stepId, nonce: nextNonce(current) }));
  };

  // Each setup section's state and what still blocks a run, derived here rather than in JSX (§43).
  const missingValues = values.filter((value) => !value.present).length;
  let environmentState: SetupItemState = "todo";
  if (environment) environmentState = missingValues > 0 ? "attention" : "done";
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

  const pending: PendingItem[] = [];
  if (noOperations) {
    pending.push({
      id: "operations",
      state: "attention",
      text: "Every operation was removed. Restore at least one in the Plan tab.",
      action: { label: "Show the plan", onClick: () => goTo("plan") },
    });
  } else if (steps.length === 0) {
    pending.push({
      id: "operations",
      state: "attention",
      text: "No operation in scope has a positive scenario, so there is nothing to test.",
    });
  }
  if (needsStatus.length > 0) {
    pending.push({
      id: "statuses",
      state: "attention",
      text: `${needsStatus.length === 1 ? "1 step needs" : `${needsStatus.length} steps need`} an expected status before the script can be generated.`,
      action: { label: "Show them", ariaLabel: "Show the steps that need an expected status", onClick: showNeedsStatus },
      // AP-032 edge case: the steps needing a status are a counted list, each reachable from it.
      detail: (
        <CountedOperationList
          label={(count) => `${count} step${count === 1 ? "" : "s"} to set`}
          collapseAbove={0}
          testId="performance-needs-status-list"
          entries={plan.stepsNeedingExpectedStatus.map((stepId) => ({
            operationKey: stepLabel(stepId),
            action: (
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                onClick={() => setStatusOf(stepId)}
                aria-label={`Set the expected status of ${stepLabel(stepId)}`}
              >
                Set status
              </button>
            ),
          }))}
        />
      ),
    });
  }
  if (!environment) {
    pending.push({
      id: "environment",
      state: "todo",
      text:
        environments.length === 0
          ? "No target environment yet. It holds the base URL, credentials and values the run needs."
          : "Choose a target environment.",
      action: {
        label: environments.length === 0 ? "Create one" : "Choose",
        ariaLabel: "Set up the target environment",
        onClick: () => goTo("setup", ENVIRONMENT_TITLE_ID),
      },
    });
  }
  if (!script || script.outOfDate) {
    pending.push({
      id: "script",
      state: script?.outOfDate ? "attention" : "todo",
      text: script?.outOfDate
        ? "The k6 script is out of date: the plan changed after it was generated."
        : "The k6 script has not been generated.",
      action: {
        label: script ? "Regenerate" : "Generate",
        ariaLabel: script ? "Regenerate the k6 script" : "Generate the k6 script",
        onClick: () => void handleGenerate(),
        disabled: busy || generateBlockedReason !== null,
      },
      hint: generateBlockedReason ? "Once the steps above are done." : undefined,
    });
  }
  if (runs.readiness?.state === "unavailable") {
    pending.push({
      id: "k6",
      state: "attention",
      text: "k6 is not available on the machine running the ApiPilot backend.",
      action: { label: "See why", onClick: () => goTo("setup", RUN_TITLE_ID) },
    });
  }
  const setupPending = pending.filter((item) => item.id !== "operations" && item.id !== "statuses").length;
  const ready =
    pending.length === 0 && environment && runs.readiness?.state === "ready" && !runs.inProgress
      ? {
          text: `Ready to run on ${environment.name} (${environment.tier}) · ${writeSummary.total > 0 ? writeCountLabel(writeSummary.total) : "read requests only"}`,
          action: { label: "Go to run →", onClick: () => goTo("setup", RUN_TITLE_ID) },
        }
      : null;
  const notes =
    environment && missingValues > 0
      ? [
          <>
            {missingValues} of {values.length} values are missing in {environment.name}. Those steps
            are not sent and are reported as missing data.{" "}
            <button
              type="button"
              className={BUTTON_STYLES.ghost}
              onClick={() => goTo("setup", ENVIRONMENT_TITLE_ID)}
            >
              Review values
            </button>
          </>,
        ]
      : [];

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

      <PendingBar
        items={pending}
        ready={ready}
        idleText={runs.readiness === null ? "Checking whether k6 is ready…" : undefined}
        running={runs.inProgress ? { label: "View progress", onClick: () => goTo("runs") } : null}
        notes={notes}
      />

      <Tabs
        label="Performance test"
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "setup", label: setupPending > 0 ? `Run setup (${setupPending} to do)` : "Run setup" },
          { id: "runs", label: `Runs & reports (${runs.runs.length})` },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      <section
        hidden={tab !== "plan"}
        className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
        aria-labelledby="performance-journeys-title"
      >
        <div className="space-y-1">
          <h3 id="performance-journeys-title" className="text-base font-semibold">
            Operations
          </h3>
          {scopeNote({ plan, busy, apply })}
        </div>

        <WriteOperationSummary
          summary={writeSummary}
          variant="plan"
          listId={writeListId}
          onSelect={openOperation}
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
          <div className="space-y-3">
            {plan.excludedOperationKeys.length > 0 && (
              <div className="space-y-1.5">
                <CountedOperationList
                  label={(count) => `${count} operation${count === 1 ? "" : "s"} removed`}
                  columns
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
                      void apply({ excludedOperationKeys: [] }, "Every removed operation restored.")
                    }
                  >
                    Restore all
                  </button>
                )}
              </div>
            )}
            <CountedOperationList
              label={(count) => `${count} operation${count === 1 ? "" : "s"} left out`}
              columns
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
            listRequest={listRequest}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
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
          <button type="button" className={BUTTON_STYLES.primary} onClick={() => goTo("setup")}>
            Next: Run setup →
          </button>
        </div>
      </section>

      <div
        hidden={tab !== "setup"}
        className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]"
      >
        <div className="min-w-0 space-y-4">
          <SetupItem
            state={environmentState}
            title="Target environment and values"
            titleId={ENVIRONMENT_TITLE_ID}
            summary={
              environment && missingValues > 0
                ? `${missingValues} of ${values.length} values missing in ${environment.name}.`
                : undefined
            }
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
            state="done"
            title="Load profile"
            titleId="performance-profile-title"
            summary={`${loadProfileSummary(plan.loadProfile)}. Every virtual user runs every journey, in plan order, on each iteration; negative scenarios are never run under load.`}
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
          >
            <ThresholdEditor
              thresholds={plan.thresholds}
              steps={steps.map((step) => ({ id: step.id, label: step.operationKey }))}
              busy={busy}
              onSave={(thresholds) => void apply({ thresholds })}
            />
          </SetupItem>

          <SetupItem
            state={scriptState}
            title="k6 script"
            titleId="performance-script-title"
            summary={scriptSummary}
          >
            {script?.outOfDate && <StatusBadge label="Out of date — regenerate" tone="warning" />}
            {script && !script.outOfDate && (
              <p className="text-sm">
                <StatusBadge label="Script current" tone="success" />{" "}
                <span className="font-mono text-xs">sha256 {script.scriptSha256.slice(0, 12)}…</span>
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
              {needsStatus.length > 0 && (
                <button type="button" className={BUTTON_STYLES.ghost} onClick={showNeedsStatus}>
                  Show the steps
                </button>
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
              The same plan always gives a byte-identical script. It never contains a secret; values
              reach k6 only at run time.
            </p>
          </SetupItem>
        </div>

        <section
          aria-labelledby={RUN_TITLE_ID}
          className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4 xl:sticky xl:top-4"
        >
          <h3
            id={RUN_TITLE_ID}
            tabIndex={-1}
            className="rounded text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Run
          </h3>
          <PerformanceRunTrigger
            runs={runs}
            plan={plan}
            script={script}
            environment={environment}
            onStarted={() => setTab("runs")}
            onSelectOperation={openOperation}
          />
          <p className="text-xs text-muted">
            Planned duration {formatDuration(plan.loadProfile.plannedDurationMs)}. Nothing is sent
            to the target until you press Run.
          </p>
        </section>
      </div>

      <div hidden={tab !== "runs"}>
        <PerformanceRunActivity runs={runs} client={client} plan={plan} />
      </div>
    </div>
  );
}
