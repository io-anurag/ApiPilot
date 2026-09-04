import { useEffect, useRef, useState } from "react";

/**
 * Shared confirmation step for a bulk decision (FR-011): shows the number of items the action
 * will affect and, for a bulk reject, collects the one shared justification applied to every
 * targeted item (spec Assumptions). Cancel is focused by default so an accidental Enter/Space
 * never confirms a large bulk action (FR-014, FR-015).
 */
export function ConfirmDialog({
  message,
  affectedCount,
  requireReason,
  reasonLabel = "Reason",
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  message: string;
  affectedCount: number;
  requireReason?: boolean;
  reasonLabel?: string;
  confirmLabel?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const reasonMissing = Boolean(requireReason) && reason.trim().length === 0;

  function handleConfirm() {
    onConfirm(requireReason ? reason : undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        data-testid="confirm-dialog"
        className="w-full max-w-md space-y-3 rounded-lg border border-brand-300 bg-surface p-4 shadow-xl"
      >
        <p id="confirm-dialog-message" className="text-sm font-medium text-slate-900">
          {message}
        </p>
        <p data-testid="confirm-dialog-count" className="text-sm text-muted">
          {affectedCount} item{affectedCount === 1 ? "" : "s"} will be affected.
        </p>
        {requireReason && (
          <div className="flex flex-col gap-1">
            <label htmlFor="confirm-dialog-reason" className="text-xs font-medium text-muted">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            ref={cancelButtonRef}
            onClick={onCancel}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={reasonMissing}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel} ({affectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
