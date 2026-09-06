import { useEffect, useState, type ChangeEvent } from "react";
import type { TestGenerationWorkflow, WorkflowStageId } from "@apipilot/shared-domain";
import {
  fetchCurrentWorkflow,
  runDeterministicGeneration,
  startWorkflow,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { WorkflowStageTracker } from "../components/WorkflowStageTracker";
import { ApiReviewStage } from "../components/ApiReviewStage";
import { AiEnhancementStage } from "../components/AiEnhancementStage";
import { ScenarioReviewStage } from "../components/ScenarioReviewStage";
import { WorkflowReviewStage } from "../components/WorkflowReviewStage";
import { PostmanGenerationStage } from "../components/PostmanGenerationStage";

/** High-level pipeline shown before a workflow starts (CLAUDE.md §28's north-star diagram). The
 * in-progress, per-stage breakdown is WorkflowStageTracker's job once a workflow exists. */
const PIPELINE_PREVIEW_STEPS = ["OpenAPI", "Analysis", "Test Design", "Generated Tests", "Results"];

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.5V5m0 0L8 9m4-4l4 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
    </svg>
  );
}

/**
 * The guided workflow's sole composition root (research.md D8) — the exclusive way to reach any
 * stage screen (FR-017). Always resumes from server state on mount (FR-014, FR-018).
 */
