import type { ReactNode } from "react";

/**
 * The framed panel of the entry screens (Upload, Import & Run Collection, Run k6 Script): a brand
 * bar, a tinted title band with the panel's heading and a status dot, and the body. The dot is
 * decorative, so the heading and sub-line carry all of the meaning.
 */
export function FramedPanel({
  title,
  subtitle,
  children,
}: Readonly<{ title: string; subtitle: string; children: ReactNode }>) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[6px_6px_0_0_var(--color-border)]">
      <div className="h-1 bg-brand-600" />
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
      </div>
      <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">{children}</div>
    </div>
  );
}
