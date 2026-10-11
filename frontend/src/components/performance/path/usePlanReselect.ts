import { useCallback, useState } from "react";
import { seededOperationKeys, type ChainPlan, type QuickPerformanceTestView, type ReselectEditedRemoval, type ReselectMode } from "@apipilot/shared-domain";
import { reselectPlan } from "../../../services/requestChainClient";
import type { ChainPlanSession } from "../../requestChain/useChainPlanSession";
import { sourceOfPlan } from "./planSource";

/** Whether the plan's operations can be changed now, and if not whether that is worth saying (FR-015). */
export type ChangeOperationsAvailability = { kind: "hidden" } | { kind: "disabled"; reason: string } | { kind: "enabled" };

/**
 * Only a plan seeded from a specification can have its operations changed, and only while the uploaded
 * specification is the one it was seeded from; otherwise the reselect would read the wrong document.
 */
export function changeOperationsAvailability(plan: ChainPlan, quick: QuickPerformanceTestView | null): ChangeOperationsAvailability {
  const origin = sourceOfPlan(plan);
  if (origin.source !== "specification") return { kind: "hidden" };
  if (!quick) return { kind: "disabled", reason: `The specification this plan was seeded from (${origin.label}) is no longer uploaded. Upload it again from the entry screen, then open this plan.` };
  if (quick.specification.filename !== origin.label) return { kind: "disabled", reason: `This plan was seeded from ${origin.label}; the uploaded specification is now ${quick.specification.filename}.` };
  return { kind: "enabled" };
}

export interface PendingRemoval {
  keys: readonly string[];
  edited: readonly ReselectEditedRemoval[];
}

export interface PlanReselect {
  busy: boolean;
  /** Why the last change was refused, shown where it was asked for. */
  error: string | null;
  /** What the last change did, in words. */
  notice: string | null;
  /** A merge that would remove steps the engineer edited, waiting for their decision (FR-016). */
  pending: PendingRemoval | null;
  /** Applies `keys` to the plan; resolves `true` when the plan now follows the selection. */
  apply: (mode: ReselectMode, keys: readonly string[]) => Promise<boolean>;
  confirmPending: () => Promise<boolean>;
  cancelPending: () => void;
  clear: () => void;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function noticeOf(mode: ReselectMode, added: number, removed: number): string {
  if (mode === "reset") return "The steps were reset to the seed. Your name, data sets, load profile, run-wide thresholds, environment and saved runs were kept.";
  if (added === 0 && removed === 0) return "The plan already follows this selection.";
  return `Plan updated: ${plural(added, "operation", "operations")} added, ${plural(removed, "operation", "operations")} removed. Your edits to the other steps were kept.`;
}

/**
 * Applying a changed operation selection to the open plan (specs/047-unified-performance-tab FR-015 to
 * FR-017): a merge keeps the engineer's edits; one that would remove edited steps names them and waits
 * for a decision; a reset rebuilds the chains. Nothing is sent to any system. A stale revision reloads the
 * plan the way a save does, and a refusal changes nothing.
 */
export function usePlanReselect(session: ChainPlanSession, onApplied: (selection: readonly string[]) => void): PlanReselect {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const { plan, applyView } = session;

  const run = useCallback(
    async (mode: ReselectMode, keys: readonly string[], confirm: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      const result = await reselectPlan(plan.id, { revision: plan.revision, mode, selectedOperationKeys: [...keys], ...(confirm ? { confirmRemoveEdited: true } : {}) });
      setBusy(false);
      if (result.ok) {
        setPending(null);
        applyView(result);
        onApplied(seededOperationKeys(result.plan));
        setNotice(noticeOf(mode, result.added.length, result.removed.length));
        return true;
      }
      if (result.error === "edited_steps_would_be_removed" && result.edited) {
        setPending({ keys, edited: result.edited });
        return false;
      }
      if (result.error === "plan_revision_conflict" && result.current) {
        applyView(result.current);
        setError("The plan was changed elsewhere and has been reloaded. Make your change again.");
        return false;
      }
      setError(result.message);
      return false;
    },
    [applyView, onApplied, plan.id, plan.revision],
  );

  return {
    busy,
    error,
    notice,
    pending,
    apply: (mode, keys) => run(mode, keys, false),
    confirmPending: () => (pending ? run("merge", pending.keys, true) : Promise.resolve(false)),
    cancelPending: () => setPending(null),
    clear: () => {
      setError(null);
      setNotice(null);
    },
  };
}
