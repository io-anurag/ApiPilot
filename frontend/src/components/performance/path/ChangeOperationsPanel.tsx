import { useEffect, useId, useRef, useState } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../../controlStyles";
import { Dialog } from "../../Dialog";
import { ErrorState } from "../../ErrorState";
import { OperationSelection } from "../../requestChain/OperationSelection";
import { operationKeysOf } from "./OperationsStep";
import type { PlanReselect } from "./usePlanReselect";

/**
 * The Change operations panel on the Plan step (specs/047-unified-performance-tab FR-015): the
 * specification's operations with the plan's current selection. Cancel changes nothing. Apply merges: the
 * deselected steps are removed, newly selected ones are added at the end, and the engineer's edits to the
 * rest are kept. A merge that would remove edited steps is confirmed separately, naming them.
 */
export function ChangeOperationsPanel({
  quickTest,
  initialSelection,
  reselect,
  blocked,
  onClose,
}: Readonly<{
  quickTest: QuickPerformanceTestView;
  initialSelection: readonly string[];
  reselect: PlanReselect;
  /** Why Apply cannot be used right now, such as a save still in progress. */
  blocked: string | null;
  onClose: () => void;
}>) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The dialog shell traps focus but does not place it: start on the heading so a keyboard or screen reader user begins at the title.
  useEffect(() => headingRef.current?.focus(), []);
  const [selection, setSelection] = useState<readonly string[]>(initialSelection);
  const all = operationKeysOf(quickTest);
  const reason = blocked ?? (selection.length === 0 ? "Choose at least one operation." : null);

  async function apply() {
    const done = await reselect.apply("merge", selection);
    if (done) onClose();
  }

  // The edited-removal question is on top of the panel while it is open: closing the panel then would hide it.
  return (
    <Dialog labelledBy={titleId} testId="change-operations-panel" panelClassName="w-full max-w-4xl space-y-4 rounded-lg border border-brand-300 bg-surface p-4 shadow-xl dark:border-brand-500" onClose={reselect.pending ? () => undefined : onClose}>
      <div className="space-y-1">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          Change operations
        </h2>
        <p className="text-sm text-muted">
          Deselected operations are removed from the plan and newly selected ones are added at the end. Your edits to the steps that stay are kept, in the order you gave them.
        </p>
      </div>
      <OperationSelection operations={quickTest.specification.operations} checkedKeys={new Set(selection)} onChange={(next) => setSelection(all.filter((key) => next.has(key)))} />
      {reselect.error && <ErrorState message={reselect.error} testId="change-operations-error" />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {reason && (
          <p role="status" className="mr-auto text-sm text-muted">
            {reason}
          </p>
        )}
        <button type="button" className={BUTTON_STYLES.secondary} onClick={onClose} disabled={reselect.busy}>
          Cancel
        </button>
        <button type="button" className={BUTTON_STYLES.primary} disabled={reselect.busy || reason !== null} onClick={() => void apply()}>
          {reselect.busy ? "Applying…" : "Apply to plan"}
        </button>
      </div>
    </Dialog>
  );
}
