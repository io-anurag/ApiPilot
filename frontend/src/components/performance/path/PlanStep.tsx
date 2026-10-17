import { useEffect, useState, type ReactNode } from "react";
import { isPlanEdited } from "@apipilot/shared-domain";
import { BUTTON_STYLES, FIELD_STYLES } from "../../controlStyles";
import { ErrorState } from "../../ErrorState";
import { StatusBadge } from "../../StatusBadge";
import { Banner } from "../../patterns/Banner";
import { Card } from "../../patterns/Card";
import { ChainsPane } from "../../requestChain/ChainsPane";
import type { ChainPlanSession } from "../../requestChain/useChainPlanSession";
import type { ChangeOperationsAvailability, PlanReselect } from "./usePlanReselect";

/**
 * Step 3 of the Performance path (specs/047-unified-performance-tab FR-011, FR-012, FR-015 to FR-018): the
 * plan's name and its chains, hosted from the same editor state as the plan editor's Chains tab, with
 * Change operations and Reset to seed for a plan seeded from a specification. Every edit is saved as it is
 * made and the header says whether it is. Steps are authored by the engineer and not verified by ApiPilot,
 * and nothing is sent until a run is started (constitution XVII).
 */
export function PlanStep({
  session,
  changeOperations,
  reselect,
  panelOpen,
  onOpenChangeOperations,
  onAskReset,
  extra,
}: Readonly<{
  session: ChainPlanSession;
  changeOperations: ChangeOperationsAvailability;
  reselect: PlanReselect;
  /** The Change operations panel is open, so its own error is shown there and not here. */
  panelOpen: boolean;
  onOpenChangeOperations: () => void;
  onAskReset: () => void;
  extra?: ReactNode;
}>) {
  const { plan, saveError, announcement, announcementQuiet } = session;
  const [name, setName] = useState(plan.name);
  useEffect(() => setName(plan.name), [plan.name]);
  const edited = plan.seedingReport !== null && isPlanEdited(plan);

  function commitName() {
    if (name === plan.name) return;
    session.change({ ...plan, name }, true);
  }

  return (
    <div className="space-y-4" data-testid="plan-step">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <label htmlFor="performance-plan-name" className="text-sm font-medium text-text-primary">
              Plan name
            </label>
            <input
              id="performance-plan-name"
              className={`${FIELD_STYLES} block w-80 max-w-full`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {edited && <StatusBadge label="Edited by you" tone="warning" title="Some steps were changed, added or reordered after the plan was seeded." />}
            {changeOperations.kind !== "hidden" && (
              <button type="button" className={BUTTON_STYLES.secondary} disabled={changeOperations.kind === "disabled" || reselect.busy} onClick={onOpenChangeOperations}>
                Change operations…
              </button>
            )}
            {changeOperations.kind === "enabled" && edited && (
              <button type="button" className={BUTTON_STYLES.secondary} disabled={reselect.busy} onClick={onAskReset}>
                Reset to seed…
              </button>
            )}
            {extra}
          </div>
        </div>
        {changeOperations.kind === "disabled" && (
          <p className="text-sm text-text-secondary" data-testid="change-operations-unavailable">
            {changeOperations.reason}
          </p>
        )}
        <p className="max-w-3xl text-sm text-text-secondary">Every request is yours to edit. Steps are authored by you and not verified by ApiPilot. Nothing is sent to any system until you trigger a run.</p>
      </Card>
      <p className="sr-only" role="status" aria-live="polite" data-testid="plan-announcement">
        {announcement}
      </p>
      {announcement && !announcementQuiet && <Banner tone="neutral" title={announcement} />}
      {reselect.notice && <Banner tone="neutral" role="status" testId="reselect-notice" title={reselect.notice} />}
      {reselect.error && !panelOpen && <ErrorState message={reselect.error} testId="reselect-error" />}
      {saveError && <ErrorState message={saveError} testId="plan-save-error" />}
      <ChainsPane session={session} />
    </div>
  );
}
