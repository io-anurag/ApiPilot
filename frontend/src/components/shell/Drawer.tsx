import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

/** Tailwind's `lg` breakpoint. The layout itself switches in CSS; this is only used to close an
 * open drawer when the window is widened past it. No script reads `matchMedia` (jsdom has none). */
const WIDE_VIEWPORT_PX = 1024;

/**
 * The navigation container (AP-054 FR-022). At `lg` and above it is the sidebar column; below,
 * it is an off-screen panel that slides over a dimmed page when `open`. While open, focus is
 * trapped inside it, Escape or the dimmed layer closes it, and focus returns to the menu button
 * (`useFocusTrap`, shared with `Dialog`). The slide runs only under `motion-safe:`; with reduced
 * motion the panel appears without animation and nothing depends on it.
 */
export function Drawer({
  id,
  open,
  onClose,
  children,
}: Readonly<{ id: string; open: boolean; onClose: () => void; children: ReactNode }>) {
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, onClose, open);

  // Move focus into the panel when it opens (the trap only holds it there).
  useEffect(() => {
    if (!open) return;
    const target = panelRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])");
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth >= WIDE_VIEWPORT_PX) onClose();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          aria-hidden="true"
          data-testid="drawer-scrim"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-scrim/50 lg:hidden"
        />
      )}
      <aside
        id={id}
        ref={panelRef}
        data-testid="sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface motion-safe:transition-transform motion-safe:duration-200 lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:w-64 lg:shrink-0 lg:translate-x-0 lg:visible ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {children}
      </aside>
    </>
  );
}
