import { useState, type ReactNode } from "react";
import { seededOperationKeys } from "@apipilot/shared-domain";
import type { PerformancePath as PathApi } from "../../../hooks/usePerformancePath";
import type { QuickTestSession } from "../../../hooks/useQuickTest";
import { useGuidedWorkflowSummary } from "../../../hooks/useGuidedWorkflowSummary";
import { createPlan, seedPlan, type SeedSourceInput } from "../../../services/requestChainClient";
import { BUTTON_STYLES } from "../../controlStyles";
import { ConfirmDialog } from "../../ConfirmDialog";
import { ErrorState } from "../../ErrorState";
import { Skeleton } from "../../Skeleton";
import { StatusBadge } from "../../StatusBadge";
import { SaveStatus } from "../../requestChain/SaveStatus";
import { useChainPlanSession, type ChainPlanSession } from "../../requestChain/useChainPlanSession";
import { ChangeOperationsPanel } from "./ChangeOperationsPanel";
import { EditedRemovalDialog } from "./EditedRemovalDialog";
import { LoadStep } from "./LoadStep";
import { OperationsStep, operationKeysOf } from "./OperationsStep";
import { PerformanceStepper } from "./PerformanceStepper";
import { PlanStep } from "./PlanStep";
import { RunStep } from "./RunStep";
import { SourceStep } from "./SourceStep";
import { nextAvailability, previousStep, type GateContext, type NextAvailability, type SourceKind } from "./pathState";
import { seededFromText, sourceOfPlan } from "./planSource";
import { changeOperationsAvailability, usePlanReselect } from "./usePlanReselect";

/**
 * The frame around every step (specs/047-unified-performance-tab FR-006, FR-009, FR-010, FR-012): the
 * top row (Back to start, Plans, the plan name and status), the stepper, the step body and Back and Next
 * with the reason Next is unavailable. Back only moves; nothing is discarded by moving between steps.
 * The top row and footer follow specs/050-performance-source-step-redesign FR-004, FR-005.
 */
