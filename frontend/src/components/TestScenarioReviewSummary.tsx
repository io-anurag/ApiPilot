import type { ReviewWorkspaceWire } from "../services/reviewsClient";

/** Shows aggregate review progress counts for the current workspace (US1, FR-003). */
export function TestScenarioReviewSummary({
  summary,
}: {
  summary: ReviewWorkspaceWire["summary"];
}) {
  return (
    <dl data-testid="review-summary" className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border bg-slate-50 px-4 py-3 text-sm">
      <div className="flex items-baseline gap-1">
        <dt className="text-muted">Total</dt>
        <dd data-testid="review-summary-total" className="font-semibold text-slate-900">
          {summary.total}
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-muted">Pending</dt>
        <dd data-testid="review-summary-pending" className="font-semibold text-slate-900">
          {summary.pending}
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-muted">Accepted</dt>
        <dd data-testid="review-summary-accepted" className="font-semibold text-success-700">
          {summary.accepted}
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-muted">Rejected</dt>
        <dd data-testid="review-summary-rejected" className="font-semibold text-danger-700">
          {summary.rejected}
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="text-muted">Requires review</dt>
        <dd data-testid="review-summary-requires-review" className="font-semibold text-warning-700">
          {summary.requiresReview}
        </dd>
      </div>
    </dl>
  );
}
