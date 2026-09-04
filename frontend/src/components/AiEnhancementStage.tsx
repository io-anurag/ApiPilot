import { useState } from "react";
import { runAiEnhancement, type WorkflowResult } from "../services/testGenerationWorkflowClient";
import type { AIErrorCategory } from "@apipilot/shared-domain";

/**
 * Triggers AI enhancement. A `skipped` outcome (FR-008) is shown as a banner with a retry action
 * (FR-008a) rather than as a failure — the workflow already advanced past this stage.
 */
export function AiEnhancementStage({
  skipped,
  aiErrorCategory,
  aiErrorMessage,
  onAdvanced,
}: {
  skipped: boolean;
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    const result = await runAiEnhancement();
    setRunning(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  if (skipped) {
    return (
      <section data-testid="ai-enhancement-skipped">
        <p role="status" data-testid="ai-enhancement-skip-banner">
          AI enhancement was skipped ({aiErrorCategory}): {aiErrorMessage}. You can continue with
          the deterministic scenarios below, or retry now.
        </p>
        <button type="button" onClick={handleRun} disabled={running}>
          {running ? "Retrying…" : "Retry AI enhancement"}
        </button>
        {error && (
          <p role="alert" data-testid="ai-enhancement-error">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-testid="ai-enhancement-stage">
      <h2>Enhance With Local AI</h2>
      <p>Enhance the deterministic baseline with semantic AI-generated scenarios.</p>
      <button type="button" onClick={handleRun} disabled={running}>
        {running ? "Enhancing…" : "Enhance with AI"}
      </button>
      {error && (
        <p role="alert" data-testid="ai-enhancement-error">
          {error}
        </p>
      )}
    </section>
  );
}
