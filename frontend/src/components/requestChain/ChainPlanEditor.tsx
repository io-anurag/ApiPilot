import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeChainPlan,
  LOAD_PROFILE_STARTING_STAGES,
  namesAvailableAt,
  SUPPORTED_DYNAMIC_VARIABLES,
  type ChainPlan,
  type ChainPlanView,
  type ChainStep,
  type Environment,
  type MovedCredential,
  type PerformanceThreshold,
  type StepCheck,
} from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import { chainRunsClient, fetchPlan, generateScript, restoreRun, savePlan, scriptDownloadUrl } from "../../services/requestChainClient";
import { ConfirmDialog } from "../ConfirmDialog";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { PromptDialog } from "../PromptDialog";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { Tabs } from "../Tabs";
import { EnvironmentPicker } from "../performance/EnvironmentPicker";
import { LoadProfileEditor } from "../performance/LoadProfileEditor";
import { PendingBar, type PendingItem } from "../performance/PendingBar";
import { SetupItem } from "../performance/SetupItem";
import { ThresholdEditor } from "../performance/ThresholdEditor";
import { usePerformanceRuns } from "../performance/usePerformanceRuns";
import * as edit from "./chainEditing";
import { ChainRunPanel } from "./ChainRunPanel";
import { ChainTree } from "./ChainTree";
import { DataSetsPanel } from "./DataSetsPanel";
import { Disclosure } from "./Disclosure";
import { PlanIssues } from "./PlanIssues";
import type { ReferenceSuggestion } from "./ReferenceField";
import { SeedingReportView } from "./SeedingReportView";
import { StepActions } from "./StepActions";
import { StepEditor } from "./StepEditor";

type Tab = "chains" | "setup" | "runs";

type Dialog = { kind: "new-chain" } | { kind: "rename-chain"; chainId: string } | { kind: "rename-plan" } | { kind: "delete-chain"; chainId: string } | null;

function movedText(moved: readonly MovedCredential[]): string {
  return moved
    .map((entry) => `The ${entry.location.kind === "header" ? `${entry.location.name} header` : `${entry.location.path} field`} value was moved into the secret value ${entry.valueName} of ${entry.environmentName}.`)
    .join(" ");
}

function seedingSummary(itemCount: number): string {
  if (itemCount === 0) return "Everything was carried over.";
  return `${itemCount} ${itemCount === 1 ? "item" : "items"} not carried over. The report never blocks the script.`;
}

function environmentNames(environment: Environment | null): string[] | null {
  if (!environment) return null;
  const names = Object.entries(environment.variableValues)
    .filter(([, value]) => value !== "")
    .map(([name]) => name);
  return environment.baseUrl ? ["baseUrl", ...names] : names;
}

/**
 * A request-chain plan, owned by the engineer (specs/037-request-chain-performance US1, US2; FR-001
 * to FR-016, FR-031 to FR-035). The plan is kept as a local draft and saved, whole, when a field loses
 * focus or a structural action completes; the server's answer is authoritative (research R2). The
 * plan check runs locally on every edit with the shared analysis, so a use before an extraction shows
 * as the engineer types (FR-014). Steps are authored by the engineer and not verified by ApiPilot,
 * and the screen says so (constitution XVII). Its layout follows the other performance screens: a
 * bar naming the plan, what still blocks a run, then the tabs.
 */
