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
const PIPELINE_PREVIEW_STEPS = [
  "OpenAPI",
  "Analysis",
  "Test Design",
  "Generated Tests",
  "Results",
];

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.5V5m0 0L8 9m4-4l4 4" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"
      />
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
      <div
        data-testid="workflow-loading"
        className="flex min-h-64 items-center justify-center"
      >
        <p className="flex items-center gap-3 border border-border bg-surface px-4 py-3 text-sm text-muted shadow-sm">
          <span
            aria-hidden="true"
            className="h-2 w-2 animate-pulse rounded-full bg-brand-500"
          />
          <span>Restoring workflow…</span>
        </p>
      </div>
    );
  }

  return (
    <section data-testid="test-generation-workflow-page" className="space-y-5">
      {pendingFile && (
        <div
          role="alertdialog"
          data-testid="discard-existing-confirmation"
          className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm"
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
        <div className="grid min-h-[calc(100vh-9rem)] content-center items-center gap-8 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:gap-x-16">
          <div className="space-y-7">
            <div className="space-y-4">
              <p className="font-mono text-xs font-semibold uppercase text-brand-700">
                Specification to executable tests
              </p>
              <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
                Turn an OpenAPI specification into a test suite
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted">
                Analyze endpoints, generate deterministic scenarios, enhance selectively
                with local AI, and review every result with its provenance intact.
              </p>
            </div>
            <div className="grid max-w-2xl grid-cols-3 gap-px border border-border bg-border sm:grid-cols-5">
              <div className="bg-surface px-3 py-3">
                <p className="font-mono text-xs text-brand-700">LOCAL</p>
                <p className="mt-1 text-xs text-muted">Private by default</p>
              </div>
              <div className="bg-surface px-3 py-3">
                <p className="font-mono text-xs text-brand-700">REPEATABLE</p>
                <p className="mt-1 text-xs text-muted">Deterministic core</p>
              </div>
              <div className="bg-surface px-3 py-3">
                <p className="font-mono text-xs text-brand-700">TRACEABLE</p>
                <p className="mt-1 text-xs text-muted">Visible provenance</p>
              </div>
            </div>
          </div>
          <div className="border border-slate-300 bg-surface shadow-[8px_8px_0_0_#dce3e0]">
            <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  New test generation run
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  OpenAPI 3.x · YAML · up to 10 MB
                </p>
              </div>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex h-12 w-12 items-center justify-center border border-brand-200 bg-brand-50 text-brand-700">
                <UploadIcon className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-950">
                  Upload specification
                </h3>
                <p className="text-sm leading-6 text-muted">
                  The document stays in your local workflow and is never sent to a cloud
                  AI provider.
                </p>
              </div>
              <input
                type="file"
                accept=".yaml,.yml"
                aria-label="Upload OpenAPI specification"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-brand-400 hover:file:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {workflow && (
                <button
                  type="button"
                  onClick={() => setShowStartPage(false)}
                  className="text-sm font-medium text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:underline"
                >
                  Cancel — return to my in-progress workflow
                </button>
              )}
            </div>
          </div>
          <ol className="col-span-full grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-5">
            {PIPELINE_PREVIEW_STEPS.map((label, index) => (
              <li
                key={label}
                className="flex items-center gap-2 bg-surface px-3 py-2.5 text-xs font-medium text-slate-600"
              >
                <span className="font-mono text-brand-700">0{index + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {workflow && !showStartPage && (
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-brand-700">
              Active run
            </p>
            <p className="mt-1 text-sm text-muted">
              Review and advance the generated test workflow.
            </p>
          </div>
          <button
            type="button"
            aria-label="Start a new workflow from a different specification"
            onClick={() => setShowStartPage(true)}
            className="border border-border bg-surface px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
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
          <div className="border border-border bg-surface p-3 shadow-sm">
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
