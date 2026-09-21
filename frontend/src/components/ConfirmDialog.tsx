import { useEffect, useRef, useState } from "react";
import { BUTTON_STYLES } from "./controlStyles";
import { Dialog } from "./Dialog";

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
  confirmDisabled = false,
  confirmDisabledMessage,
  errorOnlyMessage,
  onConfirm,
  onCancel,
}: Readonly<{
  message: string;
  affectedCount: number;
  requireReason?: boolean;
  reasonLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmDisabledMessage?: string;
  errorOnlyMessage?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}>) {
  const [reason, setReason] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const reasonMissing = Boolean(requireReason) && reason.trim().length === 0;

  function handleConfirm() {
    onConfirm(requireReason ? reason : undefined);
  }

  return (
    <Dialog
      role="alertdialog"
      labelledBy="confirm-dialog-message"
      testId="confirm-dialog"
      onClose={onCancel}
    >
      <>
        {errorOnlyMessage ? (
          <p
            id="confirm-dialog-message"
            role="alert"
            className="text-sm font-medium text-danger-700 dark:text-danger-200"
          >
            {errorOnlyMessage}
          </p>
        ) : (
          <>
            <p
              id="confirm-dialog-message"
              className="text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              {message}
            </p>
            <p data-testid="confirm-dialog-count" className="text-sm text-muted">
              {affectedCount} item{affectedCount === 1 ? "" : "s"} will be affected.
            </p>
            {confirmDisabledMessage && (
              <p role="alert" className="text-sm font-medium text-danger-700 dark:text-danger-200">
                {confirmDisabledMessage}
              </p>
            )}
          </>
        )}
        {!errorOnlyMessage && requireReason && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="confirm-dialog-reason"
              className="text-xs font-medium text-muted"
            >
              {reasonLabel}
            </label>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          {errorOnlyMessage ? (
            <button
              type="button"
              ref={cancelButtonRef}
              onClick={onCancel}
              className={BUTTON_STYLES.primary}
            >
              OK
            </button>
          ) : (
            <>
              <button
                type="button"
                ref={cancelButtonRef}
                onClick={onCancel}
                className={BUTTON_STYLES.secondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={reasonMissing || confirmDisabled}
                className={BUTTON_STYLES.primary}
              >
                {confirmLabel} ({affectedCount})
              </button>
            </>
          )}
        </div>
      </>
    </Dialog>
  );
}
