import { useState } from "react";
import { BUTTON_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";

/**
 * AP-035 FR-001, FR-002: choose an operation of the plan to add as a step. Used for a new journey
 * (with its name) and for adding a step to one. An operation already in a journey can be added
 * again; each occurrence is its own step.
 */
export function AddStepDialog({
  title,
  operationKeys,
  withName = false,
  confirmLabel,
  onConfirm,
  onCancel,
}: Readonly<{
  title: string;
  operationKeys: readonly string[];
  /** A new journey also needs a name. */
  withName?: boolean;
  confirmLabel: string;
  onConfirm: (choice: { name: string; operationKey: string }) => void;
  onCancel: () => void;
}>) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const shown = operationKeys.filter((key) => key.toLowerCase().includes(filter.trim().toLowerCase()));
  const [operationKey, setOperationKey] = useState(operationKeys[0] ?? "");
  const chosen = shown.includes(operationKey) ? operationKey : (shown[0] ?? "");
  const canConfirm = chosen !== "" && (!withName || name.trim() !== "");

  return (
    <Dialog role="dialog" labelledBy="add-step-dialog-title" testId="add-step-dialog" onClose={onCancel}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) onConfirm({ name: name.trim(), operationKey: chosen });
        }}
      >
        <p id="add-step-dialog-title" className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {title}
        </p>
        {withName && (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Journey name
            <input
              autoFocus
              type="text"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Find an operation
          <input
            autoFocus={!withName}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {withName ? "First step" : "Operation"}
          <select
            value={chosen}
            onChange={(event) => setOperationKey(event.target.value)}
            size={Math.min(8, Math.max(2, shown.length))}
            className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
          >
            {shown.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        {shown.length === 0 && <p className="text-xs text-muted">No operation matches.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_STYLES.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={BUTTON_STYLES.primary} disabled={!canConfirm}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
