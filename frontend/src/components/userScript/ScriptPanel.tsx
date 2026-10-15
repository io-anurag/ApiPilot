import type { ReactNode } from "react";

/**
 * The building blocks of the Run k6 Script page (specs/051-user-script-page-redesign FR-001): one card
 * anatomy for every group of content, the same as the Performance Source step's card (specs/050) and
 * the start screen's upload card, an accent bar, a header with a title, a meta line and a state, a body
 * and an optional footer bar. Presentation only.
 */

type Accent = "brand" | "success" | "warning" | "danger";

const ACCENT_BAR: Record<Accent, string> = {
  brand: "bg-brand-600 dark:bg-brand-500",
  success: "bg-success-600 dark:bg-success-500",
  warning: "bg-warning-600 dark:bg-warning-500",
  danger: "bg-danger-600 dark:bg-danger-500",
};

export type PanelStateTone = "pending" | "ready" | "attention" | "blocked";

const STATE_DOT: Record<PanelStateTone, string> = {
  pending: "bg-brand-500",
  ready: "bg-success",
  attention: "bg-warning",
  blocked: "bg-danger",
};

/** The state at the right of a card header: a dot and a word, so it never rests on colour alone. */
export function PanelState({ tone, label }: Readonly<{ tone: PanelStateTone; label: string }>) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATE_DOT[tone]}`} />
      {label}
    </span>
  );
}

export function ScriptPanel({
  title,
  titleId,
  meta,
  aside,
  accent = "brand",
  level = 3,
  testId,
  footer,
  flush = false,
  children,
}: Readonly<{
  title: string;
  titleId: string;
  meta?: ReactNode;
  /** The right of the header: a `PanelState`, a count or an action. */
  aside?: ReactNode;
  accent?: Accent;
  level?: 2 | 3;
  testId?: string;
  footer?: ReactNode;
  /** No body padding, for a table or a document that runs edge to edge. */
  flush?: boolean;
  children: ReactNode;
}>) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={titleId} data-testid={testId} className="relative min-w-0 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-sm">
      <div className={`h-1 ${ACCENT_BAR[accent]}`} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-surface-subtle px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <Heading id={titleId} className="text-left text-sm font-semibold text-text-primary">
            {title}
          </Heading>
          {meta && <div className="mt-0.5 text-left text-xs text-muted">{meta}</div>}
        </div>
        {aside}
      </div>
      <div className={flush ? "" : "space-y-4 p-4 sm:p-5"}>{children}</div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-chrome px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  );
}

/** One cell of a facts grid (the same cell as the collection and plan launch cards). */
export function ScriptFact({ label, children, className = "" }: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return (
    <div className={`min-w-0 bg-surface-subtle px-3 py-2 ${className}`}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** A grid of `ScriptFact`s, hairline-divided like the launch cards' facts. */
export function ScriptFacts({ children, className = "", testId }: Readonly<{ children: ReactNode; className?: string; testId?: string }>) {
  return (
    <dl data-testid={testId} className={`grid gap-px overflow-hidden rounded-md border border-border bg-border ${className}`}>
      {children}
    </dl>
  );
}

/** A single-line text field, as the other forms of the app style theirs. */
export const SCRIPT_INPUT =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

/** A button with a leading icon. The icon is decorative; the text is the accessible name. */
export const WITH_ICON = "inline-flex items-center gap-1.5";

export function UploadGlyph({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 14.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-4.5" />
    </svg>
  );
}

export function PlusGlyph({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function DocumentGlyph({ className = "h-4 w-4" }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M10 13l-2 2 2 2M14 13l2 2-2 2" />
    </svg>
  );
}
