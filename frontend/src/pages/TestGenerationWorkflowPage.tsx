import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import type {
  DependencyAnalysisResult,
  ExportResult,
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
import { AnalysisSummary } from "../components/AnalysisSummary";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
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

/** Small feature-strip icons (CLAUDE.md §28: consistent, minimal stroke iconography). */
function LockIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
    >
      <rect x="5" y="11" width="14" height="9" rx="1.5" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V8a4 4 0 118 0v3" />
    </svg>
  );
}

function RepeatIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 12a8 8 0 0113.66-5.66M20 12a8 8 0 01-13.66 5.66"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.5 6.34V4m0 2.34h2.34M6.5 17.66V20m0-2.34H4.16"
      />
    </svg>
  );
}

function TrailIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path strokeLinecap="round" strokeDasharray="2 2.5" d="M8 7l8 10" />
    </svg>
  );
}

function CheckShieldIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={className}
    >
      <path
        strokeLinejoin="round"
        d="M12 4l7 3v5c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V7l7-3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
}

/** Feature-strip content: label, one-line description, and the icon that represents it. */
const HOME_FEATURES: {
  label: string;
  description: string;
  Icon: (props: Readonly<{ className?: string }>) => ReactNode;
}[] = [
  { label: "LOCAL", description: "Private by default", Icon: LockIcon },
  { label: "REPEATABLE", description: "Deterministic core", Icon: RepeatIcon },
  { label: "TRACEABLE", description: "Visible provenance", Icon: TrailIcon },
  { label: "VERIFIABLE", description: "Runs against your API", Icon: CheckShieldIcon },
];

/**
 * The guided workflow's sole composition root (research.md D8) — the exclusive way to reach any
 * stage screen (FR-017). Always resumes from server state on mount (FR-014, FR-018).
 */
