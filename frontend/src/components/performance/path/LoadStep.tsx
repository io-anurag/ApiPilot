import { ErrorState } from "../../ErrorState";
import { SetupPane } from "../../requestChain/SetupPane";
import type { ChainPlanSession } from "../../requestChain/useChainPlanSession";

/**
 * Step 4 of the Performance path (specs/047-unified-performance-tab FR-026): the plan's existing load
 * controls, unchanged: target environment, the staged load profile with its starting profiles,
 * thresholds, think time, data sets and the k6 script, each with its own validation.
 */
export function LoadStep({ session }: Readonly<{ session: ChainPlanSession }>) {
  return (
    <div className="space-y-4" data-testid="load-step">
      <p className="max-w-3xl text-sm text-muted">Choose where the plan runs and how much load it puts there. Review each part, edit only what needs to change.</p>
      {session.saveError && <ErrorState message={session.saveError} testId="plan-save-error" />}
      <SetupPane session={session} />
    </div>
  );
}