function PathFrame({
  path,
  title,
  status,
  gate,
  onNext,
  busy = false,
  onExit,
  children,
}: Readonly<{ path: PathApi; title: string; status: ReactNode; gate: NextAvailability; onNext: () => void; busy?: boolean; onExit?: () => void; children: ReactNode }>) {
  const { state } = path;
  return (
    <div className="space-y-4" data-testid="performance-path">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {onExit && (
          <>
            <button type="button" aria-label="Exit performance testing and return to the start screen" className={BUTTON_STYLES.ghost} onClick={onExit}>
              ← Back to start
            </button>
            <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
          </>
        )}
        <button type="button" className={BUTTON_STYLES.ghost} onClick={path.leave}>
          ← Plans
        </button>
        <span className="font-semibold" data-testid="path-title">
          {title}
        </span>
        {status}
      </div>
      <PerformanceStepper current={state.step} reached={state.reached} source={state.source} onSelect={path.go} />
      <div>{children}</div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-chrome px-4 py-3">
        <button type="button" className={BUTTON_STYLES.secondary} disabled={previousStep(state.step, state.source) === null || busy} onClick={path.back}>
          ← Back
        </button>
        <span className="flex-1" />
        {gate.reason && (
          <p role="status" className="text-sm text-muted">
            {gate.reason}
          </p>
        )}
        {state.step !== "run" && (
          <button type="button" className={BUTTON_STYLES.primary} disabled={!gate.available || busy} onClick={onNext}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

const DEFAULT_NAMES: Record<Exclude<SourceKind, "specification">, string> = { workflow: "Guided workflow plan", collection: "Collection plan", empty: "New plan" };

/** A test with no plan yet: Source and Operations. The plan is created when the engineer first moves on (FR-011). */
function PathWithoutPlan({ path, quickTest, onExit }: Readonly<{ path: PathApi; quickTest: QuickTestSession; onExit?: () => void }>) {
  const { state } = path;
  const [environmentId, setEnvironmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState<string | null>(null);
  const quick = quickTest.state.kind === "ready" ? quickTest.state.quickTest : null;
  const source = state.source;
  const workflow = useGuidedWorkflowSummary(source === "workflow" && state.step === "operations");
  const workflowReady = workflow.kind === "idle" || workflow.kind === "loading" ? null : workflow.kind === "ready";

  const gate = nextAvailability(state.step, {
    source,
    specificationReady: quick !== null && !state.replacingSpecification,
    selectionCount: state.selection.length,
    workflowReady,
    planExists: false,
    planName: "",
    planStepCount: 0,
    loadProblem: null,
  } satisfies GateContext);

  const defaultName = source === "specification" ? (quick?.specification.info?.title ?? quick?.specification.filename ?? "Specification plan") : DEFAULT_NAMES[source ?? "empty"];

  async function create(request: () => ReturnType<typeof createPlan | typeof seedPlan>) {
    setBusy(true);
    setError(null);
    const result = await request();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    path.planCreated(result.plan.id);
  }

  function handleNext() {
    if (state.step === "source") {
      if (source === "empty") void create(() => createPlan(defaultName));
      else path.next();
      return;
    }
    if (state.step === "operations" && source === "specification" && quick) {
      const all = operationKeysOf(quick);
      const chosen = new Set(state.selection);
      const keys = all.filter((key) => chosen.has(key));
      const seedSource: SeedSourceInput = keys.length === all.length ? { kind: "specification" } : { kind: "specification", selectedOperationKeys: keys };
      void create(() => seedPlan({ name: defaultName, source: seedSource, ...(environmentId ? { environmentId } : {}) }));
      return;
    }
    if (state.step === "operations" && source === "workflow") {
      void create(() => seedPlan({ name: defaultName, source: { kind: "workflow" }, ...(environmentId ? { environmentId } : {}) }));
      return;
    }
    if (state.step === "operations" && source === "collection" && state.collectionId) {
      const collectionId = state.collectionId;
      void create(() => seedPlan({ name: collectionName ?? defaultName, source: { kind: "collection", collectionId, orderedRequestIds: [...state.selection] }, ...(environmentId ? { environmentId } : {}) }));
      return;
    }
    path.next();
  }

  return (
    <PathFrame path={path} title="New performance test" status={<StatusBadge label="Draft" tone="warning" />} gate={gate} onNext={handleNext} busy={busy} onExit={onExit}>
      {state.step === "source" && (
        <SourceStep
          source={source}
          locked={false}
          onSourceChange={(next) => path.setSource(next, next === "specification" && quick ? operationKeysOf(quick) : [])}
          quickTest={quickTest}
          replacing={state.replacingSpecification}
          onReplacingChange={path.setReplacing}
          onSpecificationUploaded={(view) => path.setSelection(operationKeysOf(view))}
        />
      )}
      {state.step === "operations" && source && (
        <OperationsStep
          source={source}
          quickTest={quick}
          selection={state.selection}
          onSelectionChange={path.setSelection}
          environmentId={environmentId}
          onEnvironmentChange={setEnvironmentId}
          creating={busy}
          error={error}
          workflow={workflow}
          collectionId={state.collectionId}
          onCollectionChange={(collectionId, requestIds, name) => {
            path.setCollection(collectionId);
            path.setSelection(requestIds);
            setCollectionName(name ?? null);
          }}
        />
      )}
      {state.step === "source" && error && <ErrorState message={error} testId="plan-create-error" />}
    </PathFrame>
  );
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key) => b.includes(key));

/** A path with a plan: the same steps, over the plan the engineer owns, every edit saved as it is made (FR-011, FR-013, FR-014). */
function PathWithPlan({ planId, path, quickTest, onExit }: Readonly<{ planId: string; path: PathApi; quickTest: QuickTestSession; onExit?: () => void }>) {
  const loaded = useChainPlanSession(planId, undefined, path.state.runId ?? undefined);

  if (loaded.status !== "ready") {
    return (
      <PathFrame path={path} title="Performance plan" status={null} gate={{ available: false, reason: null }} onNext={() => undefined} onExit={onExit}>
        {loaded.status === "error" ? (
          <ErrorState message="The plan could not be opened." detail={loaded.message} testId="performance-plan-load-error" />
        ) : (
          <div role="status" aria-label="Loading plan">
            <Skeleton className="h-40 w-full rounded bg-surface-strong" />
          </div>
        )}
      </PathFrame>
    );
  }
  return <PlanPath session={loaded.session} path={path} quickTest={quickTest} onExit={onExit} />;
}

/** The steps of a plan that is open: Change operations and Reset to seed live here, because they read the plan and the specification together. */
function PlanPath({ session, path, quickTest, onExit }: Readonly<{ session: ChainPlanSession; path: PathApi; quickTest: QuickTestSession; onExit?: () => void }>) {
  const { state } = path;
  const { plan } = session;
  const quick = quickTest.state.kind === "ready" ? quickTest.state.quickTest : null;
  const availability = changeOperationsAvailability(plan, quick);
  const reselect = usePlanReselect(session, path.setSelection);
  const [panelOpen, setPanelOpen] = useState(false);
  const [resetAsked, setResetAsked] = useState(false);
  // Where a pending edited-removal question came from, so confirming it can carry on to the next step.
  const [pendingFrom, setPendingFrom] = useState<"panel" | "operations" | null>(null);

  const origin = sourceOfPlan(plan);
  const seeded = seededOperationKeys(plan);
  const stepCount = plan.chains.reduce((total, chain) => total + chain.steps.length, 0);
  const selectable = availability.kind === "enabled";
  const changed = state.step === "operations" && selectable && !sameSet(seeded, state.selection);
  const saving = session.dirty ? "Saving your latest change…" : null;
  const baseGate = nextAvailability(state.step, {
    source: state.source,
    specificationReady: true,
    // A plan whose operations cannot be changed here has nothing to choose, so Next is not held back.
    selectionCount: selectable ? state.selection.length : 1,
    workflowReady: true,
    planExists: true,
    planName: plan.name,
    planStepCount: stepCount,
    loadProblem: null,
  });
  const gate = changed && saving ? { available: false, reason: saving } : baseGate;
  const seededCount = origin.source === "specification" ? seeded.length : plan.chains.flatMap((chain) => chain.steps).filter((step) => step.source.kind !== "added").length;

  async function handleNext() {
    if (changed) {
      setPendingFrom("operations");
      if (!(await reselect.apply("merge", state.selection))) return;
    }
    path.next();
  }

  async function handleConfirmRemoval() {
    const done = await reselect.confirmPending();
    if (!done) return;
    setPanelOpen(false);
    if (pendingFrom === "operations") path.next();
  }

  return (
    <PathFrame
      path={path}
      title={plan.name}
      status={
        <>
          <SaveStatus session={session} />
          <span className="text-xs text-muted">{seededFromText(plan)}</span>
        </>
      }
      gate={gate}
      onNext={() => void handleNext()}
      busy={reselect.busy}
      onExit={onExit}
    >
      {state.step === "source" && (
        <SourceStep source={state.source} locked planSourceLabel={origin.label} onSourceChange={() => undefined} quickTest={quickTest} replacing={false} onReplacingChange={() => undefined} onSpecificationUploaded={() => undefined} />
      )}
      {state.step === "operations" && state.source && (
        <OperationsStep
          source={state.source}
          quickTest={selectable ? quick : null}
          selection={state.selection}
          onSelectionChange={path.setSelection}
          environmentId=""
          onEnvironmentChange={() => undefined}
          existingPlan={{ sourceLabel: origin.label, selectedCount: seededCount, selectable, unavailableReason: availability.kind === "disabled" ? availability.reason : undefined }}
          creating={reselect.busy}
          error={reselect.error}
        />
      )}
      {state.step === "plan" && (
        <PlanStep
          session={session}
          changeOperations={availability}
          reselect={reselect}
          panelOpen={panelOpen}
          onOpenChangeOperations={() => {
            reselect.clear();
            setPendingFrom("panel");
            setPanelOpen(true);
          }}
          onAskReset={() => setResetAsked(true)}
        />
      )}
      {state.step === "load" && <LoadStep session={session} />}
      {state.step === "run" && <RunStep session={session} onEditLoad={() => path.go("load")} />}

      {panelOpen && quick && <ChangeOperationsPanel quickTest={quick} initialSelection={seeded} reselect={reselect} blocked={saving} onClose={() => setPanelOpen(false)} />}
      {reselect.pending && <EditedRemovalDialog pending={reselect.pending} busy={reselect.busy} onConfirm={() => void handleConfirmRemoval()} onCancel={reselect.cancelPending} />}
      {resetAsked && (
        <ConfirmDialog
          message="Reset to seed rebuilds the chains from the operations this plan was seeded with. You lose your edits to steps, their order and any chains you added, and thresholds set on steps that no longer exist. The plan's name, data sets, load profile, run-wide thresholds, environment and saved runs are kept."
          affectedCount={stepCount}
          confirmLabel="Reset steps"
          onCancel={() => setResetAsked(false)}
          onConfirm={() => {
            setResetAsked(false);
            void reselect.apply("reset", seeded);
          }}
        />
      )}
    </PathFrame>
  );
}

/** The five-step Performance path (specs/047-unified-performance-tab). */
export function PerformancePathView({ path, quickTest, onExit }: Readonly<{ path: PathApi; quickTest: QuickTestSession; onExit?: () => void }>) {
  const planId = path.state.planId;
  if (planId) return <PathWithPlan key={planId} planId={planId} path={path} quickTest={quickTest} onExit={onExit} />;
  return <PathWithoutPlan path={path} quickTest={quickTest} onExit={onExit} />;
}
