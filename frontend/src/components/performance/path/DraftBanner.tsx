import { BUTTON_STYLES } from "../../controlStyles";
import { SOURCE_LABELS, PATH_STEPS, stepLabel, type PathState } from "./pathState";

/**
 * The entry screen's note that an unfinished test was kept (specs/047-unified-performance-tab FR-019): which
 * source and step it was on, with Resume and Discard. Discard asks nothing because a draft holds no plan:
 * only a source choice and a selection, never anything sent or saved.
 */
export function DraftBanner({ draft, onResume, onDiscard }: Readonly<{ draft: PathState; onResume: () => void; onDiscard: () => void }>) {
  const source = draft.source ? SOURCE_LABELS[draft.source].toLowerCase() : "a performance test";
  const step = PATH_STEPS.indexOf(draft.step) + 1;
  return (
    <div role="status" data-testid="draft-banner" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-500 bg-warning-100 px-4 py-2.5 text-sm text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
      <span>
        <span className="font-semibold">Draft in progress:</span> a test from {source}, at {stepLabel(draft.step, draft.source)} (step {step} of {PATH_STEPS.length}).
      </span>
      <span className="ml-auto flex gap-2">
        <button type="button" className={BUTTON_STYLES.secondary} onClick={onResume}>
          Resume
        </button>
        <button type="button" className={BUTTON_STYLES.secondary} onClick={onDiscard}>
          Discard
        </button>
      </span>
    </div>
  );
}
