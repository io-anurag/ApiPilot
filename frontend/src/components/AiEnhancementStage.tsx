import { useEffect, useRef, useState } from "react";
import {
  fetchCurrentWorkflow,
  runAiEnhancement,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import type { AIErrorCategory, AiEnhancementProgress } from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/** How often the frontend polls workflow status while a run is in progress (research.md Decision 6). */
const PROGRESS_POLL_INTERVAL_MS = 2000;

const BATCH_STATUS_LABEL: Record<AiEnhancementProgress["batches"][number]["status"], string> = {
  pending: "Pending",
  "in-progress": "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
};

const BATCH_STATUS_TONE: Record<AiEnhancementProgress["batches"][number]["status"], StatusTone> = {
  pending: "neutral",
  "in-progress": "info",
  succeeded: "success",
  failed: "danger",
};

/**
 * Live batch-by-batch progress for a multi-batch run (specs/012-ai-enhancement-progress
 * FR-002/FR-003). Renders nothing for a single-batch run (`totalBatches <= 1`) so the
 * already-fast single-batch experience is unchanged (FR-005) — the plain "Enhancing…" label
 * on the trigger button is the only signal shown in that case, exactly as before this feature.
 */
function BatchProgressList({ progress }: { progress: AiEnhancementProgress }) {
  if (progress.totalBatches <= 1) return null;
  const currentIndex = progress.batches.findIndex((batch) => batch.status === "in-progress");
  const settledCount = progress.batches.filter(
    (batch) => batch.status === "succeeded" || batch.status === "failed",
  ).length;

  return (
    <div data-testid="ai-enhancement-progress" className="space-y-2">
      <p className="text-sm text-slate-600">
        {currentIndex >= 0
          ? `Processing batch ${currentIndex + 1} of ${progress.totalBatches}…`
          : `${settledCount} of ${progress.totalBatches} batches complete`}
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Batch progress">
        {progress.batches.map((batch) => (
          <li key={batch.index}>
            <StatusBadge
              label={`Batch ${batch.index + 1}: ${BATCH_STATUS_LABEL[batch.status]}`}
              tone={BATCH_STATUS_TONE[batch.status]}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

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
 * Triggers AI enhancement. A `skipped` outcome (FR-008) or a `partial` outcome (some but not
 * all batches succeeded, FR-011) is shown as a banner with a retry action (FR-008a) rather than
 * as a failure — the workflow already advanced past this stage either way, and for `partial` the
 * scenarios that *did* succeed are already included below.
 */
export function AiEnhancementStage({
  status,
  aiErrorCategory,
  aiErrorMessage,
  onAdvanced,
}: {
  status?: "skipped" | "partial";
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AiEnhancementProgress | undefined>(undefined);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollHandleRef.current !== null) {
      clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }

  // Stop polling if the component unmounts mid-run (e.g. the user navigates away) — the run
  // itself keeps going server-side regardless (FR-007); this only stops this component's own
  // polling requests.
  useEffect(() => stopPolling, []);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setProgress(undefined);
    pollHandleRef.current = setInterval(() => {
      void fetchCurrentWorkflow().then((result) => {
        if (result.ok && result.workflow) {
          setProgress(result.workflow.stages.aiEnhancement.progress);
        }
      });
    }, PROGRESS_POLL_INTERVAL_MS);

    const result = await runAiEnhancement();
    stopPolling();
    setRunning(false);
    setProgress(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  if (status === "skipped" || status === "partial") {
    const isPartial = status === "partial";
    return (
      <section
        data-testid={isPartial ? "ai-enhancement-partial" : "ai-enhancement-skipped"}
        className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-4"
      >
        <p
          role="status"
          data-testid="ai-enhancement-skip-banner"
          className="text-sm text-warning-700"
        >
          {isPartial
            ? `AI enhancement partially completed (${aiErrorCategory}): ${aiErrorMessage}. The scenarios that were successfully generated are included below. You can continue, or retry now to attempt the rest.`
            : `AI enhancement was skipped (${aiErrorCategory}): ${aiErrorMessage}. You can continue with the deterministic scenarios below, or retry now.`}
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
        {running && progress && <BatchProgressList progress={progress} />}
        {error && (
          <p
            role="alert"
            data-testid="ai-enhancement-error"
            className="text-sm font-medium text-danger-700"
          >
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="ai-enhancement-stage"
      className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Enhance With Local AI</h2>
      <p className="text-sm text-slate-600">
        Enhance the deterministic baseline with semantic AI-generated scenarios.
      </p>
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? "Enhancing…" : "Enhance with AI"}
      </button>
      {running && progress && <BatchProgressList progress={progress} />}
      {error && (
        <p
          role="alert"
          data-testid="ai-enhancement-error"
          className="text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}
