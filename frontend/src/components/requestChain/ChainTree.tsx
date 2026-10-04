import { useEffect, useId, useRef, useState } from "react";
import type { ChainPlan, ChainStep } from "@apipilot/shared-domain";
import { IconButton } from "./IconButton";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";

const RUNS_MARKER: Record<string, string> = {
  "once-before-load": "Once before load",
  "once-per-virtual-user": "Once per user",
};

/** A plan with fewer steps than this is scanned at a glance, so the filter would only add noise. */
const FILTER_MIN_STEPS = 6;

export interface ChainTreeActions {
  onSelect: (stepId: string) => void;
  onAddChain: () => void;
  onRenameChain: (chainId: string) => void;
  onMoveChain: (chainId: string, offset: -1 | 1) => void;
  onDuplicateChain: (chainId: string) => void;
  onDeleteChain: (chainId: string) => void;
  onAddStep: (chainId: string) => void;
}

function matches(step: ChainStep, needle: string): boolean {
  return `${step.method} ${step.name} ${step.url}`.toLowerCase().includes(needle);
}

/**
 * The plan's chains and their steps in run order (FR-001, FR-002). It fills the height its parent
 * gives it and scrolls its own list, so the chain actions stay in reach however many steps the plan
 * has. A chain can be collapsed, and a filter narrows a long plan by method, name or URL. The actions
 * on the selected step live with the step editor, where the step is shown. A step with a blocker is
 * marked in text, not colour alone.
 */
