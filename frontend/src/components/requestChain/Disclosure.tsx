import { useId, type ReactNode } from "react";

/**
 * A one-line summary that expands to the full panel beneath it. The caller owns the open state so a
 * panel can open itself when it holds something that needs attention (a plan's blockers) and still
 * be closed by the engineer.
 */
export function Disclosure({ title, summary, open, onToggle, children }: Readonly<{ title: string; summary: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }>) {
  const bodyId = useId();
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onClick={onToggle}
      >
        <span aria-hidden="true" className={`text-xs text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
          ▸
        </span>
        <span className="font-semibold">{title}</span>
        <span className="min-w-0 flex-1 text-muted">{summary}</span>
      </button>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
