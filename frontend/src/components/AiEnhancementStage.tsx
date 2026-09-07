import { useEffect, useRef, useState } from "react";
import {
  cancelAiEnhancement,
  fetchCurrentWorkflow,
  runAiEnhancement,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import type { AiEnhancementProgress, FailureExplanation } from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/** How often the frontend polls workflow status while a run is in progress (research.md Decision 6). */
const PROGRESS_POLL_INTERVAL_MS = 2000;

const BATCH_STATUS_LABEL: Record<AiEnhancementProgress["batches"][number]["status"], string> = {
  pending: "Pending",
  "in-progress": "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
  "not-attempted": "Not attempted",
};

const BATCH_STATUS_TONE: Record<AiEnhancementProgress["batches"][number]["status"], StatusTone> = {
  pending: "neutral",
  "in-progress": "info",
  succeeded: "success",
  failed: "danger",
  // Warning rather than danger: the run's time ceiling stopped these from being sent, so nothing
  // about them went wrong and presenting them as failures would overstate the outcome.
  "not-attempted": "warning",
};

/** Renders elapsed seconds/minutes the way a person reads a stopwatch. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Phase and elapsed time for any run in progress, single-batch included
 * (specs/013-ai-enhancement-viability FR-018, FR-019).
 *
 * This supersedes specs/012's FR-005, which hid progress entirely when `totalBatches <= 1`. That
 * rule assumed single-batch runs were the fast path that needed no feedback; in practice a
 * context-window defect made single-batch the *only* reachable case, so it suppressed progress
 * for every real run and produced the five-minute blank wait this feature exists to remove. The
 * per-batch *list* below is still withheld for a single batch — one item is not a list.
 *
 * Elapsed time is derived client-side from the server's timestamps rather than pushed, so poll
 * responses stay stable between real state changes.
 */
function RunProgress({ progress }: { progress: AiEnhancementProgress }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  const preparing = progress.phase === "preparing";
  const since = preparing ? progress.startedAt : progress.generatingSince ?? progress.startedAt;
  const elapsed = formatElapsed(now - new Date(since).getTime());

  return (
    <div data-testid="ai-enhancement-run-progress" className="space-y-2">
      <p role="status" aria-live="polite" className="text-sm text-slate-600">
        {preparing ? (
          <>
            <span data-testid="ai-enhancement-phase">Preparing the local model</span>
            {" — this can take a few minutes the first time, while the model downloads. "}
          </>
        ) : (
          <>
            <span data-testid="ai-enhancement-phase">Generating scenarios</span>{" "}
          </>
        )}
        <span data-testid="ai-enhancement-elapsed">{elapsed} elapsed</span>
        {progress.cancelRequested && " — finishing the current batch, then stopping."}
      </p>
      <BatchProgressList progress={progress} />
    </div>
  );
}

/**
 * Live batch-by-batch progress for a multi-batch run (specs/012-ai-enhancement-progress
 * FR-002/FR-003). Renders nothing for a single-batch run (`totalBatches <= 1`): one batch is not
 * a sequence, and showing "batch 1 of 1" would imply a multi-step process that does not exist.
 * Phase and elapsed time are shown for such runs by `RunProgress` above.
 */
function BatchProgressList({ progress }: { progress: AiEnhancementProgress }) {
  if (progress.totalBatches <= 1) return null;
  const currentIndex = progress.batches.findIndex((batch) => batch.status === "in-progress");
  const settledCount = progress.batches.filter(
    (batch) =>
      batch.status === "succeeded" ||
      batch.status === "failed" ||
      batch.status === "not-attempted",
  ).length;

  return (
    <div data-testid="ai-enhancement-progress" className="space-y-2">
      <p className="text-sm text-slate-600">
        {currentIndex >= 0
          ? `Processing batch ${currentIndex + 1} of ${progress.totalBatches}…`
          : `${settledCount} of ${progress.totalBatches} batches complete`}
        {/*
          The planned batch count on its own overstates what a run will do: a 39-batch plan under a
          five-minute ceiling completes roughly the first seven, and a denominator the run never
          intends to reach reads as a queue of failures waiting to happen
          (specs/014-ai-batching-policy FR-012).
        */}
        {progress.runBudgetRemainingMs !== undefined && (
          <>
            {" — "}
            <span data-testid="ai-enhancement-run-budget-remaining">
              {progress.runBudgetRemainingMs > 0
                ? `${formatElapsed(progress.runBudgetRemainingMs)} of run time left`
                : "run time limit reached; finishing the current batch"}
            </span>
          </>
        )}
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

/**
 * Lets the user abandon a run in progress (specs/013-ai-enhancement-viability FR-020). Stays
 * mounted but disabled once a cancellation is in flight, so the control does not disappear from
 * under the pointer while the request settles.
 */
function CancelButton({
  onCancel,
  cancelling,
}: {
  onCancel: () => void;
  cancelling: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={cancelling}
      data-testid="ai-enhancement-cancel"
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {cancelling ? "Stopping…" : "Cancel"}
    </button>
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
  failureExplanation,
  cancelled,
  onAdvanced,
}: {
  status?: "skipped" | "partial";
  /**
   * What the user is shown for a non-success outcome. Replaces the previous `aiErrorCategory` /
   * `aiErrorMessage` pair, which rendered an internal diagnostic string naming an implementation
   * constant (specs/013-ai-enhancement-viability FR-023, FR-024).
   */
  failureExplanation?: FailureExplanation;
  /** True when the outcome came from the user cancelling rather than a failure (FR-021). */
  cancelled?: boolean;
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
    setCancelling(false);
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
    setCancelling(false);
    setProgress(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  /**
   * Requests cancellation and returns immediately (FR-020). The server accepts the request and
   * settles the run at the next batch boundary, so `handleRun`'s still-pending promise resolves
   * shortly afterwards with the terminal outcome — we mark the intent here rather than tearing
   * down local state, so scenarios already generated are not visually discarded before the
   * server confirms they were kept.
   */
  async function handleCancel() {
    setCancelling(true);
    const result = await cancelAiEnhancement();
    if (!result.ok) {
      setCancelling(false);
      setError(result.message);
    }
  }

  if (status === "skipped" || status === "partial") {
    const isPartial = status === "partial";
    // A retry is offered only when it could plausibly change the outcome. Previously the same
    // retry control appeared for every failure kind, which after a timeout invited the user to
    // spend the entire budget again reaching the identical result (FR-025).
    const canRetry = failureExplanation?.retryable ?? true;
    return (
      <section
        data-testid={isPartial ? "ai-enhancement-partial" : "ai-enhancement-skipped"}
        className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-4"
      >
        <div
          role="status"
          data-testid="ai-enhancement-skip-banner"
          className="space-y-1 text-sm text-warning-700"
        >
          <p className="font-medium">
            {failureExplanation?.summary ??
              (isPartial
                ? "AI enhancement only partly completed."
                : "AI enhancement did not run.")}
          </p>
          <p data-testid="ai-enhancement-next-step">
            {failureExplanation?.nextStep ??
              "You can continue with the deterministic scenarios below."}
          </p>
          {isPartial && !cancelled && (
            <p>The scenarios that were generated successfully are included below.</p>
          )}
        </div>
        {canRetry && (
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-md bg-warning-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-warning-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RetryIcon className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Retrying…" : "Retry AI enhancement"}
          </button>
        )}
        {running && progress && <RunProgress progress={progress} />}
        {running && (
          <CancelButton onCancel={handleCancel} cancelling={cancelling || !!progress?.cancelRequested} />
        )}
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Enhancing…" : "Enhance with AI"}
        </button>
        {running && (
          <CancelButton onCancel={handleCancel} cancelling={cancelling || !!progress?.cancelRequested} />
        )}
      </div>
      {running && progress && <RunProgress progress={progress} />}
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
