import type { ReactNode } from "react";
import { Card } from "../../patterns/Card";
import { Pill } from "../../patterns/Pill";

function StateIcon({ ready }: Readonly<{ ready: boolean }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3">
      {ready ? <path d="m5 12 5 5 9-10" /> : <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

/**
 * The card under the source choice (specs/050-performance-source-step-redesign FR-003), a flat card of
 * the pattern set nested in the step's card: a header with a title and a meta line, and a body. The
 * state at the right of the header is a pill with an icon and a word, so it never rests on colour alone.
 */
export function SourceDetailCard({
  title,
  meta,
  stateLabel,
  ready,
  testId,
  children,
}: Readonly<{ title: string; meta: string; stateLabel: string; ready: boolean; testId?: string; children: ReactNode }>) {
  return (
    <Card as="section" variant="flat" aria-label={title} data-testid={testId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-left text-sm font-semibold text-text-primary">{title}</p>
          <p className="mt-0.5 text-left text-xs text-muted">{meta}</p>
        </div>
        <Pill tone={ready ? "ok" : "warn"} icon={<StateIcon ready={ready} />}>
          {stateLabel}
        </Pill>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}