export function TestGenerationWorkflowPage() {
  const [workflow, setWorkflow] = useState<TestGenerationWorkflow | null>(null);
  const [viewedStageId, setViewedStageId] = useState<WorkflowStageId | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Lets the user preview the starting page from anywhere in an in-progress workflow without
  // discarding it (FR-010 still gates the actual discard, via the pendingFile confirmation below,
  // once a replacement file is chosen).
  const [showStartPage, setShowStartPage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentWorkflow().then((result) => {
      if (cancelled) return;
      if (result.ok && result.workflow) {
        setWorkflow(result.workflow);
        setViewedStageId(result.workflow.activeStageId);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAdvanced(result: WorkflowResult) {
    if (!result.ok) return;
    setWorkflow(result.workflow);
    // Forward progress, or a revision snapping the workflow back to the stage being revised
    // (research.md D6/FR-006), always follows the workflow's own activeStageId.
    setViewedStageId(result.workflow.activeStageId);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    if (workflow) {
      setPendingFile(file);
      return;
    }
    await doUpload(file, false);
  }

  async function doUpload(file: File, discardExisting: boolean) {
    setUploading(true);
    setUploadError(null);
    const result = await startWorkflow(file, discardExisting);
    setUploading(false);
    setPendingFile(null);
    if (!result.ok) {
      setUploadError(result.message);
      return;
    }
    setWorkflow(result.workflow);
    setViewedStageId(result.workflow.activeStageId);
    setShowStartPage(false);
  }

  const displayStageId = viewedStageId ?? workflow?.activeStageId ?? null;
  const showHome = !workflow || showStartPage;

  if (loading) {
    return (
      <p data-testid="workflow-loading" className="text-sm text-muted">
        Loading…
      </p>
    );
  }

  return (
    <section data-testid="test-generation-workflow-page" className="space-y-4">
      {pendingFile && (
        <div
          role="alertdialog"
          data-testid="discard-existing-confirmation"
          className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-4"
        >
          <p className="text-sm text-warning-700">
            A workflow is already in progress. Starting a new one from &ldquo;
            {pendingFile.name}&rdquo; discards it. Continue?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => doUpload(pendingFile, true)}
              disabled={uploading}
              className="rounded-md bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard and start new
            </button>
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              disabled={uploading}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {showHome && (
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Turn an OpenAPI specification into a test suite
            </h2>
            <p className="mx-auto max-w-xl text-sm text-muted">
              Upload a spec to run it through deterministic scenario generation, optional AI
              enhancement, and guided review — every generated test stays traceable to its
              source.
            </p>
          </div>
          <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
            {PIPELINE_PREVIEW_STEPS.map((label, index) => (
              <li key={label} className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-slate-600">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                    {index + 1}
                  </span>
                  {label}
                </span>
                {index < PIPELINE_PREVIEW_STEPS.length - 1 && (
                  <span aria-hidden="true" className="text-border">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="mx-auto max-w-md space-y-4 rounded-lg border border-dashed border-border bg-surface p-8 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <UploadIcon className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-900">
                Upload OpenAPI Specification
              </h3>
              <p className="text-sm text-muted">YAML (.yaml, .yml), up to 10 MB</p>
            </div>
            <input
              type="file"
              accept=".yaml,.yml"
              aria-label="Upload OpenAPI specification"
              onChange={handleFileChange}
              disabled={uploading}
              className="mx-auto block text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {workflow && (
              <button
                type="button"
                onClick={() => setShowStartPage(false)}
                className="text-sm font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:underline"
              >
                Cancel — return to my in-progress workflow
              </button>
            )}
          </div>
        </div>
      )}
      {workflow && !showStartPage && (
        <div>
          <button
            type="button"
            aria-label="Start a new workflow from a different specification"
            onClick={() => setShowStartPage(true)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Start a new workflow
          </button>
        </div>
      )}
      {uploading && <p className="text-sm text-muted">Uploading…</p>}
      {uploadError && (
        <p
          role="alert"
          data-testid="upload-error"
          className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {uploadError}
        </p>
      )}
      {workflow && !showStartPage && (
        <>
          <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <WorkflowStageTracker workflow={workflow} onViewStage={setViewedStageId} />
          </div>
          {displayStageId !== workflow.activeStageId && (
            <p
              role="status"
              data-testid="revisiting-notice"
              className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700"
            >
              Revisiting a completed stage. Making a change here will mark later stages as
              needing to be redone.
            </p>
          )}
          {displayStageId === "apiReview" && workflow.apiModel && (
            <ApiReviewStage apiModel={workflow.apiModel} onAdvanced={handleAdvanced} />
          )}
          {displayStageId === "deterministicGeneration" && (
            <DeterministicGenerationTrigger onAdvanced={handleAdvanced} />
          )}
          {displayStageId === "aiEnhancement" && (
            <AiEnhancementStage onAdvanced={handleAdvanced} />
          )}
          {displayStageId === "scenarioReview" && workflow.reviewWorkspace && (
            <>
              {(workflow.stages.aiEnhancement.status === "skipped" ||
                workflow.stages.aiEnhancement.status === "partial") && (
                <AiEnhancementStage
                  status={workflow.stages.aiEnhancement.status}
                  failureExplanation={workflow.stages.aiEnhancement.failureExplanation}
                  cancelled={workflow.stages.aiEnhancement.cancelled}
                  onAdvanced={handleAdvanced}
                />
              )}
              <ScenarioReviewStage workflow={workflow} onAdvanced={handleAdvanced} />
            </>
          )}
          {displayStageId === "workflowReview" && workflow.dependencyAnalysis && (
            <WorkflowReviewStage
              dependencyAnalysis={workflow.dependencyAnalysis}
              decisions={workflow.workflowDecisions}
              onAdvanced={handleAdvanced}
            />
          )}
          {displayStageId === "postmanGeneration" && (
            <PostmanGenerationStage
              postmanArtifact={workflow.postmanArtifact}
              onGenerated={handleAdvanced}
            />
          )}
        </>
      )}
    </section>
  );
}

function DeterministicGenerationTrigger({
  onAdvanced,
}: {
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const result = await runDeterministicGeneration();
    setGenerating(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  return (
    <section
      data-testid="deterministic-generation-stage"
      className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Generate Deterministic Test Suite
      </h2>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? "Generating…" : "Generate Baseline Test Suite"}
      </button>
      {error && (
        <p
          role="alert"
          data-testid="deterministic-generation-error"
          className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}
