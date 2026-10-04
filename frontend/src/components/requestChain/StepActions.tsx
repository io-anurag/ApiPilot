import type { ChainPlan, ChainStep } from "@apipilot/shared-domain";
import { IconButton } from "./IconButton";

export interface StepActionHandlers {
  onMoveStep: (stepId: string, offset: -1 | 1) => void;
  onMoveStepToChain: (stepId: string, chainId: string) => void;
  onDuplicateStep: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
}

/**
 * The structural actions for the step being edited (FR-002, FR-014). They sit in the step editor's
 * header, so they are in reach wherever the step is in a long tree. Moving a step is never refused:
 * the plan check lists what an order breaks.
 */
export function StepActions({ plan, step, busy, actions }: Readonly<{ plan: ChainPlan; step: ChainStep; busy: boolean; actions: StepActionHandlers }>) {
  const chain = plan.chains.find((candidate) => candidate.steps.some((entry) => entry.id === step.id));
  if (!chain) return null;
  const index = chain.steps.findIndex((entry) => entry.id === step.id);
  return (
    <div role="group" aria-label="Step actions" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      <IconButton icon="up" label="Move up" disabled={busy || index === 0} onClick={() => actions.onMoveStep(step.id, -1)} />
      <IconButton icon="down" label="Move down" disabled={busy || index === chain.steps.length - 1} onClick={() => actions.onMoveStep(step.id, 1)} />
      <IconButton icon="duplicate" label="Duplicate" disabled={busy} onClick={() => actions.onDuplicateStep(step.id)} />
      <IconButton icon="delete" danger label="Delete" disabled={busy} onClick={() => actions.onDeleteStep(step.id)} />
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
  );
}
