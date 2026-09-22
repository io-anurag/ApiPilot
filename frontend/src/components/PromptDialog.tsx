import { useEffect, useRef, useState } from "react";
import { BUTTON_STYLES } from "./controlStyles";
import { Dialog } from "./Dialog";

/**
 * In-app, single-text-field input dialog — the styled replacement for `window.prompt`, which
 * renders as an unstyled native browser dialog outside the application's own theme, focus
 * management, and dark-mode support. Used by `ExternalCollectionsPage` for naming a new request
 * and renaming an existing request/folder.
 */
export function PromptDialog({
  title,
  label,
  initialValue = "",
  confirmLabel = "OK",
  onConfirm,
  onCancel,
}: Readonly<{
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}>) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();

  function handleSubmit() {
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  }

  return (
    <Dialog role="dialog" labelledBy="prompt-dialog-title" testId="prompt-dialog" onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="space-y-3"
      >
        <p id="prompt-dialog-title" className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {title}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="prompt-dialog-input" className="text-xs font-medium text-muted">
            {label}
          </label>
          <input
            id="prompt-dialog-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={BUTTON_STYLES.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={trimmed.length === 0} className={BUTTON_STYLES.primary}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
