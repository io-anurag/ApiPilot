import { ErrorState } from "../../ErrorState";
import { RunPane } from "../../requestChain/RunPane";
import type { ChainPlanSession } from "../../requestChain/useChainPlanSession";

/**
 * Step 5 of the Performance path (specs/047-unified-performance-tab FR-027 to FR-029): the launch card,
 * which names the target environment and lists every write beside Start (no extra gate: AP-029,
 * AP-040), then progress, results and reports. Nothing is sent until the engineer presses Start
 * (constitution XVII). Back returns to Load to edit the profile; the header returns to the plans.
 */
export function RunStep({ session, onEditLoad }: Readonly<{ session: ChainPlanSession; onEditLoad: () => void }>) {
  return (
    <div className="space-y-4" data-testid="run-step">
      {session.saveError && <ErrorState message={session.saveError} testId="plan-save-error" />}
      <RunPane session={session} onGoToSetup={onEditLoad} />
    </div>
  );
}
