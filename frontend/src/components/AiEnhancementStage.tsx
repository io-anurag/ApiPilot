import { useState } from "react";
import { runAiEnhancement, type WorkflowResult } from "../services/testGenerationWorkflowClient";
import type { AIErrorCategory } from "@apipilot/shared-domain";

function RetryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M15.312 5.312a5.5 5.5 0 00-9.201 2.466.75.75 0 01-1.453-.376A7 7 0 0116.5 4.312V2.75a.75.75 0 011.5 0v4a.75.75 0 01-.75.75h-4a.75.75 0 010-1.5h2.062zM4.688 14.688a5.5 5.5 0 009.201-2.466.75.75 0 011.453.376A7 7 0 013.5 15.688v1.562a.75.75 0 01-1.5 0v-4a.75.75 0 01.75-.75h4a.75.75 0 010 1.5H4.688z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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
      <section data-testid="ai-enhancement-skipped" className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-4">
        <p role="status" data-testid="ai-enhancement-skip-banner" className="text-sm text-warning-700">
          AI enhancement was skipped ({aiErrorCategory}): {aiErrorMessage}. You can continue with
          the deterministic scenarios below, or retry now.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-warning-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-warning-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RetryIcon className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Retrying…" : "Retry AI enhancement"}
        </button>
        {error && (
          <p role="alert" data-testid="ai-enhancement-error" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-testid="ai-enhancement-stage" className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Enhance With Local AI</h2>
      <p className="text-sm text-slate-600">Enhance the deterministic baseline with semantic AI-generated scenarios.</p>
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Enhancing…" : "Enhance with AI"}
      </button>
      {error && (
        <p role="alert" data-testid="ai-enhancement-error" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </section>
  );
}
