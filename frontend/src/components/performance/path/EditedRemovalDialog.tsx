import { useEffect, useId, useRef } from "react";
import { BUTTON_STYLES } from "../../controlStyles";
import { Dialog } from "../../Dialog";
import type { PendingRemoval } from "./usePlanReselect";

/**
 * The question a merge asks before it removes steps the engineer edited (specs/047-unified-performance-tab
 * FR-016): the steps are named, Cancel is focused so an accidental Enter never removes them, and cancelling
 * leaves the plan and the selection exactly as they were.
 */
export function EditedRemovalDialog({ pending, busy, onConfirm, onCancel }: Readonly<{ pending: PendingRemoval; busy: boolean; onConfirm: () => void; onCancel: () => void }>) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const count = pending.edited.length;
  return (
    <Dialog role="alertdialog" labelledBy={titleId} testId="edited-removal-dialog" onClose={onCancel}>
      <div className="space-y-3">
        <h2 id={titleId} className="text-lg font-semibold">
          Remove {count === 1 ? "a step you edited" : `${count} steps you edited`}?
        </h2>
        <p className="text-sm text-muted">This selection no longer includes {count === 1 ? "an operation" : "operations"} whose step you changed. Removing {count === 1 ? "it" : "them"} discards your edits to {count === 1 ? "it" : "them"}.</p>
        <ul className="space-y-1 text-sm" aria-label="Edited steps that would be removed">
          {pending.edited.map((entry) => (
            <li key={entry.stepId} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium">{entry.stepName}</span> <span className="font-mono text-xs text-muted">{entry.operationKey}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={BUTTON_STYLES.secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={BUTTON_STYLES.primary} onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : count === 1 ? "Remove it" : "Remove them"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
