import {
  IMPORT_RUN_STEP_HINTS,
  IMPORT_RUN_STEP_LABELS,
  IMPORT_RUN_STEP_ORDER,
  getStepLockReason,
  type ImportRunProgress,
  type ImportRunStepId,
} from "./importRunSteps";

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

/**
 * The clickable step indicator for Import & Run Collection. Colour classes resolve through
 * theme-aware tokens with no `dark:` overrides (the same rule as WorkflowStageTracker), so a step
 * keeps its hue in light and dark. State is always also text: the hint or the lock reason, plus
 * `aria-current` on the open step.
 */
export function ImportRunStepper({
  current,
  progress,
  onSelect,
}: Readonly<{
  current: ImportRunStepId;
  progress: ImportRunProgress;
  onSelect: (stepId: ImportRunStepId) => void;
}>) {
  const currentIndex = IMPORT_RUN_STEP_ORDER.indexOf(current);
  return (
    <nav aria-label="Import and run progress" data-testid="import-run-stepper">
      <ol className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {IMPORT_RUN_STEP_ORDER.map((stepId, index) => {
          const lockReason = getStepLockReason(stepId, progress);
          const isCurrent = stepId === current;
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
            <li key={stepId} aria-current={isCurrent ? "step" : undefined} className="min-w-0">
              <button
                type="button"
                data-testid={`import-run-step-${stepId}`}
                aria-disabled={lockReason ? "true" : undefined}
                onClick={() => {
                  if (!lockReason) onSelect(stepId);
                }}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone} ${lockReason ? "cursor-not-allowed" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${disc}`}
                >
                  {isDone ? <CheckIcon /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{IMPORT_RUN_STEP_LABELS[stepId]}</span>
                  <span className="block truncate text-muted">
                    {lockReason ?? IMPORT_RUN_STEP_HINTS[stepId]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
