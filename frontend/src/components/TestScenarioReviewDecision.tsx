import { useState } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";

/** Accept/reject controls with required rejection feedback and failure recovery (US2, FR-006-FR-010). */
export function TestScenarioReviewDecision({
  item,
  submitting,
  error,
  onAccept,
  onReject,
}: {
  item: ReviewScenarioWire;
  submitting: boolean;
  error?: string;
  onAccept: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isPending = item.state === "pending";

  function handleReject() {
    onReject(reason);
  }

  return (
    <div data-testid="review-scenario-decision" className="space-y-2 border-t border-border pt-4">
      {!isPending && (
        <p data-testid="review-decision-state" className="text-sm text-muted">
          This scenario is already {item.state}.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={submitting || !isPending}
          className="rounded-md bg-success-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-success-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Accept
        </button>
        <div className="flex flex-col gap-1">
          <label htmlFor="review-rejection-reason" className="text-xs font-medium text-muted">
            Rejection reason
          </label>
          <input
            id="review-rejection-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting || !isPending}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={handleReject}
          disabled={submitting || !isPending || reason.trim().length === 0}
          className="rounded-md bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" data-testid="review-decision-error" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
