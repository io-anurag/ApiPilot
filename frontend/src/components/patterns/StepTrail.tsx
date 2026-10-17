import { useId, type ReactNode } from "react";

export interface StepTrailItem {
  readonly id: string;
  readonly label: string;
  /** Short text under the label; replaced by `lockReason` while the step is locked. */
  readonly hint: string;
  /** Why the step cannot be opened; undefined when it can. Locked steps are not activatable. */
  readonly lockReason?: string;
  readonly testId?: string;
  /** Shown in the disc instead of the step number (a view with an icon rather than a sequence). */
  readonly icon?: ReactNode;
  /** The step's work is complete. When omitted, any reachable step before the open one is done. */
  readonly done?: boolean;
}

const COLUMNS = {
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
} as const;

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3 w-3">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

/**
 * The stepper of the pattern set (AP-054 FR-014, FR-016), shared by Import & Run, Performance and
 * the script views of Run k6 Script. Each step is a button in an ordered list: the open one is
 * marked current (`aria-current`) on a pale-lime card with a lime disc and a deep-olive edge;
 * finished steps that can be reopened show a check on mint; locked steps are dashed,
 * `aria-disabled`, and say why in text. State is always a word or an icon (the hint or reason, the
 * check, "Done"), never colour alone.
 */
export function StepTrail({
  ariaLabel,
  testId,
  items,
  currentId,
  columns,
  onSelect,
  currentToken = "step",
  labelOnlyName = false,
}: Readonly<{
  ariaLabel: string;
  testId?: string;
  items: readonly StepTrailItem[];
  currentId: string;
  columns: 3 | 4 | 5;
  onSelect: (id: string) => void;
  /** The `aria-current` value of the open step: "step" for a sequence, "page" for views. */
  currentToken?: "step" | "page";
  /** Name each button by its label alone and describe it with the hint, as views have always been named. */
  labelOnlyName?: boolean;
}>) {
  const idPrefix = useId();
  const currentIndex = items.findIndex((item) => item.id === currentId);
  return (
    <nav aria-label={ariaLabel} data-testid={testId}>
      <ol className={`grid grid-cols-2 gap-2 ${COLUMNS[columns]}`}>
        {items.map((item, index) => {
          const locked = item.lockReason !== undefined;
          const current = item.id === currentId;
          const done = !current && !locked && (item.done ?? index < currentIndex);
          const hintId = `${idPrefix}-${item.id}-hint`;
          let card = "border-border bg-surface text-text-secondary hover:bg-surface-hover";
          let disc = "border border-border-strong bg-surface-subtle text-text-secondary";
          if (locked) {
            card = "border-dashed border-border-strong bg-transparent text-muted";
          } else if (current) {
            card = "border-brand-500 bg-lime-pale text-text-primary ring-1 ring-brand-500 forced-colors:outline forced-colors:outline-2";
            disc = "bg-accent text-on-accent ring-1 ring-brand-500";
          } else if (done) {
            card = "border-transparent bg-mint text-text-primary";
            disc = "bg-surface text-success-700 dark:text-success";
          }
          return (
            <li key={item.id} aria-current={current ? currentToken : undefined} className="min-w-0">
              <button
                type="button"
                data-testid={item.testId}
                aria-label={labelOnlyName ? item.label : undefined}
                aria-describedby={labelOnlyName ? hintId : undefined}
                aria-current={labelOnlyName && current ? currentToken : undefined}
                aria-disabled={locked ? "true" : undefined}
                onClick={() => {
                  if (!locked) onSelect(item.id);
                }}
                className={`flex h-full w-full min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs motion-safe:transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${card} ${locked ? "cursor-not-allowed" : ""}`}
              >
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${disc}`}>
                  {done ? <CheckIcon /> : (item.icon ?? index + 1)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{item.label}</span>
                  <span id={hintId} className="block text-muted">
                    {item.lockReason ?? item.hint}
                  </span>
                  {done && !labelOnlyName && <span className="sr-only">Done</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
