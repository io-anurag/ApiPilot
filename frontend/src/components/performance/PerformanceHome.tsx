import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChainPlanSummary } from "@apipilot/shared-domain";
import { deletePlan, duplicatePlan, listPlans } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { PromptDialog } from "../PromptDialog";
import { LegacyRunsView } from "../requestChain/LegacyRunsView";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { RecentRuns } from "./RecentRuns";
import { SourcePicker } from "./path/SourcePicker";
import type { SourceKind } from "./path/pathState";
import { formatDateTimeUtc } from "../../dateTime";

const SEED_LABELS: Record<NonNullable<ChainPlanSummary["seedSource"]>, string> = {
  specification: "Seeded from a specification",
  workflow: "Seeded from the guided workflow",
  collection: "Seeded from a collection",
};

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plans: ChainPlanSummary[] };

/**
 * The Performance tab's entry screen (specs/047-unified-performance-tab FR-002 to FR-005): a source
 * picker, the saved plans with Open, Duplicate and Delete, the recent runs and the earlier runs of the
 * retired plan kinds. With no plans it shows the picker alone, with an introduction and no empty table.
 * Loading, empty, error and ready are distinct states. Deleting a plan keeps its runs and reports.
 */
export function PerformanceHome({
  onPick,
  onOpen,
  onExit,
  banner,
  busy = false,
}: Readonly<{ onPick: (source: SourceKind) => void; onOpen: (planId: string, runId?: string) => void; onExit?: () => void; banner?: ReactNode; busy?: boolean }>) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [duplicating, setDuplicating] = useState<ChainPlanSummary | null>(null);
  const [deleting, setDeleting] = useState<ChainPlanSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const reload = useCallback(async () => {
    const result = await listPlans();
    setState(result.ok ? { kind: "ready", plans: result.plans } : { kind: "error", message: result.message });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleDuplicate(name: string) {
    const plan = duplicating;
    setDuplicating(null);
    if (!plan) return;
    setWorking(true);
    setActionError(null);
    const result = await duplicatePlan(plan.id, name);
    setWorking(false);
    if (!result.ok) setActionError(result.message);
    await reload();
  }

  async function handleDelete() {
    const plan = deleting;
    setDeleting(null);
    if (!plan) return;
    setWorking(true);
    setActionError(null);
    const result = await deletePlan(plan.id);
    setWorking(false);
    if (!result.ok) setActionError(result.message);
    await reload();
  }

  const plans = state.kind === "ready" ? state.plans : [];
  const noPlans = state.kind === "ready" && plans.length === 0;
  const picker = (
    <section aria-labelledby="performance-start-title" className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="performance-source">
      <div className="space-y-1">
        <h3 id="performance-start-title" className="text-base font-semibold">
          {noPlans ? "Start a performance test" : "Start a new performance test"}
        </h3>
        <p className="max-w-3xl text-sm text-muted">Pick a source. A guided path takes you from it to a running k6 test: operations, plan, load profile, run. Every request stays editable and nothing is sent until you run.</p>
      </div>
      <SourcePicker onPick={onPick} disabled={busy} />
    </section>
  );

  return (
    <div className="space-y-4" data-testid="performance-home">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {onExit && (
            <>
              <button type="button" aria-label="Exit performance testing and return to the start screen" className={BUTTON_STYLES.ghost} onClick={onExit}>
                ← Back to start
              </button>
              <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
            </>
          )}
          <span className="font-semibold">Performance</span>
          {state.kind === "ready" && plans.length > 0 && <StatusBadge label={plans.length === 1 ? "1 plan" : `${plans.length} plans`} />}
        </div>
      </div>
      {banner}
      {actionError && <ErrorState message={actionError} testId="performance-action-error" />}

      {noPlans && (
        <div className="space-y-1 pt-2">
          <p className="font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">Performance testing with k6</p>
          <h2 className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight text-text-primary">Turn what you have into a load test</h2>
        </div>
      )}
      {picker}

      {state.kind === "loading" && (
        <div role="status" aria-label="Loading plans">
          <Skeleton className="h-24 w-full rounded bg-surface-strong" />
        </div>
      )}
      {state.kind === "error" && (
        <ErrorState message="The plans could not be loaded." detail={state.message} testId="performance-plans-error">
          <button type="button" className={BUTTON_STYLES.secondary} onClick={() => void reload()}>
            Try again
          </button>
        </ErrorState>
      )}
      {state.kind === "ready" && plans.length > 0 && (
        <>
          <section aria-labelledby="performance-plans-title" className="space-y-2">
            <h3 id="performance-plans-title" className="text-base font-semibold">
              Your plans
            </h3>
            <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Saved performance plans</caption>
                <thead className="border-b border-border text-xs uppercase text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                    <th scope="col" className="px-3 py-2 font-medium">Chains</th>
                    <th scope="col" className="px-3 py-2 font-medium">Steps</th>
                    <th scope="col" className="px-3 py-2 font-medium">Data sets</th>
                    <th scope="col" className="px-3 py-2 font-medium">Updated</th>
                    <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-text-primary">{plan.name}</span>
                        <span className="block text-xs text-muted">{plan.seedSource ? SEED_LABELS[plan.seedSource] : "Built by you"}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{plan.chainCount}</td>
                      <td className="px-3 py-2 tabular-nums">{plan.stepCount}</td>
                      <td className="px-3 py-2 tabular-nums">{plan.dataSetCount}</td>
                      <td className="px-3 py-2 text-muted">{formatDateTimeUtc(plan.updatedAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Open ${plan.name}`} disabled={busy} onClick={() => onOpen(plan.id)}>
                            Open
                          </button>
                          <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Duplicate ${plan.name}`} disabled={working} onClick={() => setDuplicating(plan)}>
                            Duplicate
                          </button>
                          <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Delete ${plan.name}`} disabled={working} onClick={() => setDeleting(plan)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="performance-runs-title" className="space-y-2">
            <h3 id="performance-runs-title" className="text-base font-semibold">
              Recent runs
            </h3>
            <RecentRuns plans={plans} onOpenRun={onOpen} busy={busy} />
          </section>
        </>
      )}
      <LegacyRunsView />

      {duplicating && (
        <PromptDialog title="Duplicate plan" label="Plan name" initialValue={`${duplicating.name} (copy)`} confirmLabel="Duplicate" onConfirm={(name) => void handleDuplicate(name)} onCancel={() => setDuplicating(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          message={`Delete "${deleting.name}"? Its chains, steps and data sets are removed. Its past runs and their reports are kept.`}
          affectedCount={1}
          confirmLabel="Delete plan"
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
