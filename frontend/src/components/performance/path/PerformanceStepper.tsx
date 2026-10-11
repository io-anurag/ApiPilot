import { PATH_STEPS, STEP_HINTS, isStepSelectable, isStepSkipped, stepLabel, type PathStep, type SourceKind } from "./pathState";

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3 w-3">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.79a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Why a step cannot be opened; `undefined` when it can. State is always text, never colour alone. */
export function stepLockReason(step: PathStep, reached: number, source: SourceKind | null): string | undefined {
  if (isStepSkipped(step, source)) return "Skipped for an empty plan";
  if (!isStepSelectable(step, reached, source)) return "Finish the earlier steps first";
  return undefined;
}

/**
 * The Performance path's clickable step indicator (specs/047-unified-performance-tab FR-006), laid out
 * like `ImportRunStepper` (AP-042): theme-aware tokens with no `dark:` overrides, a hint or the lock
 * reason under each label, and `aria-current="step"` on the open step. Reached steps can be selected,
 * so the engineer can jump back, or straight to Load or Run on an opened plan.
 */
export function PerformanceStepper({
  current,
  reached,
  source,
  onSelect,
}: Readonly<{ current: PathStep; reached: number; source: SourceKind | null; onSelect: (step: PathStep) => void }>) {
  const currentIndex = PATH_STEPS.indexOf(current);
  return (
    <nav aria-label="Performance test progress" data-testid="performance-stepper">
      <ol className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
        {PATH_STEPS.map((step, index) => {
          const lockReason = stepLockReason(step, reached, source);
          const isCurrent = step === current;
          const isDone = !isCurrent && !lockReason && index < currentIndex;
          let tone = "border-border bg-surface text-text-secondary";
          let disc = "bg-surface-strong text-text-secondary";
          if (lockReason) {
            tone = "border-dashed border-border-strong bg-surface-subtle text-muted";
          } else if (isCurrent) {
            tone = "border-brand-600/30 bg-brand-600/10 ring-2 ring-inset ring-brand-500 text-text-primary";
            disc = "bg-brand-600 text-white";
          } else if (isDone) {
            tone = "border-success-600/30 bg-success-600/10";
            disc = "bg-success-600 text-white";
          }
          return (
            <li key={step} aria-current={isCurrent ? "step" : undefined} className="min-w-0">
              <button
                type="button"
                data-testid={`performance-step-${step}`}
                aria-disabled={lockReason ? "true" : undefined}
                onClick={() => {
                  if (!lockReason) onSelect(step);
                }}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone} ${lockReason ? "cursor-not-allowed" : ""}`}
              >
                <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${disc}`}>
                  {isDone ? <CheckIcon /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{stepLabel(step, source)}</span>
                  <span className="block truncate text-muted">{lockReason ?? STEP_HINTS[step]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