export function ChainPlanEditor({ planId, onOpenPlan, onBack }: Readonly<{ planId: string; onOpenPlan?: (planId: string) => void; onBack?: () => void }>) {
  const [view, setView] = useState<ChainPlanView | null>(null);
  const [draft, setDraftState] = useState<ChainPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // The last save was refused: the editor holds changes the server does not, so it must not say Saved.
  const [saveFailed, setSaveFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chains");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  // Plan check opens itself while something blocks the script; the engineer's own choice wins once made.
  const [planCheckChoice, setPlanCheckChoice] = useState<boolean | null>(null);
  const [seedingOpen, setSeedingOpen] = useState(false);
  const [revealCount, setRevealCount] = useState(0);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<ChainPlan | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const runsClient = useMemo(() => chainRunsClient(planId), [planId]);
  const runs = usePerformanceRuns(runsClient);

  const setDraft = useCallback((plan: ChainPlan) => {
    draftRef.current = plan;
    setDraftState(plan);
  }, []);

  const load = useCallback(async () => {
    const [planResult, environmentResult] = await Promise.all([fetchPlan(planId), fetchEnvironments()]);
    if (!planResult.ok) {
      setLoadError(planResult.message);
      return;
    }
    setView(planResult);
    setDraft(planResult.plan);
    setSelectedStepId((current) => current ?? planResult.plan.chains.flatMap((chain) => chain.steps)[0]?.id ?? null);
    if (environmentResult.ok) setEnvironments(environmentResult.environments);
  }, [planId, setDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (saving.current) {
      queued.current = true;
      return;
    }
    const sent = draftRef.current;
    if (!sent) return;
    saving.current = true;
    const result = await savePlan(sent.id, sent.revision, edit.inputOf(sent));
    saving.current = false;
    // A conflict reloads the server's plan, so the editor and the server agree again.
    setSaveFailed(!result.ok && !(result.error === "plan_revision_conflict" && result.current));
    if (result.ok) {
      setView(result);
      setSaveError(null);
      if (draftRef.current === sent || result.movedCredentials.length > 0) setDraft(result.plan);
      else if (draftRef.current) setDraft({ ...draftRef.current, revision: result.plan.revision, fingerprint: result.plan.fingerprint });
      if (result.movedCredentials.length > 0) setAnnouncement(movedText(result.movedCredentials));
    } else if (result.error === "plan_revision_conflict" && result.current) {
      setView(result.current);
      setDraft(result.current.plan);
      setAnnouncement("The plan was changed elsewhere and has been reloaded. Make your change again.");
    } else if (result.error === "credential_needs_environment") {
      setSaveError(`${result.message} Choose one under Run setup.`);
    } else {
      setSaveError(result.message);
    }
    if (queued.current) {
      queued.current = false;
      void save();
      return;
    }
    setDirty(false);
  }, [setDraft]);

  const change = useCallback(
    (next: ChainPlan, persist = false) => {
      setDraft(next);
      setDirty(true);
      if (persist) void save();
    },
    [save, setDraft],
  );

  const environment = useMemo(() => environments.find((candidate) => candidate.id === draft?.targetEnvironmentId) ?? null, [environments, draft?.targetEnvironmentId]);
  const analysis = useMemo(() => (draft ? analyzeChainPlan(draft, { environmentValueNames: environmentNames(environment) }) : null), [draft, environment]);

  const suggestions = useMemo((): ReferenceSuggestion[] => {
    if (!draft || !selectedStepId) return [];
    const producers = new Map<string, string>();
    for (const step of draft.chains.flatMap((chain) => chain.steps)) for (const extractor of step.extractors) producers.set(extractor.name, step.name);
    const extracted = namesAvailableAt(draft, selectedStepId).map((name) => ({ name, detail: `Extracted by ${producers.get(name) ?? "an earlier step"}` }));
    const columns = draft.dataSets.flatMap((dataSet) => dataSet.columns.map((column) => ({ name: column.name, detail: `Column of ${dataSet.name}` })));
    const values = (environmentNames(environment) ?? ["baseUrl"]).map((name) => ({ name, detail: name === "baseUrl" ? "The environment's base URL" : "Environment value" }));
    const dynamic = [...SUPPORTED_DYNAMIC_VARIABLES].map((name) => ({ name, detail: "Generated for each request" }));
    const seen = new Set<string>();
    return [...extracted, ...columns, ...values, ...dynamic].filter((entry) => !seen.has(entry.name) && seen.add(entry.name));
  }, [draft, selectedStepId, environment]);

  if (loadError) return <ErrorState message="The plan could not be opened." detail={loadError} testId="chain-plan-load-error" />;
  if (!draft || !analysis || !view) {
    return (
      <div role="status" aria-label="Loading plan">
        <Skeleton className="h-40 w-full rounded bg-slate-200 dark:bg-slate-600" />
      </div>
    );
  }

  const plan = draft;
  const selected = plan.chains.flatMap((chain) => chain.steps).find((step) => step.id === selectedStepId) ?? null;
  const stepsWithIssues = new Set(analysis.blockers.flatMap((blocker) => ("stepId" in blocker ? [blocker.stepId] : [])));
  const script = view.script && view.script.planFingerprint === plan.fingerprint && !dirty ? view.script : view.script ? { ...view.script, outOfDate: true } : null;
  const generateBlocked = dirty
    ? "Saving your latest change…"
    : saveFailed
      ? "Your latest change is not saved. Fix the error above first."
      : analysis.blockers.length > 0
        ? "Fix the plan's problems first."
        : null;

  const updateStep = (step: ChainStep) => change(edit.updateStep(plan, step.id, () => step));
  const planCheckOpen = planCheckChoice ?? analysis.blockers.length > 0;

  // Plan check and the seeding report sit below the workbench, so jumping to a step brings it back into view.
  function goToStep(stepId: string) {
    setSelectedStepId(stepId);
    setRevealCount((count) => count + 1);
    if (typeof workbenchRef.current?.scrollIntoView === "function") workbenchRef.current.scrollIntoView({ block: "start" });
  }

  async function handleGenerate() {
    setBusy(true);
    const result = await generateScript(planId);
    setBusy(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setView((current) => (current ? { ...current, script: result.script } : current));
    setAnnouncement("Script generated.");
  }

  async function handleRestore(runId: string, into: "plan" | "new-plan") {
    setBusy(true);
    const result = await restoreRun(runId, into === "plan" ? { into: "plan", planId, revision: plan.revision } : { into: "new-plan" });
    setBusy(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    const missing = result.dataSetsNotRestored.map((entry) => `${entry.name} (${entry.reason === "deleted" ? "deleted" : "content changed"})`).join(", ");
    if (into === "new-plan") {
      onOpenPlan?.(result.plan.id);
      return;
    }
    setView(result);
    setDraft(result.plan);
    setAnnouncement(`The run's plan was restored and its script generated. No run was started.${missing ? ` Data sets not restored: ${missing}.` : ""}`);
  }

  function addCheck(kind: StepCheck["kind"]) {
    if (!selected) return;
    const { plan: next, id } = edit.nextItemId(plan, "k");
    const check: StepCheck =
      kind === "time-at-most" ? { id, kind, maxMs: 500 } : kind === "body-contains" ? { id, kind, text: "" } : kind === "field-exists" ? { id, kind, path: "" } : { id, kind, path: "", expected: { type: "text", value: "" } };
    change(edit.updateStep(next, selected.id, (step) => ({ ...step, checks: [...step.checks, check] })));
  }

  function addExtractor() {
    if (!selected) return;
    const { plan: next, id } = edit.nextItemId(plan, "x");
    change(edit.updateStep(next, selected.id, (step) => ({ ...step, extractors: [...step.extractors, { id, name: "", source: { kind: "body", path: "" } }] })));
  }

  const seed = plan.seedingReport?.source;
  const stepCount = plan.chains.reduce((total, chain) => total + chain.steps.length, 0);

  // What still blocks a run, in the order the engineer meets it, as on the other performance screens.
  const pending: PendingItem[] = [];
  if (analysis.blockers.length > 0) {
    pending.push({
      id: "blockers",
      state: "attention",
      text: analysis.blockers.length === 1 ? "1 problem in the plan blocks the script." : `${analysis.blockers.length} problems in the plan block the script.`,
      action: { label: "Show", ariaLabel: "Show the plan's problems", onClick: () => setTab("chains") },
    });
  }
  if (!environment) {
    pending.push({
      id: "environment",
      state: "todo",
      text: "No target environment yet. It holds the base URL and every value the plan uses.",
      action: { label: "Choose one", ariaLabel: "Choose a target environment", onClick: () => setTab("setup") },
    });
  }
  if (!script || script.outOfDate) {
    pending.push({
      id: "script",
      state: "todo",
      text: script ? "The k6 script is out of date." : "The k6 script has not been generated.",
      action: { label: script ? "Regenerate" : "Generate", ariaLabel: script ? "Regenerate the k6 script" : "Generate the k6 script", onClick: () => void handleGenerate(), disabled: busy || generateBlocked !== null },
      hint: generateBlocked ?? undefined,
    });
  }
  if (runs.readiness?.state === "unavailable") {
    pending.push({
      id: "k6",
      state: "attention",
      text: "k6 is not available on the machine running the ApiPilot backend.",
      action: { label: "See why", onClick: () => setTab("setup") },
    });
  }
  const setupPending = pending.filter((item) => item.id !== "blockers").length;
  const ready =
    pending.length === 0 && environment && runs.readiness?.state === "ready" && !runs.inProgress
      ? { text: `Ready to run on ${environment.name} (${environment.tier})`, action: { label: "Go to run →", onClick: () => setTab("setup") } }
      : null;
  const missingValues = analysis.requiredValues.filter((value) => value.provided === false).length;
  const notes =
    environment && missingValues > 0
      ? [
          <>
            {missingValues} of {analysis.requiredValues.length} values are missing in {environment.name}. Steps that use them are not sent.{" "}
            <button type="button" className={BUTTON_STYLES.ghost} onClick={() => setTab("setup")}>
              Review values
            </button>
          </>,
        ]
      : [];

  return (
    <div className="space-y-4" data-testid="chain-plan-editor" data-plan-id={planId}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {onBack && (
            <>
              <button type="button" className={BUTTON_STYLES.ghost} onClick={onBack}>
                ← All plans
              </button>
              <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
            </>
          )}
          <span className="font-semibold" data-testid="chain-plan-name">{plan.name}</span>
          <span className="text-xs text-muted">
            {seed ? (seed.kind === "collection" ? `Seeded from the collection ${seed.collectionName}` : seed.kind === "specification" ? `Seeded from ${seed.filename}` : "Seeded from the guided workflow") : "Built by you"}
          </span>
          <StatusBadge label={`${plan.chains.length} ${plan.chains.length === 1 ? "chain" : "chains"} · ${stepCount} ${stepCount === 1 ? "step" : "steps"}`} />
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <StatusBadge label="Saving…" tone="info" /> : saveFailed ? <StatusBadge label="Not saved" tone="danger" /> : <StatusBadge label="Saved" tone="success" />}
          <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setDialog({ kind: "rename-plan" })}>
            Rename plan
          </button>
        </div>
      </div>
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-lg font-semibold">Performance plan</h2>
        <p className="max-w-3xl text-sm text-muted">
          Chains of requests you write and edit. Steps are authored by you and not verified by ApiPilot. Nothing is sent to any system until you trigger a run.
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="chain-plan-announcement">
        {announcement}
      </p>
      {announcement && <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm dark:bg-white/5">{announcement}</p>}
      {saveError && <ErrorState message={saveError} testId="chain-plan-save-error" />}

      <PendingBar
        items={pending}
        ready={ready}
        idleText={runs.readiness === null ? "Checking whether k6 is ready…" : undefined}
        running={runs.inProgress ? { label: "View progress", onClick: () => setTab("runs") } : null}
        notes={notes}
      />

      <Tabs
        tabs={[
          { id: "chains", label: "Chains" },
          { id: "setup", label: setupPending > 0 ? `Run setup (${setupPending} to do)` : "Run setup" },
          { id: "runs", label: `Runs & reports (${runs.runs.length})` },
        ]}
        activeTab={tab}
        onChange={setTab}
        label="Plan sections"
      />

      {tab === "chains" && (
        <div className="space-y-4">
          {/* A workbench: on a wide screen the tree and the editor share one viewport-high frame and
              scroll on their own, so the page does not grow with the plan and a step picked in the tree
              is already beside its editor. The height is viewport-relative, which no fixed utility
              expresses. Below lg the two stack and the page scrolls as before. */}
          <div ref={workbenchRef} className="grid scroll-mt-2 gap-4 lg:h-[max(32rem,calc(100dvh-5rem))] lg:grid-cols-[minmax(20rem,2fr)_minmax(0,3fr)]" data-testid="chain-workbench">
            <ChainTree
              plan={plan}
              selectedStepId={selectedStepId}
              stepsWithIssues={stepsWithIssues}
              busy={busy}
              revealCount={revealCount}
              actions={{
                onSelect: setSelectedStepId,
                onAddChain: () => setDialog({ kind: "new-chain" }),
                onRenameChain: (chainId) => setDialog({ kind: "rename-chain", chainId }),
                onMoveChain: (chainId, offset) => change(edit.moveChain(plan, chainId, offset), true),
                onDuplicateChain: (chainId) => change(edit.duplicateChain(plan, chainId), true),
                onDeleteChain: (chainId) => setDialog({ kind: "delete-chain", chainId }),
                onAddStep: (chainId) => {
                  const added = edit.addStep(plan, chainId);
                  setSelectedStepId(added.stepId);
                  change(added.plan, true);
                },
              }}
            />
            {selected ? (
              <StepEditor
                key={selected.id}
                step={selected}
                suggestions={suggestions}
                onChange={updateStep}
                onCommit={() => void save()}
                onAddExtractor={addExtractor}
                onAddCheck={addCheck}
                actions={
                  <StepActions
                    plan={plan}
                    step={selected}
                    busy={busy}
                    actions={{
                      onMoveStep: (stepId, offset) => change(edit.moveStep(plan, stepId, offset), true),
                      onMoveStepToChain: (stepId, chainId) => change(edit.moveStepToChain(plan, stepId, chainId), true),
                      onDuplicateStep: (stepId) => {
                        const copied = edit.duplicateStep(plan, stepId);
                        setSelectedStepId(copied.stepId);
                        change(copied.plan, true);
                      },
                      onDeleteStep: (stepId) => {
                        setSelectedStepId(null);
                        change(edit.deleteStep(plan, stepId), true);
                      },
                    }}
                  />
                }
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">Select a step, or add one to a chain.</p>
            )}
          </div>
          <Disclosure
            title="Plan check"
            open={planCheckOpen}
            onToggle={() => setPlanCheckChoice(!planCheckOpen)}
            summary={
              analysis.blockers.length === 0
                ? "Ready to generate. Nothing blocks the script."
                : `${analysis.blockers.length} ${analysis.blockers.length === 1 ? "problem blocks" : "problems block"} the script.`
            }
          >
            <PlanIssues plan={plan} analysis={analysis} environmentChosen={environment !== null} onGoToStep={goToStep} />
          </Disclosure>
          {plan.seedingReport && (
            <Disclosure title="Seeding report" open={seedingOpen} onToggle={() => setSeedingOpen(!seedingOpen)} summary={seedingSummary(plan.seedingReport.items.length)}>
              <SeedingReportView report={plan.seedingReport} onGoToStep={goToStep} />
            </Disclosure>
          )}
        </div>
      )}

      {tab === "setup" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SetupItem state={environment ? "done" : "todo"} title="Target environment" titleId="chain-environment-title" summary="Holds the base URL and every value the plan uses. Literal credentials you type are moved into it as secret values.">
            <EnvironmentPicker
              environments={environments}
              selectedId={plan.targetEnvironmentId}
              suggestedNames={analysis.requiredValues.map((value) => value.name).filter((name) => name !== "baseUrl")}
              onSelect={(environmentId) => change({ ...plan, targetEnvironmentId: environmentId }, true)}
              onSaved={(saved) => {
                void fetchEnvironments().then((result) => result.ok && setEnvironments(result.environments));
                change({ ...plan, targetEnvironmentId: saved.id }, true);
              }}
            />
          </SetupItem>
          <SetupItem state="done" title="Load profile" titleId="chain-profile-title" summary="Every virtual user runs every chain, in order, on each iteration.">
            <LoadProfileEditor
              profile={plan.loadProfile}
              startingStages={(kind) => LOAD_PROFILE_STARTING_STAGES[kind].map((stage) => ({ ...stage }))}
              busy={busy}
              onSave={(profile) => change({ ...plan, loadProfile: { ...profile, plannedDurationMs: profile.stages.reduce((total, stage) => total + stage.durationMs, 0) } }, true)}
            />
            <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>Default think time after each step (ms)</span>
              <input
                type="number"
                min={0}
                className="w-28 rounded-md border border-border bg-surface px-2 py-1"
                value={plan.thinkTimeMs}
                onChange={(event) => change({ ...plan, thinkTimeMs: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
                onBlur={() => void save()}
              />
            </label>
          </SetupItem>
          <SetupItem state={plan.thresholds.length > 0 ? "done" : "optional"} title="Thresholds (optional)" titleId="chain-thresholds-title">
            <ThresholdEditor
              thresholds={plan.thresholds}
              scopeOptions={[
                { key: "run", label: "Whole run", scope: { kind: "run" } as const },
                ...plan.chains.flatMap((chain) => chain.steps.filter((step) => step.runs !== "once-before-load")).map((step) => ({ key: step.id, label: `${step.method} ${step.name}`, scope: { kind: "step", stepId: step.id } as const })),
              ]}
              scopeLabel={(scope) => (scope.kind === "run" ? "Run" : (plan.chains.flatMap((chain) => chain.steps).find((step) => step.id === scope.stepId)?.name ?? scope.stepId))}
              busy={busy}
              onSave={(thresholds) => change({ ...plan, thresholds: thresholds as PerformanceThreshold[] }, true)}
            />
          </SetupItem>
          <DataSetsPanel plan={plan} analysis={analysis} onPlanChanged={(next) => { setView(next); setDraft(next.plan); }} />
          <SetupItem state={script && !script.outOfDate ? "done" : "todo"} title="k6 script" titleId="chain-script-title" summary="ApiPilot writes every byte of the script; your steps reach it only as data.">
            {script?.outOfDate && <StatusBadge label="Out of date: regenerate" tone="warning" />}
            {script && !script.outOfDate && (
              <p className="text-sm">
                <StatusBadge label="Script current" tone="success" /> <span className="font-mono text-xs">sha256 {script.scriptSha256.slice(0, 12)}…</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BUTTON_STYLES.primary} disabled={busy || generateBlocked !== null} onClick={() => void handleGenerate()}>
                {script ? "Regenerate script" : "Generate script"}
              </button>
              {generateBlocked && <span className="text-xs text-muted">{generateBlocked}</span>}
              {script && !script.outOfDate && (
                <>
                  <a className={BUTTON_STYLES.ghost} href={scriptDownloadUrl(planId, "script")} download>
                    Download script
                  </a>
                  <a className={BUTTON_STYLES.ghost} href={scriptDownloadUrl(planId, "environment-template")} download>
                    Download environment template
                  </a>
                </>
              )}
            </div>
            {plan.dataSets.length > 0 && (
              <p className="text-xs text-muted">
                This plan reads its data sets from files ApiPilot writes for each run, so a downloaded copy of the script cannot run in Run k6 Script, which never lets a script open files.
              </p>
            )}
          </SetupItem>
          <div className="lg:col-span-2">
            <ChainRunPanel plan={plan} analysis={analysis} script={script} environment={environment} environments={environments} runs={runs} runsClient={runsClient} dirty={dirty} onRestore={(runId, into) => void handleRestore(runId, into)} />
          </div>
        </div>
      )}

      {tab === "runs" && <ChainRunPanel plan={plan} analysis={analysis} script={script} environment={environment} environments={environments} runs={runs} runsClient={runsClient} dirty={dirty} onRestore={(runId, into) => void handleRestore(runId, into)} />}

      {(dialog?.kind === "new-chain" || dialog?.kind === "rename-chain" || dialog?.kind === "rename-plan") && (
        <PromptDialog
          title={dialog.kind === "new-chain" ? "New chain" : dialog.kind === "rename-plan" ? "Rename plan" : "Rename chain"}
          label={dialog.kind === "rename-plan" ? "Plan name" : "Chain name"}
          initialValue={dialog.kind === "rename-chain" ? (plan.chains.find((chain) => chain.id === dialog.chainId)?.name ?? "") : dialog.kind === "rename-plan" ? plan.name : `Chain ${plan.chains.length + 1}`}
          confirmLabel={dialog.kind === "new-chain" ? "Add chain" : "Rename"}
          onConfirm={(name) => {
            setDialog(null);
            if (dialog.kind === "new-chain") change(edit.addChain(plan, name), true);
            else if (dialog.kind === "rename-plan") change({ ...plan, name }, true);
            else change(edit.renameChain(plan, dialog.chainId, name), true);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete-chain" && (
        <ConfirmDialog
          message={`Delete the chain "${plan.chains.find((chain) => chain.id === dialog.chainId)?.name ?? ""}" and its steps?`}
          affectedCount={plan.chains.find((chain) => chain.id === dialog.chainId)?.steps.length ?? 0}
          confirmLabel="Delete chain"
          onConfirm={() => {
            setDialog(null);
            change(edit.deleteChain(plan, dialog.chainId), true);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
