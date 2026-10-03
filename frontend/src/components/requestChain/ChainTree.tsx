import type { ChainPlan } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";

const RUNS_MARKER: Record<string, string> = {
  "once-before-load": "Once before load",
  "once-per-virtual-user": "Once per user",
};

export interface ChainTreeActions {
  onSelect: (stepId: string) => void;
  onAddChain: () => void;
  onRenameChain: (chainId: string) => void;
  onMoveChain: (chainId: string, offset: -1 | 1) => void;
  onDuplicateChain: (chainId: string) => void;
  onDeleteChain: (chainId: string) => void;
  onAddStep: (chainId: string) => void;
  onMoveStep: (stepId: string, offset: -1 | 1) => void;
  onMoveStepToChain: (stepId: string, chainId: string) => void;
  onDuplicateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
}

/**
 * The plan's chains and their steps in run order (FR-001, FR-002), with every structural action as a
 * button. Moving a step is never refused (FR-014): the issues panel lists what an order breaks. A
 * step with a blocker is marked in text, not colour alone.
 */
export function ChainTree({
  plan,
  selectedStepId,
  stepsWithIssues,
  busy,
  actions,
}: Readonly<{ plan: ChainPlan; selectedStepId: string | null; stepsWithIssues: ReadonlySet<string>; busy: boolean; actions: ChainTreeActions }>) {
  return (
    <nav aria-label="Chains and steps" className="space-y-3">
      <ol className="space-y-3">
        {plan.chains.map((chain, chainIndex) => {
          const loadSteps = chain.steps.filter((step) => step.runs !== "once-before-load").length;
          return (
            <li key={chain.id} className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h3 className="min-w-0 truncate text-sm font-semibold">
                  {chain.name} <span className="font-normal text-muted">· {chain.steps.length} {chain.steps.length === 1 ? "step" : "steps"}</span>
                </h3>
                <div className="flex flex-wrap gap-1 text-xs">
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} aria-label={`Rename chain ${chain.name}`} onClick={() => actions.onRenameChain(chain.id)}>
                    Rename
                  </button>
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || chainIndex === 0} aria-label={`Move chain ${chain.name} up`} onClick={() => actions.onMoveChain(chain.id, -1)}>
                    ↑
                  </button>
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || chainIndex === plan.chains.length - 1} aria-label={`Move chain ${chain.name} down`} onClick={() => actions.onMoveChain(chain.id, 1)}>
                    ↓
                  </button>
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} aria-label={`Duplicate chain ${chain.name}`} onClick={() => actions.onDuplicateChain(chain.id)}>
                    Duplicate
                  </button>
                  <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || plan.chains.length === 1} aria-label={`Delete chain ${chain.name}`} onClick={() => actions.onDeleteChain(chain.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {loadSteps === 0 && <p className="px-3 pt-2 text-xs text-muted">This chain has no step that runs in the load, so it is not run as a chain.</p>}
              <ol className="divide-y divide-border">
                {chain.steps.map((step, stepIndex) => {
                  const selected = step.id === selectedStepId;
                  return (
                    <li key={step.id} className={`px-3 py-2 ${selected ? "bg-brand-50 dark:bg-brand-500/10" : ""}`}>
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        className="flex w-full min-w-0 items-center gap-2 rounded text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        onClick={() => actions.onSelect(step.id)}
                      >
                        <HttpMethodBadge method={step.method} />
                        <span className="min-w-0 flex-1 truncate">{step.name}</span>
                        {RUNS_MARKER[step.runs] && <span className="shrink-0 text-xs text-muted">{RUNS_MARKER[step.runs]}</span>}
                        {step.changed && <span className="shrink-0 text-xs text-warning-700 dark:text-warning-200">Changed</span>}
                        {stepsWithIssues.has(step.id) && <span className="shrink-0 text-xs font-medium text-danger-700 dark:text-danger-200">Needs attention</span>}
                      </button>
                      {selected && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || stepIndex === 0} onClick={() => actions.onMoveStep(step.id, -1)}>
                            Move up
                          </button>
                          <button type="button" className={BUTTON_STYLES.ghost} disabled={busy || stepIndex === chain.steps.length - 1} onClick={() => actions.onMoveStep(step.id, 1)}>
                            Move down
                          </button>
                          <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => actions.onDuplicateStep(step.id)}>
                            Duplicate
                          </button>
                          <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => actions.onDeleteStep(step.id)}>
                            Delete
                          </button>
                          {plan.chains.length > 1 && (
                            <label className="inline-flex items-center gap-1">
                              <span>Move to</span>
                              <select
                                className="rounded border border-border bg-surface px-1 py-0.5"
                                value=""
                                disabled={busy}
                                onChange={(event) => event.target.value && actions.onMoveStepToChain(step.id, event.target.value)}
                              >
                                <option value="">chain…</option>
                                {plan.chains
                                  .filter((other) => other.id !== chain.id)
                                  .map((other) => (
                                    <option key={other.id} value={other.id}>
                                      {other.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="px-3 py-2">
                <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => actions.onAddStep(chain.id)}>
                  + Add step
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={actions.onAddChain}>
        Add chain
      </button>
    </nav>
  );
}
