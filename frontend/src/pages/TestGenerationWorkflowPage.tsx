import { useEffect, useState, type ChangeEvent } from "react";
import type {
  DependencyAnalysisResult,
  TestGenerationWorkflow,
  TestModel,
  WorkflowStageId,
} from "@apipilot/shared-domain";
import {
  fetchCurrentWorkflow,
  runDeterministicGeneration,
  startWorkflow,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import {
  WorkflowStageTracker,
  REVISABLE_STAGES,
} from "../components/WorkflowStageTracker";
import { ApiReviewStage } from "../components/ApiReviewStage";
import { AiEnhancementStage } from "../components/AiEnhancementStage";
import { AiEnhancementOutcomeSummary } from "../components/AiEnhancementOutcomeSummary";
import { ScenarioReviewStage } from "../components/ScenarioReviewStage";
import { WorkflowReviewStage } from "../components/WorkflowReviewStage";
import { PostmanGenerationStage } from "../components/PostmanGenerationStage";
import { ExecutionResultsPanel } from "../components/ExecutionResultsPanel";
import { AnalysisSummary } from "../components/AnalysisSummary";
import { PostmanExportLimitations } from "../components/PostmanExportLimitations";
import { BUTTON_STYLES } from "../components/controlStyles";

/** High-level pipeline shown before a workflow starts (CLAUDE.md §28's north-star diagram). The
 * in-progress, per-stage breakdown is WorkflowStageTracker's job once a workflow exists. */
const PIPELINE_PREVIEW_STEPS = [
  "OpenAPI",
  "Analysis",
  "Test Design",
  "Generated Tests",
  "Results",
];

function UploadIcon({ className }: Readonly<{ className?: string }>) {
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
  // Gates opening the starting page at all: clicking "Start a new workflow" while one is running
  // must confirm the discard up front (FR-010), rather than only warning once a replacement file
  // is chosen. Confirming sets showStartPage; the page is only reachable via that confirmation
  // (or directly, when there is no workflow to discard), so any file chosen there is uploaded with
  // discardExisting already implied.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showStartPage, setShowStartPage] = useState(false);
  // Set only when this session's own prior workflow was discarded for inactivity
  // (specs/017-session-workflow-isolation FR-007a) — distinct from a session that never
  // started one, which never sets this.
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentWorkflow().then((result) => {
      if (cancelled) return;
      if (result.ok && result.workflow) {
        setWorkflow(result.workflow);
        setViewedStageId(result.workflow.activeStageId);
      } else if (result.ok && result.sessionExpired) {
        setSessionExpired(true);
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
    // The native file picker's "All Files" filter lets users select any file regardless of the
    // input's `accept` attribute, so the extension must also be checked here before upload.
    if (!/\.ya?ml$/i.test(file.name)) {
      setUploadError("Only .yaml or .yml OpenAPI specification files are supported.");
      return;
    }
    // Reaching the starting page while a workflow exists only happens after the user already
    // confirmed the discard (see confirmDiscard below), so no second confirmation is needed here.
    await doUpload(file, workflow !== null);
  }

  async function doUpload(file: File, discardExisting: boolean) {
    setUploading(true);
    setUploadError(null);
    const result = await startWorkflow(file, discardExisting);
    setUploading(false);
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
  // The AI Enhancement stage's own view carries an actual retry action once skipped/partial
  // (rendered below), so the generic "nothing here can be changed" read-only notice would
  // directly contradict it — suppressed only for that specific case.
  const aiEnhancementHasRetryableOutcome =
    displayStageId === "aiEnhancement" &&
    (workflow?.stages.aiEnhancement.status === "skipped" ||
      workflow?.stages.aiEnhancement.status === "partial");

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
      {confirmDiscard && (
        <div
          role="alertdialog"
          data-testid="discard-existing-confirmation"
          className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm"
        >
          <p className="text-sm text-warning-700">
            A workflow is already in progress. Starting a new one discards it. Continue?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmDiscard(false);
                setShowStartPage(true);
              }}
              className={BUTTON_STYLES.danger}
            >
              Discard and start new
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className={BUTTON_STYLES.secondary}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {sessionExpired && !workflow && (
        <output
          data-testid="session-expired-notice"
          className="block border-l-4 border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700"
        >
          Your previous session expired due to inactivity. Start a new run below.
        </output>
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
                Analyze endpoints, generate deterministic scenarios, and enhance selectively
                with local AI. Review every result with its provenance intact, then run the
                approved suite against your own environment to see real pass/fail results.
              </p>
            </div>
            <div className="grid max-w-2xl grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
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
              <div className="bg-surface px-3 py-3">
                <p className="font-mono text-xs text-brand-700">VERIFIABLE</p>
                <p className="mt-1 text-xs text-muted">Runs against your API</p>
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
            onClick={() => setConfirmDiscard(true)}
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
            <WorkflowStageTracker
              workflow={workflow}
              onViewStage={setViewedStageId}
              viewedStageId={displayStageId}
            />
          </div>
          {displayStageId !== workflow.activeStageId &&
            !aiEnhancementHasRetryableOutcome &&
            (displayStageId !== null && REVISABLE_STAGES.has(displayStageId) ? (
              <output
                data-testid="revisiting-notice"
                className="block rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700"
              >
                Revisiting a completed stage. Making a change here will mark later stages
                as needing to be redone.
              </output>
            ) : (
              <output
                data-testid="read-only-stage-notice"
                className="block rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-muted"
              >
                Read-only view of a completed stage — nothing here can be changed.
              </output>
            ))}
          {displayStageId === "apiReview" && workflow.apiModel && (
            <ApiReviewStage
              apiModel={workflow.apiModel}
              onAdvanced={handleAdvanced}
              readOnly={workflow.activeStageId !== "apiReview"}
            />
          )}
          {(displayStageId === "upload" || displayStageId === "analysis") &&
            workflow.apiModel && (
              <UploadAnalysisSummary
                stageId={displayStageId}
                specificationFilename={workflow.specificationFilename}
                apiModel={workflow.apiModel}
              />
            )}
          {displayStageId === "deterministicGeneration" &&
            (workflow.activeStageId === "deterministicGeneration" ? (
              <DeterministicGenerationTrigger onAdvanced={handleAdvanced} />
            ) : (
              <DeterministicGenerationSummary
                testModel={workflow.deterministicTestModel}
              />
            ))}
          {displayStageId === "aiEnhancement" &&
            (workflow.activeStageId === "aiEnhancement" ? (
              <AiEnhancementStage
                activeProgress={workflow.stages.aiEnhancement.progress}
                onAdvanced={handleAdvanced}
              />
            ) : workflow.stages.aiEnhancement.status === "skipped" ||
              workflow.stages.aiEnhancement.status === "partial" ? (
              // The workflow always advances past aiEnhancement immediately once it settles
              // (aiEnhancementStage.ts), even for a skipped/partial outcome — so this is the only
              // "AI Enhancement" screen a retry action can live on; it is never the active stage
              // again once retryable. Rendering it here, rather than on scenarioReview, keeps the
              // retry action where the process actually ran (matches AiEnhancementOutcomeSummary's
              // scenarioReview counterpart, which stays purely informational).
              <AiEnhancementStage
                status={workflow.stages.aiEnhancement.status}
                failureExplanation={workflow.stages.aiEnhancement.failureExplanation}
                cancelled={workflow.stages.aiEnhancement.cancelled}
                batchOutcomes={workflow.stages.aiEnhancement.batchOutcomes}
                onAdvanced={handleAdvanced}
              />
            ) : (
              <AiEnhancementOutcomeSummary workflow={workflow} />
            ))}
          {displayStageId === "dependencyAnalysis" && workflow.dependencyAnalysis && (
            <DependencyAnalysisSummary dependencyAnalysis={workflow.dependencyAnalysis} />
          )}
          {displayStageId === "scenarioReview" && workflow.reviewWorkspace && (
            <ScenarioReviewStage workflow={workflow} onAdvanced={handleAdvanced} />
          )}
          {displayStageId === "workflowReview" && workflow.dependencyAnalysis && (
            <WorkflowReviewStage
              dependencyAnalysis={workflow.dependencyAnalysis}
              decisions={workflow.workflowDecisions}
              onAdvanced={handleAdvanced}
              isActiveStage={workflow.activeStageId === "workflowReview"}
            />
          )}
          {displayStageId === "postmanGeneration" &&
            (workflow.activeStageId === "postmanGeneration" ? (
              <PostmanGenerationStage
                postmanArtifact={workflow.postmanArtifact}
                onGenerated={handleAdvanced}
              />
            ) : (
              <PostmanGenerationSummary postmanArtifact={workflow.postmanArtifact} />
            ))}
          {workflow.stages.postmanGeneration.status === "complete" && <ExecutionResultsPanel />}
        </>
      )}
    </section>
  );
}

function UploadAnalysisSummary({
  stageId,
  specificationFilename,
  apiModel,
}: Readonly<{
  stageId: "upload" | "analysis";
  specificationFilename: string;
  apiModel: NonNullable<TestGenerationWorkflow["apiModel"]>;
}>) {
  const isUpload = stageId === "upload";
  return (
    <section
      data-testid={`${stageId}-stage-summary`}
      className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        {isUpload ? "Specification Uploaded" : "Specification Analysis"}
      </h2>
      {isUpload && <p className="text-sm text-slate-600">{specificationFilename}</p>}
      <AnalysisSummary summary={apiModel.summary} />
    </section>
  );
}

/** Read-only view of an already-completed deterministicGeneration stage. */
function DeterministicGenerationSummary({
  testModel,
}: Readonly<{ testModel?: TestModel }>) {
  const scenarioCount = testModel?.scenarios.length ?? 0;
  return (
    <section
      data-testid="deterministic-generation-summary"
      className="space-y-2 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Deterministic Test Suite Generated
      </h2>
      <p className="text-sm text-slate-600">
        {scenarioCount} baseline scenario{scenarioCount === 1 ? "" : "s"} generated from
        the reviewed specification.
      </p>
    </section>
  );
}

/** Read-only view of an already-completed dependencyAnalysis stage — this stage has no screen
 * of its own while active (it runs automatically as part of finalizing scenario review), so
 * this is the only place its relationship/workflow counts are shown outside workflowReview. */
function DependencyAnalysisSummary({
  dependencyAnalysis,
}: Readonly<{ dependencyAnalysis: DependencyAnalysisResult }>) {
  const { graph, workflows, cycles, aiBatchingLimitation, aiErrorMessage, aiOutcome } =
    dependencyAnalysis;
  // "skipped"/"success" need no explanation — nothing degraded. Every other outcome (including
  // the pre-flight "not viable" refusal) has a plain-language reason in `aiErrorMessage`, which
  // must reach the user rather than stay a log-only detail (Explicit Failure, constitution VIII.4).
  const showAiErrorMessage =
    aiErrorMessage && aiOutcome !== "skipped" && aiOutcome !== "success";
  return (
    <section
      data-testid="dependency-analysis-summary"
      className="space-y-2 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Dependency Analysis</h2>
      <p className="text-sm text-slate-600">
        {graph.relationships.length} relationship
        {graph.relationships.length === 1 ? "" : "s"} found; {workflows.length}{" "}
        integration workflow{workflows.length === 1 ? "" : "s"} assembled.
        {cycles.length > 0 &&
          ` ${cycles.length} dependency cycle${cycles.length === 1 ? "" : "s"} detected.`}
      </p>
      {showAiErrorMessage && (
        <p data-testid="dependency-analysis-ai-error" className="text-sm text-muted">
          {aiErrorMessage}
        </p>
      )}
      {/* FR-034: a relationship spanning a batch boundary is unchecked, not confirmed absent —
          that distinction must reach the user, not stay a backend-only detail. */}
      {aiBatchingLimitation && (
        <p data-testid="dependency-analysis-batching-limitation" className="text-sm text-muted">
          {aiBatchingLimitation}
        </p>
      )}
    </section>
  );
}

function PostmanGenerationSummary({
  postmanArtifact,
}: Readonly<{ postmanArtifact?: TestGenerationWorkflow["postmanArtifact"] }>) {
  if (!postmanArtifact) {
    return (
      <section
        data-testid="postman-generation-summary"
        className="space-y-2 rounded-lg border border-border bg-surface p-5 shadow-sm"
      >
        <h2 className="text-base font-semibold text-slate-900">Postman Generation</h2>
        <p className="text-sm text-slate-600">
          No Postman artifact was generated for this stage.
        </p>
      </section>
    );
  }

  const { summary, limitations } = postmanArtifact;
  return (
    <section
      data-testid="postman-generation-summary"
      className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Postman Collection Generated
      </h2>
      <p className="text-sm text-slate-600">
        {summary.requestCount} request{summary.requestCount === 1 ? "" : "s"} in{" "}
        {summary.folderCount} folder{summary.folderCount === 1 ? "" : "s"}.
      </p>
      <PostmanExportLimitations limitations={limitations} />
    </section>
  );
}

function DeterministicGenerationTrigger({
  onAdvanced,
}: Readonly<{
  onAdvanced: (result: WorkflowResult) => void;
}>) {
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
        className={BUTTON_STYLES.primary}
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
