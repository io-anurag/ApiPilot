import { useEffect, useRef, type ReactNode } from "react";

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
  panelClassName = "w-full max-w-md space-y-3 rounded-lg border border-brand-300 bg-surface p-4 shadow-xl dark:border-brand-500",
  testId = "dialog",
  onClose,
  children,
}: Readonly<{
  role?: "dialog" | "alertdialog";
  labelledBy?: string;
  panelClassName?: string;
  testId?: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
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
  );
}
