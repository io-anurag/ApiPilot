import type { ReactNode } from "react";
import { FIELD_STYLES } from "../controlStyles";
import { Card } from "../patterns/Card";
import { Pill, type PillTone } from "../patterns/Pill";

/**
 * The building blocks of the Run k6 Script page, on the shared pattern set (AP-054 FR-013, FR-014): one
 * widget card for every group of content, with a heading, an optional sub-line, an aside and an optional
 * footer, and the key-value tile for a fact. Presentation only.
 */

export type PanelStateTone = "pending" | "ready" | "attention" | "blocked";

const STATE_TONE: Record<PanelStateTone, PillTone> = {
  pending: "mint",
  ready: "ok",
  attention: "warn",
  blocked: "bad",
};

const STATE_MARK: Record<PanelStateTone, string> = { pending: "", ready: "✓", attention: "!", blocked: "✕" };

/** The state at the right of a card header: a pill with a mark and a word, so it never rests on colour alone. */
export function PanelState({ tone, label }: Readonly<{ tone: PanelStateTone; label: string }>) {
  const mark = STATE_MARK[tone];
  return (
    <Pill tone={STATE_TONE[tone]} icon={mark ? <span aria-hidden="true">{mark}</span> : undefined}>
      {label}
    </Pill>
  );
}

export function ScriptPanel({
  title,
  titleId,
  meta,
  aside,
  level = 3,
  testId,
  footer,
  children,
}: Readonly<{
  title: string;
  titleId: string;
  meta?: ReactNode;
  /** The right of the header: a `PanelState`, a count or an action. */
  aside?: ReactNode;
  level?: 2 | 3;
  testId?: string;
  footer?: ReactNode;
  children: ReactNode;
}>) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Card as="section" aria-labelledby={titleId} data-testid={testId}>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <Heading id={titleId} className="text-left text-base font-semibold text-text-primary">
            {title}
          </Heading>
          {meta && <div className="mt-0.5 text-left text-xs text-muted">{meta}</div>}
        </div>
        {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
      </div>
      <div className="space-y-4">{children}</div>
      {footer && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">{footer}</div>}
    </Card>
  );
}

/** One tile of a facts grid: a small label over a value, as the pattern set's key-value block. */
export function ScriptFact({ label, children, className = "" }: Readonly<{ label: string; children: ReactNode; className?: string }>) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-subtle p-3 ${className}`}>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-text-primary">{children}</dd>
    </div>
  );
}

/** A grid of `ScriptFact`s; the caller sets the columns, which collapse on a narrow card. */
export function ScriptFacts({ children, className = "", testId }: Readonly<{ children: ReactNode; className?: string; testId?: string }>) {
  return (
    <dl data-testid={testId} className={`grid gap-3 ${className}`}>
      {children}
    </dl>
  );
}

/** A single-line text field, as the other forms of the app style theirs. */
export const SCRIPT_INPUT = FIELD_STYLES;

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
