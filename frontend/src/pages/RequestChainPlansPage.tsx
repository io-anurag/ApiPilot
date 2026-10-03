import { useCallback, useEffect, useState } from "react";
import type { ChainPlanSummary } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PromptDialog } from "../components/PromptDialog";
import { Skeleton } from "../components/Skeleton";
import { StatusBadge } from "../components/StatusBadge";
import { ChainPlanEditor } from "../components/requestChain/ChainPlanEditor";
import { LegacyRunsView } from "../components/requestChain/LegacyRunsView";
import { createPlan, deletePlan, duplicatePlan, listPlans } from "../services/requestChainClient";

/** A request from another view (seeding) to open one plan. The nonce makes a repeat request distinct. */
export interface OpenChainPlanRequest {
  planId: string;
  nonce: number;
}

const SEED_LABELS: Record<NonNullable<ChainPlanSummary["seedSource"]>, string> = {
  specification: "Seeded from a specification",
  workflow: "Seeded from the guided workflow",
  collection: "Seeded from a collection",
};

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plans: ChainPlanSummary[] };

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * AP-037 Request-chain performance plans (specs/037-request-chain-performance US1, FR-039): the
 * session's saved plans, with New, Open, Duplicate and Delete. Opening a plan shows its editor in
 * place of the list. Plans are kept in the local database, so the list survives a backend restart.
 * The layout follows the other screens: a bar with the way back and the main action, then the content.
 * Runs recorded from the retired guided, quick and collection plans are listed below, read only (FR-037).
 */
export function RequestChainPlansPage({ onExit, openRequest }: Readonly<{ onExit?: () => void; openRequest?: OpenChainPlanRequest | null }>) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ kind: "new" } | { kind: "duplicate"; plan: ChainPlanSummary } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChainPlanSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await listPlans();
    setState(result.ok ? { kind: "ready", plans: result.plans } : { kind: "error", message: result.message });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (openRequest) setOpenPlanId(openRequest.planId);
  }, [openRequest]);

  async function handlePromptConfirm(name: string) {
    const current = prompt;
    setPrompt(null);
    setBusy(true);
    setActionError(null);
    const result = current?.kind === "duplicate" ? await duplicatePlan(current.plan.id, name) : await createPlan(name);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    await reload();
    setOpenPlanId(result.plan.id);
  }

  async function handleDelete() {
    const plan = confirmDelete;
    setConfirmDelete(null);
    if (!plan) return;
    setBusy(true);
    setActionError(null);
    const result = await deletePlan(plan.id);
    setBusy(false);
    if (!result.ok) setActionError(result.message);
    await reload();
  }

  const backButton = onExit && (
    <button type="button" aria-label="Exit performance plans and return to the start screen" onClick={onExit} className={BUTTON_STYLES.ghost}>
      ← Back to start
    </button>
  );

  if (openPlanId) {
    return (
      <div className="space-y-4" data-testid="request-chain-plans-page">
        <ChainPlanEditor
          key={openPlanId}
          planId={openPlanId}
          onOpenPlan={setOpenPlanId}
          onBack={() => {
            setOpenPlanId(null);
            void reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="request-chain-plans-page">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {backButton && (
            <>
              {backButton}
              <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
            </>
          )}
          <span className="font-semibold">Performance plans</span>
          {state.kind === "ready" && <StatusBadge label={state.plans.length === 1 ? "1 plan" : `${state.plans.length} plans`} />}
        </div>
        <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => setPrompt({ kind: "new" })}>
          New plan
        </button>
      </div>
      <div className="min-w-0 space-y-0.5">
        <h2 id="chain-plans-title" className="text-lg font-semibold">
          Performance plans
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Build a load test step by step, as in Postman: chains of requests you write and edit, with values passed from one step to
          the next. Plans are saved on this machine and stay yours: nothing is re-derived from a specification or collection.
        </p>
      </div>
      <section aria-labelledby="chain-plans-title" className="space-y-4 rounded-lg border border-border bg-surface p-4">
        {actionError && <ErrorState message={actionError} testId="chain-plans-action-error" />}
        {state.kind === "loading" && (
          <div role="status" aria-label="Loading plans">
            <Skeleton className="h-24 w-full rounded bg-slate-200 dark:bg-slate-600" />
          </div>
        )}
        {state.kind === "error" && (
          <ErrorState message="The plans could not be loaded." detail={state.message} testId="chain-plans-error">
            <button type="button" className={BUTTON_STYLES.secondary} onClick={() => void reload()}>
              Try again
            </button>
          </ErrorState>
        )}
        {state.kind === "ready" && state.plans.length === 0 && (
          <EmptyState message="No plans yet" description="Start an empty plan here, or create one from a specification, the guided workflow or a collection." testId="chain-plans-empty" />
        )}
        {state.kind === "ready" && state.plans.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Saved performance plans</caption>
              <thead className="border-b border-border text-xs uppercase text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Chains</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Steps</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Data sets</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Updated</th>
                  <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="py-2 pr-4">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{plan.name}</span>
                      <span className="block text-xs text-muted">{plan.seedSource ? SEED_LABELS[plan.seedSource] : "Built by you"}</span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{plan.chainCount}</td>
                    <td className="py-2 pr-4 tabular-nums">{plan.stepCount}</td>
                    <td className="py-2 pr-4 tabular-nums">{plan.dataSetCount}</td>
                    <td className="py-2 pr-4 text-muted">{formatUpdated(plan.updatedAt)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Open ${plan.name}`} onClick={() => setOpenPlanId(plan.id)}>
                          Open
                        </button>
                        <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Duplicate ${plan.name}`} disabled={busy} onClick={() => setPrompt({ kind: "duplicate", plan })}>
                          Duplicate
                        </button>
                        <button type="button" className={BUTTON_STYLES.secondary} aria-label={`Delete ${plan.name}`} disabled={busy} onClick={() => setConfirmDelete(plan)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <LegacyRunsView />
      {prompt && (
        <PromptDialog
          title={prompt.kind === "new" ? "New plan" : "Duplicate plan"}
          label="Plan name"
          initialValue={prompt.kind === "duplicate" ? `${prompt.plan.name} (copy)` : ""}
          confirmLabel={prompt.kind === "new" ? "Create plan" : "Duplicate"}
          onConfirm={(name) => void handlePromptConfirm(name)}
          onCancel={() => setPrompt(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"? Its chains, steps and data sets are removed. Its past runs and their reports are kept.`}
          affectedCount={1}
          confirmLabel="Delete plan"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
