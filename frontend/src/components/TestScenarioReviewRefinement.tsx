import { useState } from "react";
import type { ReviewEditContent } from "@apipilot/shared-domain";
import type { ReviewScenarioWire } from "../services/reviewsClient";

/** Edit and AI-regeneration controls for AI-derived and user-modified scenarios (US3, FR-011-FR-016). */
export function TestScenarioReviewRefinement({
  item,
  submitting,
  error,
  onEdit,
  onRegenerate,
}: {
  item: ReviewScenarioWire;
  submitting: boolean;
  error?: string;
  onEdit: (edit: ReviewEditContent) => void;
  onRegenerate: () => void;
}) {
  const [body, setBody] = useState(
    JSON.stringify(item.scenario.request.body ?? {}, null, 2),
  );
  const [bodyError, setBodyError] = useState<string | null>(null);
  const canRegenerate = item.scenario.provenance.source === "AI";

  function handleSubmitEdit() {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      setBodyError("Request body must be valid JSON.");
      return;
    }
    setBodyError(null);
    onEdit({
      request: { ...item.scenario.request, body: parsedBody },
      assertions: item.scenario.assertions,
      targetLocation: item.scenario.targetLocation,
      targetField: item.scenario.targetField,
    });
  }

  return (
    <div data-testid="review-scenario-refinement">
      <label htmlFor="review-edit-body">Request body</label>
      <textarea
        id="review-edit-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={submitting}
      />
      {bodyError && (
        <p role="alert" data-testid="review-edit-body-error">
          {bodyError}
        </p>
      )}
      <button type="button" onClick={handleSubmitEdit} disabled={submitting}>
        Save edit
      </button>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={submitting || !canRegenerate}
      >
        Regenerate with AI
      </button>
      {!canRegenerate && (
        <p data-testid="review-regenerate-unavailable">
          Only AI-suggested scenarios can be regenerated.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="review-refinement-error">
          {error}
        </p>
      )}
    </div>
  );
}
