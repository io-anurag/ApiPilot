import { useRef } from "react";
import type { ChainPlanSession } from "./useChainPlanSession";
import { ChainRunPanel } from "./ChainRunPanel";
import { RunLaunchCard } from "./RunLaunchCard";

/**
 * The launch card above the plan's runs and reports (specs/037 US3, AP-040): what blocks a run, the run
 * and Debug run triggers with the named target and every write, then what ran. Shown as the Performance
 * path's Run step; the plan editor keeps the two as separate tabs. "View runs" brings the reports into view.
 */
export function RunPane({ session, onGoToSetup }: Readonly<{ session: ChainPlanSession; onGoToSetup: () => void }>) {
  const { plan, analysis, script, environment, environments, runs, runsClient, dirty } = session;
  const runsRef = useRef<HTMLDivElement | null>(null);
  const onRestore = (runId: string, into: "plan" | "new-plan") => void session.restore(runId, into);
  const viewRuns = () => {
    if (typeof runsRef.current?.scrollIntoView === "function") runsRef.current.scrollIntoView({ block: "start" });
  };
  return (
    <div className="space-y-5">
      <RunLaunchCard onViewRuns={viewRuns} plan={plan} analysis={analysis} script={script} environment={environment} environments={environments} runs={runs} runsClient={runsClient} dirty={dirty} onRestore={onRestore} />
      <div ref={runsRef} className="scroll-mt-2">
        <ChainRunPanel onGoToSetup={onGoToSetup} plan={plan} analysis={analysis} script={script} environment={environment} environments={environments} runs={runs} runsClient={runsClient} dirty={dirty} onRestore={onRestore} />
      </div>
    </div>
  );
}
