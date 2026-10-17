import { BUTTON_STYLES } from "../../controlStyles";
import { Banner } from "../../patterns/Banner";
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
    <Banner tone="warning" role="status" testId="draft-banner" title="Draft in progress:">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-60">
          {" "}
          a test from {source}, at {stepLabel(draft.step, draft.source)} (step {step} of {PATH_STEPS.length}).
        </p>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON_STYLES.primary} onClick={onResume}>
            Resume
          </button>
          <button type="button" className={BUTTON_STYLES.secondary} onClick={onDiscard}>
            Discard
          </button>
        </span>
      </div>
    </Banner>
  );
}
