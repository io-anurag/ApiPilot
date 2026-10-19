import type { ReactNode } from "react";

/** A numbered step's heading (AP-059): the lime number, the title, one sentence, and optional actions at the end of the row. */
export function StepHeading({
  number,
  title,
  titleId,
  description,
  actions,
}: Readonly<{ number: number; title: string; titleId: string; description: string; actions?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent">
          {number}
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-bold leading-7 text-text-primary">
            {title}
          </h2>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">{actions}</div>}
    </div>
  );
}
