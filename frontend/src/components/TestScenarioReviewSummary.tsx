import type { ReviewWorkspaceWire } from "../services/reviewsClient";

const CHIP = "inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";
/** The same fills as `Pill` (patterns/Pill.tsx). A `<dt>`/`<dd>` pair cannot live inside `Pill`'s
 * `<span>`, so the chip classes are repeated here to keep the counts a semantic description list. */
const CHIP_LINE = `${CHIP} border border-border-strong bg-surface-subtle text-text-secondary`;
const CHIP_ACCENT = `${CHIP} bg-accent text-on-accent`;
const CHIP_WARN = `${CHIP} bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100`;

/** Shows aggregate review progress counts for the current workspace (US1, FR-003). */
export function TestScenarioReviewSummary({
  summary,
}: {
  summary: ReviewWorkspaceWire["summary"];
}) {
  return (
    <dl data-testid="review-summary" className="flex flex-wrap gap-2">
      <div className={CHIP_LINE}>
        <dt>Total</dt>
        <dd data-testid="review-summary-total" className="font-mono">
          {summary.total}
        </dd>
      </div>
      <div className={summary.pending > 0 ? CHIP_ACCENT : CHIP_LINE}>
        <dt>Pending</dt>
        <dd data-testid="review-summary-pending" className="font-mono">
          {summary.pending}
        </dd>
      </div>
      <div className={CHIP_LINE}>
        <dt>Accepted</dt>
        <dd data-testid="review-summary-accepted" className="font-mono">
          {summary.accepted}
        </dd>
      </div>
      <div className={CHIP_LINE}>
        <dt>Rejected</dt>
        <dd data-testid="review-summary-rejected" className="font-mono">
          {summary.rejected}
        </dd>
      </div>
      <div className={summary.requiresReview > 0 ? CHIP_WARN : CHIP_LINE}>
        <dt>Requires review</dt>
        <dd data-testid="review-summary-requires-review" className="font-mono">
          {summary.requiresReview}
        </dd>
      </div>
    </dl>
  );
}
