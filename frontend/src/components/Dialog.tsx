import { useRef, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Single source of truth for the modal shell (backdrop, focus trap, Escape-to-close, and
 * focus-restore-on-close) previously hand-rolled inside `ConfirmDialog` (spec 027 FR-006).
 * Initial focus placement stays the caller's own responsibility (e.g. `ConfirmDialog`
 * deliberately focuses Cancel, not Confirm) — this component only traps and restores focus, it
 * doesn't decide where focus starts.
 */
export function Dialog({
  role = "dialog",
  labelledBy,
  panelClassName = "w-full max-w-md space-y-3 rounded-2xl border border-border bg-surface p-5 shadow-xl",
  testId = "dialog",
  onClose,
  onBackdropClick,
  children,
}: Readonly<{
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
  panelClassName?: string;
  testId?: string;
  onClose: () => void;
  /** Optional (AP-038): called when the backdrop itself — not the panel — is clicked. Existing
   * dialogs omit it, so a stray click outside them still does nothing. */
  onBackdropClick?: () => void;
  children: ReactNode;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, onClose);

  // The backdrop scrolls, and the panel is centred with auto margins rather than `items-center`:
  // a dialog taller than the window (an environment with many values) then starts at the top and
  // scrolls, instead of being centred with its title and buttons pushed off screen.
  return (
    // The backdrop's click is a pointer convenience only (Escape is the keyboard equivalent), so
    // it carries no key handler of its own.
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-scrim/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onBackdropClick?.();
      }}
    >
      <div
        className="m-auto flex w-full justify-center"
        onClick={(event) => {
          if (event.target === event.currentTarget) onBackdropClick?.();
        }}
      >
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid={testId}
          className={panelClassName}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
