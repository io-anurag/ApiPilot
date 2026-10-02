import { useEffect, useState } from "react";
import type { CollectionPerformanceTestView, CollectionRebuildNotKept } from "@apipilot/shared-domain";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BUTTON_STYLES } from "../components/controlStyles";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PerformancePlanScreen } from "../components/performance/PerformancePlanScreen";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";
import {
  buildCollectionTest,
  collectionPerformanceClient,
  fetchCollectionTest,
  rebuildCollectionTest,
} from "../services/collectionPerformanceClient";

/**
 * AP-036 Performance Test from a Postman Collection (specs/036-collection-performance-test User
 * Story 1, research R18, R20): the performance plan built from a collection stored in Import & Run
 * Collection. Opened from a collection's run panel with its ordered selection; replacing an existing
 * plan asks first (FR-025). The plan, script and runs are the shared performance plan screen's.
 */
export interface CollectionPlanRequest {
  collectionId: string;
  orderedRequestIds: string[];
  /** A new value for every hand-off, so the same selection can be sent twice. */
  nonce: number;
}

type PageState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; collectionTest: CollectionPerformanceTestView };

const STATE_LABEL: Record<CollectionPerformanceTestView["collection"]["state"], { label: string; tone: StatusTone }> = {
  current: { label: "Collection unchanged", tone: "success" },
  changed: { label: "Collection changed", tone: "warning" },
  deleted: { label: "Collection deleted", tone: "danger" },
};

const NOT_KEPT_LABEL: Record<CollectionRebuildNotKept["settings"][number], string> = {
  "expected-statuses": "expected statuses",
  captures: "captures you added",
  bindings: "values you bound",
};

export function CollectionPerformancePage({ request, onExit }: Readonly<{ request?: CollectionPlanRequest | null; onExit?: () => void }>) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [pending, setPending] = useState<CollectionPlanRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notKept, setNotKept] = useState<string | null>(null);
  // Remounts the plan screen for each new or rebuilt plan, so it re-reads the plan.
  const [generation, setGeneration] = useState(0);

  async function readCurrent() {
    const result = await fetchCollectionTest();
    if (!result.ok) setState({ kind: "error", message: result.message });
    else setState(result.collectionTest ? { kind: "ready", collectionTest: result.collectionTest } : { kind: "none" });
  }

  async function build(next: CollectionPlanRequest, replaceExisting: boolean) {
    setBusy(true);
    setProblem(null);
    setNotKept(null);
    const result = await buildCollectionTest(next.collectionId, next.orderedRequestIds, replaceExisting);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "collection_plan_exists") setPending(next);
      else setProblem(result.message);
      // The existing plan, if any, stays on screen behind the question or the refusal.
      void readCurrent();
      return;
    }
    setState({ kind: "ready", collectionTest: result.collectionTest });
    setGeneration((current) => current + 1);
  }

  // Each hand-off is one build (`nonce` makes a repeated selection a new request). Opened without
  // one, the page reads the session's plan, so a hand-off never races an older read.
  const nonce = request?.nonce;
  useEffect(() => {
    if (request) void build(request, false);
    else void readCurrent();
  }, [nonce]);

  async function rebuild() {
    setBusy(true);
    setProblem(null);
    const result = await rebuildCollectionTest();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setState({ kind: "ready", collectionTest: result.collectionTest });
    setGeneration((current) => current + 1);
    setNotKept(
      result.notKept.length === 0
        ? null
        : `Rebuilt. These settings could not be kept: ${result.notKept.map((entry) => `${entry.name} (${entry.settings.map((setting) => NOT_KEPT_LABEL[setting]).join(", ")})`).join("; ")}.`,
    );
  }

  const backButton = onExit && (
    <button type="button" aria-label="Exit the collection performance test and return to the start screen" onClick={onExit} className={BUTTON_STYLES.ghost}>
      ← Back to start
    </button>
  );

  return (
    <div className="space-y-4" data-testid="collection-performance-page">
      {state.kind !== "ready" && backButton && <div className="flex justify-start">{backButton}</div>}
      {problem && <ErrorState message={problem} testId="collection-performance-problem" />}
      {state.kind === "loading" && (
        <div aria-busy="true" className="space-y-2">
          <p className="text-sm text-muted">Loading the collection performance plan…</p>
          <Skeleton className="h-40 w-full rounded bg-slate-200 dark:bg-slate-600" />
        </div>
      )}
      {state.kind === "error" && <ErrorState message="The collection performance plan could not be loaded." detail={state.message} testId="collection-performance-error" />}
      {state.kind === "none" && !busy && (
        <EmptyState
          message="No collection performance plan yet"
          description="In Import & Run Collection, choose the requests to load-test and their order, then choose Set up a performance test."
          testId="collection-performance-empty"
        />
      )}
      {busy && state.kind !== "ready" && <p className="text-sm text-muted">Reading the collection…</p>}

      {state.kind === "ready" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {backButton && (
                <>
                  {backButton}
                  <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
                </>
              )}
              <span className="font-semibold">{state.collectionTest.collection.name}</span>
              <StatusBadge label={`Tier: ${state.collectionTest.collection.tier}`} />
              <StatusBadge label={STATE_LABEL[state.collectionTest.collection.state].label} tone={STATE_LABEL[state.collectionTest.collection.state].tone} />
            </div>
            {state.collectionTest.collection.state === "changed" && (
              <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => void rebuild()}>
                Rebuild
              </button>
            )}
          </div>
          {state.collectionTest.collection.state === "deleted" && (
            <p role="note" className="rounded-md border border-danger-500 bg-danger-50 px-3 py-2 text-sm dark:bg-danger-500/10">
              The collection this plan was built from was deleted, so the plan cannot be run or rebuilt. Its runs and reports are kept.
            </p>
          )}
          {notKept && (
            <p role="status" className="rounded-md border border-warning-500 bg-warning-50 px-3 py-2 text-sm dark:bg-warning-500/10">
              {notKept}
            </p>
          )}
          <PerformancePlanScreen
            key={generation}
            client={collectionPerformanceClient}
            title="Collection performance test"
            lead={
              <p>
                The selected requests of {state.collectionTest.collection.name}, in the run order you chose. Values a test script sets become captures for later
                requests. Nothing is sent to any system until you trigger a run.
              </p>
            }
            scopeNote={() => (
              <p className="text-sm">
                The plan is one journey of the selected requests. To change a request, edit it in the collection editor, then rebuild this plan.
              </p>
            )}
            emptyState={
              <EmptyState
                message="Nothing can be load-tested"
                description="Every selected request is left out. The requests and their reasons are under Left out."
                testId="collection-plan-empty"
              />
            }
            onRebuild={() => void rebuild()}
            testId="collection-performance-plan"
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          message="Replace the current collection performance plan with the new selection? Its settings are replaced. Runs and reports are kept."
          affectedCount={1}
          confirmLabel="Replace"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const next = pending;
            setPending(null);
            void build(next, true);
          }}
        />
      )}
    </div>
  );
}
