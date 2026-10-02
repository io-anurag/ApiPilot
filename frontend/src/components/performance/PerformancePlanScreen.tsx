import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  BodyEditInput,
  ParameterEditInput,
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
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { Tabs } from "../Tabs";
import { CountedOperationList } from "./CountedOperationList";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { JourneyList, type ListRequest } from "./JourneyList";
import { LoadProfileEditor } from "./LoadProfileEditor";
import { OtherOperationsTable } from "./OtherOperationsTable";
import { PendingBar, type PendingItem } from "./PendingBar";
import { PerformanceRunActivity, PerformanceRunTrigger } from "./PerformanceRunPanel";
import { journeyStepsNotRestored, restoreOrderFromRun, restoreSettingsFromRun, type RestoreOutcome } from "./restoreFromRun";
import { SetupItem, type SetupItemState } from "./SetupItem";
import { ThresholdEditor } from "./ThresholdEditor";
import { UserJourneysPanel } from "./UserJourneysPanel";
import { journeyRefusalText } from "./userJourneysViewModel";
import {
  OMITTED_REASON_LABEL,
  formatDuration,
  loadProfileSummary,
  removalReason,
  unexpectedStatusesByStep,
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
type OperationScope = "plan" | "removed" | "left-out";

const RUN_TITLE_ID = "performance-run-title";
const ENVIRONMENT_TITLE_ID = "performance-environment-title";

type LoadState =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

export interface PlanScopeContext {
  plan: PerformancePlan;
  busy: boolean;
  /** Resolves to the refusal, or `null` when the update was saved. */
  apply: (update: PlanUpdate, success?: string) => Promise<PerformanceErrorResult | null>;
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
    fetchResponseFields,
    fetchRemovedOperation,
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
  const [confirmReset, setConfirmReset] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [tab, setTab] = useState<PlanTab>("plan");
  const [scope, setScope] = useState<OperationScope>("plan");
  // A heading to move focus to once the tab it is on is shown (the pending bar's actions).
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const runs = usePerformanceRuns(client);
  // AP-033 FR-023: steps the latest finished run answered with a status they do not expect.
  const lastRunUnexpected = useMemo(() => unexpectedStatusesByStep(runs.latestFinished?.result), [runs.latestFinished]);

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
    const stepName = (stepId: string) => plan?.journeys.flatMap((journey) => journey.steps).find((step) => step.id === stepId)?.operationKey ?? stepId;
    return journeyRefusalText(result, stepName) ?? result.message;
  }

  /**
   * Applies one plan update. Resolves to the refusal, or `null` when saved. A body edit's refusal
   * (AP-033) is shown by the step's editor, next to the text it is about, not in the screen banner.
   */
  async function apply(update: PlanUpdate, success?: string, options: { refusalShownByCaller?: boolean } = {}): Promise<PerformanceErrorResult | null> {
    setBusy(true);
    setProblem(null);
    const result = await updatePlan(update);
    setBusy(false);
    if (!result.ok) {
      if (!options.refusalShownByCaller) setProblem(explain(result));
      setAnnouncement(explain(result));
      return result;
    }
    setPlan(result.plan);
    setScript(result.script);
    if (success) setAnnouncement(success);
    void loadValues(environmentId);
    onAdvanced?.();
    return null;
  }

  const saveBody = (stepId: string, input: BodyEditInput | null) =>
    apply({ bodyEdits: { [stepId]: input } }, input ? "Body saved." : "Body reset to the generated body.", { refusalShownByCaller: true });
  const saveParameters = (stepId: string, input: ParameterEditInput | null) =>
    apply({ parameterEdits: { [stepId]: input } }, input ? "Parameters saved." : "Parameters reset to the generated parameters.", {
      refusalShownByCaller: true,
    });

  /**
   * AP-029 FR-024b (amended 2026-09-30): rebuilds a past run's settings on the current plan, then
   * generates the script. Nothing is sent to a target; the user still starts the run.
   */
  async function restoreRun(runId: string): Promise<RestoreOutcome> {
    if (!plan) return { ok: false, message: "The plan is not loaded." };
    const run = runId.slice(0, 8);
    setBusy(true);
    setProblem(null);
    try {
      const detail = await client.fetchRun(runId);
      if (!detail.ok) return { ok: false, message: detail.message };
      const snapshot = detail.run.planSnapshot;
      const restore = restoreSettingsFromRun(runId, snapshot, plan);
      if (!restore.ok) return { ok: false, message: restore.reason };
      const settled = await updatePlan(restore.settings);
      if (!settled.ok) return { ok: false, message: explain(settled) };
      let restored = settled;
      const notes: string[] = [];
      const order = restoreOrderFromRun(runId, snapshot, settled.plan);
      if (order && "reason" in order) notes.push(order.reason);
      else if (order) {
        const ordered = await updatePlan(order);
        if (ordered.ok) restored = ordered;
        else notes.push(explain(ordered));
      }
      setPlan(restored.plan);
      setScript(restored.script);
      void loadValues(environmentId);
      onAdvanced?.();
      const journeySteps = journeyStepsNotRestored(restored.plan);
      if (journeySteps.length > 0) notes.push(`These journey steps were not restored, because their operation or target no longer exists: ${journeySteps.join(", ")}.`);
      if (restore.notRestored.length > 0) {
        notes.push(`Body and parameter edits are not recorded in runs, so these steps use their generated requests: ${restore.notRestored.join(", ")}.`);
      }
      const generated = await generateScript();
      if (generated.ok) setScript(generated.script);
      else notes.push(`The script was not generated: ${generated.message}`);
      const what = (snapshot.userJourneys ?? []).length > 0 ? "removed operations, journeys, order" : "removed operations, order";
      const message = [`Restored run ${run}'s ${what}, load profile, think time, thresholds and expected statuses.`, ...notes].join(" ");
      setAnnouncement(message);
      return { ok: true, message };
    } finally {
      setBusy(false);
    }
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
  const editedWorkflowJourneys = (plan.userJourneys ?? []).filter((definition) => definition.origin.kind === "based-on-workflow");
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
  else if ((plan.bindingsNeedingAttention ?? []).length > 0)
    generateBlockedReason = "A captured value's target no longer exists";
  // AP-035 FR-025: journeys the script leaves out, shown as a note and at the run trigger.
  const incompleteJourneys = plan.journeys.filter((journey) => journey.incompleteReason && journey.source.kind === "user");
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
  const restore = (keys: readonly string[], success: string) =>
    void apply(
      { excludedOperationKeys: plan.excludedOperationKeys.filter((key) => !keys.includes(key)) },
      success,
    );
  // The table's views: the plan's steps, and the operations not in it. A view with nothing in it
  // is not offered, and a chosen view that empties (its last operation restored) falls back to
  // the plan.
  const scopes: { id: OperationScope; label: string; count: number }[] = [
    { id: "plan", label: "In plan", count: steps.length },
    ...(plan.excludedOperationKeys.length > 0
      ? [{ id: "removed" as const, label: "Removed", count: plan.excludedOperationKeys.length }]
      : []),
    ...(plan.omitted.length > 0 ? [{ id: "left-out" as const, label: "Left out", count: plan.omitted.length }] : []),
  ];
  const activeScope: OperationScope = scopes.some((option) => option.id === scope) ? scope : "plan";
  const goTo = (next: PlanTab, focusId?: string) => {
    setTab(next);
    if (focusId) setFocusTarget(focusId);
  };
  const nextNonce = (current: ListRequest | null) => (current?.nonce ?? 0) + 1;
  const showNeedsStatus = () => {
    setTab("plan");
    setScope("plan");
    setListRequest((current) => ({ kind: "show-needs-status", nonce: nextNonce(current) }));
  };
  const openOperation = (operationKey: string) => {
    setTab("plan");
    setScope("plan");
    setListRequest((current) => ({ kind: "open-operation", operationKey, nonce: nextNonce(current) }));
  };
  const setStatusOf = (stepId: string) => {
    setTab("plan");
    setScope("plan");
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
      text: "Every operation was removed. Restore at least one.",
      action: {
        label: "Show removed",
        onClick: () => {
          setScope("removed");
          goTo("plan");
        },
      },
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
  if ((plan.bindingsNeedingAttention ?? []).length > 0) {
    // AP-035 FR-016: blocks the script until each binding is removed or re-targeted.
    pending.push({
      id: "bindings",
      state: "attention",
      text: `${plan.bindingsNeedingAttention!.length === 1 ? "1 step fills" : `${plan.bindingsNeedingAttention!.length} steps fill`} a value whose target no longer exists. Remove or re-target each binding marked "Target no longer exists".`,
      detail: (
        <CountedOperationList
          label={(count) => `${count} step${count === 1 ? "" : "s"} to fix`}
          collapseAbove={0}
          testId="performance-bindings-list"
          entries={plan.bindingsNeedingAttention!.map((stepId) => ({ operationKey: stepLabel(stepId) }))}
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
  const setupPending = pending.filter((item) => item.id !== "operations" && item.id !== "statuses" && item.id !== "bindings").length;
  const ready =
    pending.length === 0 && environment && runs.readiness?.state === "ready" && !runs.inProgress
      ? {
          text: `Ready to run on ${environment.name} (${environment.tier}) · ${writeSummary.total > 0 ? writeCountLabel(writeSummary.total) : "read requests only"}`,
          action: { label: "Go to run →", onClick: () => goTo("setup", RUN_TITLE_ID) },
        }
      : null;
  const bodyNoticeCount = plan.bodyEditNotices.length;
  const notes = [
    ...(environment && missingValues > 0
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
      : []),
    // AP-035 FR-025: not blocking; the script leaves these journeys out.
    ...(incompleteJourneys.length > 0
      ? [
          <>
            {incompleteJourneys.length === 1 ? "1 journey is" : `${incompleteJourneys.length} journeys are`} incomplete and will not run:{" "}
            {incompleteJourneys
              .map((journey) => `${journey.source.kind === "user" ? journey.source.name : journey.id} (${journey.incompleteReason!.missingOperationKeys.join(", ")} not in the plan)`)
              .join("; ")}
            .
          </>,
        ]
      : []),
    // AP-033 FR-010: informational; nothing is blocked.
    ...(bodyNoticeCount > 0
      ? [
          <>
            {bodyNoticeCount === 1
              ? "An edited body no longer sends a value ApiPilot fills in."
              : `Edited bodies no longer send ${bodyNoticeCount} values ApiPilot fills in.`}{" "}
            Each step&apos;s details say which.
          </>,
        ]
      : []),
  ];

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
            onClick={() => (editedWorkflowJourneys.length > 0 ? setConfirmReset(true) : void handleReset())}
          >
            Reset plan
          </button>
        </div>
      </div>
      {problem && <ErrorState message={problem} testId="performance-plan-problem" />}
      {confirmReset && (
        // AP-035 spec Edge Cases ("Resetting the plan"): name the edited workflow journeys it reverts.
        <ConfirmDialog
          message={`Reset the plan? Your own journeys are kept. These edited workflow journeys go back to the proposed journeys: ${editedWorkflowJourneys.map((definition) => definition.name).join(", ")}.`}
          affectedCount={editedWorkflowJourneys.length}
          confirmLabel="Reset plan"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            void handleReset();
          }}
        />
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

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

        {scopes.length > 1 && (
          <div
            role="group"
            aria-label="Operations to show"
            className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-chrome p-0.5 dark:bg-white/5"
          >
            {scopes.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={activeScope === option.id}
                onClick={() => setScope(option.id)}
                className={`rounded px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${activeScope === option.id ? "bg-surface font-medium text-slate-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-muted hover:text-slate-900 dark:hover:text-white"}`}
              >
                {option.label} <span className="font-mono text-xs">{option.count}</span>
              </button>
            ))}
          </div>
        )}

        {activeScope === "removed" && (
          <OtherOperationsTable
            kind="removed"
            entries={plan.excludedOperationKeys.map((operationKey) => ({
              operationKey,
              reason: removalReason(operationKey, plan.credentialProducerOperationKeys),
            }))}
            busy={busy}
            onRestore={restore}
            loadRemoved={fetchRemovedOperation}
          />
        )}
        {activeScope === "left-out" && (
          <OtherOperationsTable
            kind="left-out"
            entries={plan.omitted.map((entry) => ({
              operationKey: entry.operationKey,
              reason: OMITTED_REASON_LABEL[entry.reason],
            }))}
            busy={busy}
          />
        )}

        {activeScope === "plan" && noOperations && (
          <EmptyState
            message="The plan has no operations"
            description="Every operation was removed. Restore one from Removed to generate a script."
            testId="performance-plan-no-operations"
          />
        )}
        {activeScope === "plan" &&
          !noOperations &&
          steps.length === 0 &&
          (emptyState ?? (
            <EmptyState
              message="Nothing to test"
              description="No operation in scope has a positive scenario."
              testId="performance-plan-empty"
            />
          ))}
        {plan.discardedBodyEdits.length > 0 && (
          // AP-033 FR-018: shown after a rebuild until the next plan edit.
          <div className="rounded-md border border-warning-500 bg-warning-50 px-3 py-2 text-sm dark:bg-warning-500/10">
            <CountedOperationList
              label={(count) =>
                count === 1
                  ? "The body edit of 1 operation was discarded because its scenario changed"
                  : `The body edits of ${count} operations were discarded because their scenarios changed`
              }
              collapseAbove={10}
              testId="performance-discarded-body-edits"
              entries={plan.discardedBodyEdits.map((operationKey) => ({ operationKey }))}
            />
          </div>
        )}
        {plan.discardedParameterEdits.length > 0 && (
          // AP-033 FR-020 (amended 2026-09-30): as for body edits, shown until the next plan edit.
          <div className="rounded-md border border-warning-500 bg-warning-50 px-3 py-2 text-sm dark:bg-warning-500/10">
            <CountedOperationList
              label={(count) =>
                count === 1
                  ? "The parameter edits of 1 operation were discarded because its scenario changed"
                  : `The parameter edits of ${count} operations were discarded because their scenarios changed`
              }
              collapseAbove={10}
              testId="performance-discarded-parameter-edits"
              entries={plan.discardedParameterEdits.map((operationKey) => ({ operationKey }))}
            />
          </div>
        )}
        {activeScope === "plan" && (steps.length > 0 || (plan.userJourneys ?? []).length > 0) && (
          <UserJourneysPanel
            plan={plan}
            busy={busy}
            apply={apply}
            guided={plan.source === "guided"}
            loadFields={fetchResponseFields}
            loadPreview={fetchStepRequest}
          />
        )}
        {activeScope === "plan" && steps.length > 0 && (
          <JourneyList
            loadPreview={fetchStepRequest}
            journeys={plan.journeys}
            busy={busy}
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
            onSaveBody={saveBody}
            onSaveParameters={saveParameters}
            lastRunUnexpected={lastRunUnexpected}
            onResetBodies={(stepIds) =>
              void apply(
                { bodyEdits: Object.fromEntries(stepIds.map((stepId) => [stepId, null])) },
                stepIds.length === 1 ? "1 body reset to the generated body." : `${stepIds.length} bodies reset to the generated body.`,
              )
            }
            bodyEditNotices={plan.bodyEditNotices}
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
              scopeOptions={[
                { key: "run", label: "Whole run", scope: { kind: "run" } as const },
                ...steps.map((step) => ({ key: step.id, label: step.operationKey, scope: { kind: "step", stepId: step.id } as const })),
              ]}
              scopeLabel={(scope) => (scope.kind === "run" ? "Run" : (steps.find((step) => step.id === scope.stepId)?.operationKey ?? scope.stepId))}
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
        <PerformanceRunActivity runs={runs} client={client} plan={plan} script={script} environments={environments} onSelectOperation={openOperation} onRestore={restoreRun} />
      </div>
    </div>
  );
}
