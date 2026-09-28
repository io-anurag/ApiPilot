import type { ReactNode } from "react";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { StateMark } from "./SetupItem";

/**
 * What still blocks a run, shown once above the plan's tabs so it is visible on every tab. Each
 * item says what is missing and offers the one action that fixes it; an item disappears when it is
 * done. With nothing left it says the plan is ready and where the run trigger is. It never holds
 * the trigger itself: the trigger stays beside the write list and the target it names (AP-032
 * FR-011, AP-029 FR-025).
 */
export interface PendingAction {
  label: string;
  /** The accessible name, when the visible label alone is ambiguous out of context. */
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface PendingItem {
  id: string;
  state: "attention" | "todo";
  text: ReactNode;
  action?: PendingAction;
  /** Why the action is disabled. */
  hint?: string;
  detail?: ReactNode;
}

function ActionButton({ action }: Readonly<{ action: PendingAction }>) {
  return (
    <button
      type="button"
      className={BUTTON_STYLES.secondary}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
}

export function PendingBar({
  items,
  ready,
  idleText,
  running,
  notes,
}: Readonly<{
  items: readonly PendingItem[];
  /** Shown when nothing is pending and a run can start. */
  ready: { text: ReactNode; action: PendingAction } | null;
  /** Shown when nothing is pending but the plan is not ready yet either (k6 still being checked). */
  idleText?: string;
  /** Offered while a run is in progress. */
  running: PendingAction | null;
  /** Things worth knowing that do not block a run. */
  notes: readonly ReactNode[];
}>) {
  let tone = "border-border bg-surface";
  if (items.length > 0) tone = "border-warning-500 bg-warning-50 dark:bg-warning-500/10";
  else if (ready) tone = "border-success-500 bg-success-50 dark:bg-success-500/10";

  return (
    <section aria-label="What still blocks a run" data-testid="performance-pending" className={`space-y-2 rounded-lg border px-4 py-3 ${tone}`}>
      {running && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge label="Run in progress" tone="info" />
          <button type="button" className={BUTTON_STYLES.ghost} onClick={running.onClick}>
            {running.label}
          </button>
        </p>
      )}
      {items.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-warning-700 dark:text-warning-100">
            Before you can run: {items.length} {items.length === 1 ? "thing" : "things"} left
          </h3>
          <ul className="divide-y divide-warning-500/30">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2">
                <StateMark state={item.state} />
                <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                  <p>{item.text}</p>
                  {item.detail}
                </div>
                {item.action && (
                  <div className="flex flex-col items-end gap-0.5">
                    <ActionButton action={item.action} />
                    {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {items.length === 0 && ready && (
        <div className="flex flex-wrap items-center gap-3">
          <StateMark state="done" />
          <p className="min-w-0 flex-1 text-sm font-medium">{ready.text}</p>
          <ActionButton action={ready.action} />
        </div>
      )}
      {items.length === 0 && !ready && idleText && <p className="text-sm text-muted">{idleText}</p>}
      {notes.map((note, index) => (
        // Notes are recomputed together on every render and never reorder independently.
        <p key={index} className="text-xs text-muted">
          {note}
        </p>
      ))}
    </section>
  );
}
