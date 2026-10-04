import type { ChainPlan, ChainPlanAnalysis, Environment } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { WriteOperationSummary } from "../performance/WriteOperationSummary";

/**
 * What a run will do to the target, in the words the engineer confirms (AP-037 FR-031, AP-039
 * FR-017): the environment by name, tier and base URL, the chains with their step counts, every host,
 * every data set and every write step. The load run and the Debug run share one summary in one card, so
 * the two never describe their effect differently.
 */
export function RunTargetSummary({
  plan,
  analysis,
  environment,
  chains,
}: Readonly<{
  plan: Pick<ChainPlan, "dataSets">;
  analysis: ChainPlanAnalysis;
  environment: Environment | null;
  /** A chain's `note` says how it differs between the runs this summary describes. */
  chains: readonly { id: string; name: string; steps: readonly unknown[]; note?: string }[];
}>) {
  return (
    <>
      {environment ? (
        <p className="text-sm">
          Target: <span className="font-medium">{environment.name}</span> <StatusBadge label={`Tier: ${environment.tier}`} /> <code className="font-mono text-xs">{environment.baseUrl}</code>
        </p>
      ) : (
        <p className="text-sm text-muted">No target environment chosen.</p>
      )}
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted">Chains</h4>
          <ul className="mt-1 space-y-0.5" data-testid="trigger-chains">
            {chains.map((chain) => (
              <li key={chain.id}>
                {chain.name} · {chain.steps.length} {chain.steps.length === 1 ? "step" : "steps"}
                {chain.note && <span className="text-muted"> ({chain.note})</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted">Hosts</h4>
          <ul className="mt-1 space-y-0.5" data-testid="trigger-hosts">
            {analysis.hosts.map((host) => (
              <li key={host}>
                <code className="font-mono text-xs">{host === "{{baseUrl}}" && environment ? environment.baseUrl : host}</code>
              </li>
            ))}
          </ul>
        </div>
        {plan.dataSets.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted">Data sets</h4>
            <ul className="mt-1 space-y-0.5" data-testid="trigger-data-sets">
              {plan.dataSets.map((dataSet) => (
                <li key={dataSet.id}>
                  {dataSet.name} · {dataSet.rowCount} rows
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <WriteOperationSummary summary={analysis.writeSummary} variant="trigger" />
    </>
  );
}
