import type { ReviewWorkspaceWire } from "../services/reviewsClient";

/** Shows aggregate review progress counts for the current workspace (US1, FR-003). */
export function TestScenarioReviewSummary({
  summary,
}: {
  summary: ReviewWorkspaceWire["summary"];
}) {
  return (
    <dl data-testid="review-summary">
      <dt>Total</dt>
      <dd data-testid="review-summary-total">{summary.total}</dd>
      <dt>Pending</dt>
      <dd data-testid="review-summary-pending">{summary.pending}</dd>
      <dt>Accepted</dt>
      <dd data-testid="review-summary-accepted">{summary.accepted}</dd>
      <dt>Rejected</dt>
      <dd data-testid="review-summary-rejected">{summary.rejected}</dd>
      <dt>Requires review</dt>
      <dd data-testid="review-summary-requires-review">{summary.requiresReview}</dd>
    </dl>
  );
}
