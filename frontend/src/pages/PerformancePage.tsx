import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PerformanceHome } from "../components/performance/PerformanceHome";
import { DraftBanner } from "../components/performance/path/DraftBanner";
import { operationKeysOf } from "../components/performance/path/OperationsStep";
import { PerformancePathView } from "../components/performance/path/PerformancePath";
import type { SourceKind } from "../components/performance/path/pathState";
import { sourceOfPlan } from "../components/performance/path/planSource";
import { ErrorState } from "../components/ErrorState";
import { useQuickTest } from "../hooks/useQuickTest";
import { usePerformancePath } from "../hooks/usePerformancePath";
import { createPlan, fetchPlan } from "../services/requestChainClient";

/** A request from another view (a seeding entry point) to open one plan. The nonce makes a repeat request distinct. */
export interface OpenPerformancePlanRequest {
  planId: string;
  nonce: number;
}

/**
 * The Performance tab (specs/047-unified-performance-tab): the entry screen, and the five-step path it
 * opens. It replaces Quick Performance Test and Performance Plans. State lives in the mounted page and is
 * kept by App across "Back to start" and tab switches (FR-021); nothing new is persisted. It never sends
 * a request to any system: a run starts only from the Run step's own Start (constitution XVII).
 */
export function PerformancePage({ onExit, openRequest, onDraftChange }: Readonly<{ onExit?: () => void; openRequest?: OpenPerformancePlanRequest | null; onDraftChange?: (hasDraft: boolean) => void }>) {
  const path = usePerformancePath();
  const { openPlan } = path;
  const quickTest = useQuickTest();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  // A source picked while a draft exists waits here for the engineer's answer (FR-020).
  const [pending, setPending] = useState<{ message: string; confirm: () => void } | null>(null);
  const hasDraft = path.draft;
  useEffect(() => onDraftChange?.(hasDraft), [hasDraft, onDraftChange]);

  const open = useCallback(
    async (planId: string) => {
      setOpening(true);
      setOpenError(null);
      const result = await fetchPlan(planId);
      setOpening(false);
      if (!result.ok) {
        setOpenError(result.message);
        return;
      }
      const origin = sourceOfPlan(result.plan);
      openPlan(planId, origin.source, origin.selection);
    },
    [openPlan],
  );

  // A seeding entry point opened a plan (specs/037 FR-020): land on its Plan step.
  useEffect(() => {
    if (openRequest) void open(openRequest.planId);
  }, [openRequest, open]);

  /** An empty plan has nothing to choose, so it is created at once and opens on its Plan step (FR-007). */
  async function startEmpty() {
    setOpening(true);
    setOpenError(null);
    const result = await createPlan("New plan");
    setOpening(false);
    if (!result.ok) {
      setOpenError(result.message);
      return;
    }
    path.openPlan(result.plan.id, "empty", []);
  }

  function handlePick(source: SourceKind) {
    if (path.draft) {
      setPending({
        message: "A draft test is in progress. Starting a new one discards it.",
        confirm: () => {
          path.discard();
          start(source);
        },
      });
      return;
    }
    start(source);
  }

  /** Opening a saved plan replaces the draft too, so it asks as well (FR-020). */
  function handleOpen(planId: string) {
    if (path.draft) {
      setPending({
        message: "A draft test is in progress. Opening a plan discards it.",
        confirm: () => {
          path.discard();
          void open(planId);
        },
      });
      return;
    }
    void open(planId);
  }

  function start(source: SourceKind) {
    if (source === "empty") {
      void startEmpty();
      return;
    }
    const loaded = quickTest.state.kind === "ready" ? quickTest.state.quickTest : null;
    path.pick(source, loaded !== null, source === "specification" && loaded ? operationKeysOf(loaded) : []);
  }

  if (path.visible) return <div data-testid="performance-page"><PerformancePathView path={path} quickTest={quickTest} onExit={onExit} /></div>;
  return (
    <div className="space-y-4" data-testid="performance-page">
      {openError && <ErrorState message="The plan could not be opened." detail={openError} testId="performance-open-error" />}
      <PerformanceHome
        onPick={handlePick}
        onOpen={handleOpen}
        onExit={onExit}
        busy={opening}
        banner={path.draft ? <DraftBanner draft={path.state} onResume={path.resume} onDiscard={path.discard} /> : undefined}
      />
      {pending && (
        <ConfirmDialog
          message={pending.message}
          affectedCount={1}
          confirmLabel="Discard the draft"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending.confirm;
            setPending(null);
            action();
          }}
        />
      )}
    </div>
  );
}
