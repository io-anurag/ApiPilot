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
    <div data-testid="review-scenario-decision">
      {!isPending && (
        <p data-testid="review-decision-state">This scenario is already {item.state}.</p>
      )}
      <button type="button" onClick={onAccept} disabled={submitting || !isPending}>
        Accept
      </button>
      <label htmlFor="review-rejection-reason">Rejection reason</label>
      <input
        id="review-rejection-reason"
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={submitting || !isPending}
      />
      <button
        type="button"
        onClick={handleReject}
        disabled={submitting || !isPending || reason.trim().length === 0}
      >
        Reject
      </button>
      {error && (
        <p role="alert" data-testid="review-decision-error">
          {error}
        </p>
      )}
    </div>
  );
}
