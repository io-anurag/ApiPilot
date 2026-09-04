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
  }

  const displayStageId = viewedStageId ?? workflow?.activeStageId ?? null;

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
            A workflow is already in progress. Starting a new one from &ldquo;{pendingFile.name}&rdquo;
            discards it. Continue?
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
      {!workflow && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Upload OpenAPI Specification</h2>
          <input
            type="file"
            accept=".yaml,.yml"
            aria-label="Upload OpenAPI specification"
            onChange={handleFileChange}
            disabled={uploading}
            className="block text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
          />
        </div>
      )}
      {workflow && (
        <div>
          <button
            type="button"
            aria-label="Start a new workflow from a different specification"
            onClick={() => document.getElementById("workflow-restart-input")?.click()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Start a new workflow
          </button>
          <input
            id="workflow-restart-input"
            type="file"
            accept=".yaml,.yml"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      )}
      {uploading && <p className="text-sm text-muted">Uploading…</p>}
      {uploadError && (
        <p role="alert" data-testid="upload-error" className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {uploadError}
        </p>
      )}
      {workflow && (
        <>
          <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <WorkflowStageTracker workflow={workflow} onViewStage={setViewedStageId} />
          </div>
          {displayStageId !== workflow.activeStageId && (
            <p role="status" data-testid="revisiting-notice" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
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
            <AiEnhancementStage skipped={false} onAdvanced={handleAdvanced} />
          )}
          {displayStageId === "scenarioReview" && workflow.reviewWorkspace && (
            <>
              {workflow.stages.aiEnhancement.status === "skipped" && (
                <AiEnhancementStage
                  skipped
                  aiErrorCategory={workflow.stages.aiEnhancement.aiErrorCategory}
                  aiErrorMessage={workflow.stages.aiEnhancement.aiErrorMessage}
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
            <PostmanGenerationStage postmanArtifact={workflow.postmanArtifact} onGenerated={handleAdvanced} />
          )}
        </>
      )}
    </section>
  );
}

function DeterministicGenerationTrigger({ onAdvanced }: { onAdvanced: (result: WorkflowResult) => void }) {
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
    <section data-testid="deterministic-generation-stage" className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Generate Deterministic Test Suite</h2>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? "Generating…" : "Generate Baseline Test Suite"}
      </button>
      {error && (
        <p role="alert" data-testid="deterministic-generation-error" className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
    </section>
  );
}