export function TestGenerationWorkflowPage({
  onExit,
  onHandoffToExecution,
}: Readonly<{
  /** Returns to the top-level entry chooser without discarding the in-progress workflow. */
  onExit?: () => void;
  /** Fired the moment the workflow reaches the `execution` stage with a generated Postman
   * artifact — the guided workflow no longer runs collections itself (requirement 4); it hands
   * off to "Import & Run Collection" instead. */
  onHandoffToExecution?: (
    postmanArtifact: ExportResult,
    specTitle: string | undefined,
  ) => void;
}>) {
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
  // Purely presentational: highlights the upload dropzone while a file is dragged over it.
  const [dragActive, setDragActive] = useState(false);
  // Guards against handing off more than once for the same generated artifact (StrictMode's
  // double-invoke, or simply re-rendering) — keyed on the workflow id + updatedAt pair, which
  // changes exactly when a fresh Postman artifact was produced.
  const lastHandoffKey = useRef<string | null>(null);

  function maybeHandoff(wf: TestGenerationWorkflow) {
    if (wf.activeStageId !== "execution" || !wf.postmanArtifact || !onHandoffToExecution)
      return;
    const key = `${wf.id}:${wf.updatedAt}`;
    if (lastHandoffKey.current === key) return;
    lastHandoffKey.current = key;
    onHandoffToExecution(wf.postmanArtifact, wf.apiModel?.info?.title);
  }

  useEffect(() => {
    let cancelled = false;
    fetchCurrentWorkflow().then((result) => {
      if (cancelled) return;
      if (result.ok && result.workflow) {
        setWorkflow(result.workflow);
        setViewedStageId(result.workflow.activeStageId);
        maybeHandoff(result.workflow);
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

  // Postman generation's own onGenerated: deliberately does NOT follow activeStageId to
  // "execution" — the success screen (with its downloads) must stay visible until the user
  // explicitly continues, rather than the workflow jumping away from it the instant generation
  // finishes.
  function handlePostmanGenerated(result: WorkflowResult) {
    if (!result.ok) return;
    setWorkflow(result.workflow);
  }

  /** The Postman Generation success screen's own "Continue" action — the explicit moment the
   * user hands off to "Import & Run Collection" (requirements 3 & 4), rather than that happening
   * automatically the instant the artifact is generated. */
  function handleContinueToExecution() {
    if (!workflow) return;
    setViewedStageId(workflow.activeStageId);
    maybeHandoff(workflow);
  }

  // Shared by both the native file picker and the dropzone's onDrop — the extension check must
  // run for a dropped file too, since a drop, like the picker's "All Files" filter, bypasses the
  // input's `accept` attribute entirely.
  async function processFile(file: File) {
    setUploadError(null);
    if (!/\.ya?ml$/i.test(file.name)) {
      setUploadError("Only .yaml or .yml OpenAPI specification files are supported.");
      return;
    }
    // Reaching the starting page while a workflow exists only happens after the user already
    // confirmed the discard (see confirmDiscard below), so no second confirmation is needed here.
    await doUpload(file, workflow !== null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await processFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!uploading) setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
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
  // PostmanGenerationStage stays interactive (regenerable) even once `activeStageId` has moved on
  // to `execution` — it was never gated on being the active stage to begin with (see its own
  // render call below) — so the same read-only notice would misreport it too.
  const postmanGenerationAlwaysActionable = displayStageId === "postmanGeneration";

  if (loading) {
    return (
      <div
        data-testid="workflow-loading"
        className="flex min-h-64 items-center justify-center"
      >
        <p className="flex items-center gap-3 border border-border bg-surface px-4 py-3 text-sm text-muted shadow-sm">
          <Skeleton className="h-2 w-2 rounded-full bg-brand-500" />
          <span>Restoring workflow…</span>
        </p>
      </div>
    );
  }

  return (
    <section data-testid="test-generation-workflow-page" className="space-y-5">
      {onExit && (
        <div className="flex justify-start">
          <button
            type="button"
            aria-label="Exit the guided workflow and return to the start screen"
            onClick={onExit}
            className={BUTTON_STYLES.ghost}
          >
            ← Back to start
          </button>
        </div>
      )}
      {confirmDiscard && (
        <div
          role="alertdialog"
          data-testid="discard-existing-confirmation"
          className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm dark:bg-warning-500/10"
        >
          <p className="text-sm text-warning-700 dark:text-warning-100">
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
          className="block border-l-4 border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-100"
        >
          Your previous session expired due to inactivity. Start a new run below.
        </output>
      )}
      {showHome && (
        <div className="relative isolate overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[32rem] w-[32rem] -translate-x-1/3 -translate-y-1/4 rounded-full bg-brand-100/70 blur-3xl dark:bg-brand-500/10"
          />
          <div className="grid grid-cols-1 min-h-[calc(100vh-9rem)] content-center items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-x-16">
            <div className="space-y-8">
              <div className="space-y-4">
                <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
                  <span
                    aria-hidden="true"
                    className="h-3 w-1 rounded-full bg-brand-500"
                  />
                  <span>Specification to executable tests</span>
                </p>
                <h2 className="max-w-3xl font-display text-4xl font-semibold tracking-tight leading-[1.1] text-slate-950 sm:text-5xl dark:text-white">
                  Turn an OpenAPI specification into a test suite
                </h2>
                <p className="max-w-2xl text-base leading-7 text-muted">
                  Analyze endpoints, generate deterministic scenarios, and enhance
                  selectively with local AI. Review every result with its provenance
                  intact, then run the approved suite against your own environment to see
                  real pass/fail results.
                </p>
              </div>
              <dl className="flex max-w-2xl flex-wrap gap-x-6 gap-y-4">
                {HOME_FEATURES.map(({ label, description, Icon }, index) => (
                  <div
                    key={label}
                    className={`flex min-w-[130px] flex-1 flex-col gap-1.5 ${
                      index > 0 ? "sm:border-l sm:border-border sm:pl-6" : ""
                    }`}
                  >
                    <Icon className="h-4 w-4 text-brand-700 dark:text-brand-300" />
                    <dt className="font-mono text-xs text-brand-700 dark:text-brand-300">
                      {label}
                    </dt>
                    <dd className="text-xs text-muted">{description}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-surface shadow-[6px_6px_0_0_var(--color-border)] dark:border-slate-700">
              <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />
              <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-3 dark:bg-white/5">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    New test generation run
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    OpenAPI 3.x · YAML · up to 10 MB
                  </p>
                </div>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
              </div>
              <div className="space-y-4 p-5 sm:p-6">
                <div className="space-y-1">
                  <h3 className="font-display text-lg font-semibold text-slate-950 dark:text-white">
                    Upload specification
                  </h3>
                  <p className="text-sm leading-6 text-muted">
                    The document stays in your local workflow and is never sent to a cloud
                    AI provider.
                  </p>
                </div>
                <label
                  htmlFor="home-spec-upload"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 ${
                    dragActive
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                      : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:bg-white/5 dark:hover:bg-brand-500/10"
                  } ${uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 dark:border-brand-500 dark:bg-white/5 dark:text-brand-300">
                    <UploadIcon className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Drag and drop your specification here
                  </p>
                  <p className="text-xs text-muted">or click to browse your files</p>
                  <input
                    id="home-spec-upload"
                    type="file"
                    accept=".yaml,.yml"
                    aria-label="Upload OpenAPI specification"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                </label>
                {workflow && (
                  <button
                    type="button"
                    onClick={() => setShowStartPage(false)}
                    className={BUTTON_STYLES.ghost}
                  >
                    Cancel — return to my in-progress workflow
                  </button>
                )}
              </div>
            </div>
            <ol className="col-span-full flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0">
              {PIPELINE_PREVIEW_STEPS.map((label, index) => (
                <li key={label} className="flex flex-1 items-center gap-2.5 sm:gap-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${
                        index === 0
                          ? "border-brand-500 text-brand-700 dark:text-brand-300"
                          : "border-border text-muted"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={`whitespace-nowrap text-xs font-medium ${
                        index === 0 ? "text-slate-900 dark:text-white" : "text-muted"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {index < PIPELINE_PREVIEW_STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="mx-3 hidden h-px flex-1 bg-border sm:block"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {workflow && !showStartPage && (
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
              Active run
            </p>
            <p className="mt-1 text-sm text-muted">
              Review and advance the generated test workflow.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Start a new workflow from a different specification"
              onClick={() => setConfirmDiscard(true)}
              className={BUTTON_STYLES.secondary}
            >
              Start a new workflow
            </button>
          </div>
        </div>
      )}
      {uploading && <p className="text-sm text-muted">Uploading…</p>}
      {uploadError && <ErrorState testId="upload-error" message={uploadError} />}
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
            !postmanGenerationAlwaysActionable &&
            (displayStageId !== null && REVISABLE_STAGES.has(displayStageId) ? (
              <output
                data-testid="revisiting-notice"
                className="block rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-100"
              >
                Revisiting a completed stage. Making a change here will mark later stages
                as needing to be redone.
              </output>
            ) : (
              <output
                data-testid="read-only-stage-notice"
                className="block rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-muted dark:bg-white/5"
              >
                Read-only view of a completed stage — nothing here can be changed.
              </output>
            ))}
          {displayStageId === "apiReview" && workflow.apiModel && (
            <ApiReviewStage
              apiModel={workflow.apiModel}
              onAdvanced={handleAdvanced}
              readOnly={workflow.activeStageId !== "apiReview"}
              selectedOperationKeys={workflow.selectedOperationKeys}
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
          {displayStageId === "postmanGeneration" && (
            // Always the interactive form, never a static summary — regenerating with different
            // export options was always possible at any time even before the 2026-09-20
            // `execution` stage amendment (postmanGeneration was previously the last stage, so it
            // never stopped being "active"). PostmanGenerationStage already reseeds its download
            // links from `postmanArtifact` on mount specifically to support being revisited.
            <PostmanGenerationStage
              postmanArtifact={workflow.postmanArtifact}
              specTitle={workflow.apiModel?.info?.title}
              onGenerated={handlePostmanGenerated}
              onContinue={
                workflow.postmanArtifact ? handleContinueToExecution : undefined
              }
            />
          )}
          {displayStageId === "execution" && (
            <ExecutionHandoffNotice
              onGoToImportAndRun={() => {
                if (workflow.postmanArtifact) {
                  onHandoffToExecution?.(
                    workflow.postmanArtifact,
                    workflow.apiModel?.info?.title,
                  );
                }
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Replaces the guided workflow's former, standalone execution screen (specs/009 Clarifications
 * 2026-09-20) — running a generated collection duplicated "Import & Run Collection" (requirement
 * 4), so this stage now only hands off to it instead of running anything itself. The handoff
 * normally already happened automatically the moment the artifact was generated
 * (`maybeHandoff`); this notice's own button exists only to recover that handoff on demand — e.g.
 * after a page reload that resumed directly onto this stage.
 */
function ExecutionHandoffNotice({
  onGoToImportAndRun,
}: Readonly<{ onGoToImportAndRun: () => void }>) {
  return (
    <section
      data-testid="execution-handoff-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
    >
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The Postman collection has been generated. Run it against a real environment from
        &quot;Import &amp; Run Collection&quot;.
      </p>
      <button
        type="button"
        onClick={onGoToImportAndRun}
        className={BUTTON_STYLES.primary}
      >
        Go to Import &amp; Run Collection
      </button>
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
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
        {isUpload ? "Specification Uploaded" : "Specification Analysis"}
      </h2>
      {isUpload && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {specificationFilename}
        </p>
      )}
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
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
        Deterministic Test Suite Generated
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
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
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
        Dependency Analysis
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
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
        <p
          data-testid="dependency-analysis-batching-limitation"
          className="text-sm text-muted"
        >
          {aiBatchingLimitation}
        </p>
      )}
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
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
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
      {error && <ErrorState testId="deterministic-generation-error" message={error} />}
    </section>
  );
}