export function ChainTree({
  plan,
  selectedStepId,
  stepsWithIssues,
  busy,
  revealCount,
  actions,
}: Readonly<{
  plan: ChainPlan;
  selectedStepId: string | null;
  stepsWithIssues: ReadonlySet<string>;
  busy: boolean;
  /** Raised each time a step is chosen from outside the tree, so an already selected step is shown again. */
  revealCount: number;
  actions: ChainTreeActions;
}>) {
  const id = useId();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState({ selectedStepId, revealCount });
  const selectedRef = useRef<HTMLLIElement | null>(null);

  // A step chosen from elsewhere (a blocker's "Go to step") must not stay hidden in a collapsed chain.
  if (selectedStepId !== shown.selectedStepId || revealCount !== shown.revealCount) {
    setShown({ selectedStepId, revealCount });
    const owner = plan.chains.find((chain) => chain.steps.some((step) => step.id === selectedStepId));
    if (owner && collapsed.has(owner.id)) {
      const next = new Set(collapsed);
      next.delete(owner.id);
      setCollapsed(next);
    }
  }

  useEffect(() => {
    if (typeof selectedRef.current?.scrollIntoView === "function") selectedRef.current.scrollIntoView({ block: "nearest" });
  }, [selectedStepId, revealCount]);

  const stepCount = plan.chains.reduce((total, chain) => total + chain.steps.length, 0);
  const needle = filter.trim().toLowerCase();
  const filtering = needle !== "";
  const visible = plan.chains
    .map((chain, chainIndex) => ({ chain, chainIndex, steps: filtering ? chain.steps.filter((step) => matches(step, needle)) : chain.steps }))
    .filter((entry) => !filtering || entry.steps.length > 0);
  const allCollapsed = plan.chains.length > 0 && plan.chains.every((chain) => collapsed.has(chain.id));

  function toggle(chainId: string) {
    const next = new Set(collapsed);
    if (!next.delete(chainId)) next.add(chainId);
    setCollapsed(next);
  }

  return (
    <nav aria-label="Chains and steps" className="flex min-h-0 flex-col rounded-lg border border-border bg-surface lg:h-full">
      {stepCount >= FILTER_MIN_STEPS && (
        <div className="shrink-0 border-b border-border p-2">
          <label htmlFor={`${id}-filter`} className="sr-only">
            Filter steps
          </label>
          <input
            id={`${id}-filter`}
            type="search"
            value={filter}
            placeholder="Filter steps by method, name or URL"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            onChange={(event) => setFilter(event.target.value)}
          />
          <p className="sr-only" role="status" aria-live="polite">
            {filtering ? `${visible.reduce((total, entry) => total + entry.steps.length, 0)} of ${stepCount} steps match.` : ""}
          </p>
        </div>
      )}
      <div className="max-h-96 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
        {filtering && visible.length === 0 && <p className="p-3 text-sm text-muted">No step matches "{filter.trim()}".</p>}
        <ol>
          {visible.map(({ chain, chainIndex, steps }) => {
            const loadSteps = chain.steps.filter((step) => step.runs !== "once-before-load").length;
            const open = filtering || !collapsed.has(chain.id);
            const bodyId = `${id}-chain-${chain.id}`;
            return (
              <li key={chain.id} className="border-b border-border last:border-b-0">
                <div className="bg-slate-50 px-3 py-2 dark:bg-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 flex-1 text-sm font-semibold">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={bodyId}
                        disabled={filtering}
                        className="flex w-full min-w-0 items-center gap-1.5 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default"
                        onClick={() => toggle(chain.id)}
                      >
                        <span aria-hidden="true" className={`shrink-0 text-xs text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
                          ▸
                        </span>
                        <span className="min-w-0 truncate" title={chain.name}>
                          {chain.name}
                        </span>
                        <span className="shrink-0 whitespace-nowrap font-normal text-muted">
                          · {filtering ? `${steps.length} of ${chain.steps.length}` : chain.steps.length} {chain.steps.length === 1 ? "step" : "steps"}
                        </span>
                      </button>
                    </h3>
                    {open && (
                      <div role="group" aria-label={`Chain actions for ${chain.name}`} className="flex shrink-0 items-center">
                        <IconButton icon="rename" label={`Rename chain ${chain.name}`} disabled={busy} onClick={() => actions.onRenameChain(chain.id)} />
                        <IconButton icon="up" label={`Move chain ${chain.name} up`} disabled={busy || chainIndex === 0} onClick={() => actions.onMoveChain(chain.id, -1)} />
                        <IconButton icon="down" label={`Move chain ${chain.name} down`} disabled={busy || chainIndex === plan.chains.length - 1} onClick={() => actions.onMoveChain(chain.id, 1)} />
                        <IconButton icon="duplicate" label={`Duplicate chain ${chain.name}`} disabled={busy} onClick={() => actions.onDuplicateChain(chain.id)} />
                        <IconButton icon="delete" danger label={`Delete chain ${chain.name}`} disabled={busy || plan.chains.length === 1} onClick={() => actions.onDeleteChain(chain.id)} />
                      </div>
                    )}
                  </div>
                </div>
                <div id={bodyId} hidden={!open}>
                  {loadSteps === 0 && !filtering && <p className="px-3 pt-2 text-xs text-muted">This chain has no step that runs in the load, so it is not run as a chain.</p>}
                  <ol className="divide-y divide-border">
                    {steps.map((step) => {
                      const selected = step.id === selectedStepId;
                      return (
                        <li key={step.id} ref={selected ? selectedRef : undefined} className={selected ? "bg-brand-50 dark:bg-brand-500/10" : ""}>
                          <button
                            type="button"
                            aria-current={selected ? "true" : undefined}
                            className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                            onClick={() => actions.onSelect(step.id)}
                          >
                            <HttpMethodBadge method={step.method} />
                            <span className="min-w-0 flex-1 truncate" title={step.name}>{step.name}</span>
                            {RUNS_MARKER[step.runs] && <span className="shrink-0 text-xs text-muted">{RUNS_MARKER[step.runs]}</span>}
                            {step.changed && <span className="shrink-0 text-xs text-warning-700 dark:text-warning-200">Changed</span>}
                            {stepsWithIssues.has(step.id) && <span className="shrink-0 text-xs font-medium text-danger-700 dark:text-danger-200">Needs attention</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  {!filtering && (
                    <div className="px-3 py-1.5">
                      <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => actions.onAddStep(chain.id)}>
                        + Add step
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border p-2">
        <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={actions.onAddChain}>
          Add chain
        </button>
        {plan.chains.length > 1 && (
          <button type="button" className={BUTTON_STYLES.ghost} disabled={filtering} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(plan.chains.map((chain) => chain.id)))}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>
    </nav>
  );
}
