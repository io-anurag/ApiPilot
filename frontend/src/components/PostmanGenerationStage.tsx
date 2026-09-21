import { useState } from "react";
import type { ExportResult, ProvenanceCounts } from "@apipilot/shared-domain";
import { artifactFiles, downloadArtifact } from "../services/postmanCollectionsClient";
import {
  generatePostmanCollection,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { PostmanExportLimitations } from "./PostmanExportLimitations";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";
import { SummaryPanel, type SummaryPanelSegment } from "./SummaryPanel";

const RECOVERY_GUIDANCE: Record<string, string> = {
  empty_approved_scenarios:
    "Accept at least one scenario in review, then finalize and try again.",
  unknown_operation:
    "The approved scenarios no longer match the specification. Restart the workflow from the current specification.",
  collection_validation_failed:
    "The generated collection did not pass validation, so it was not delivered. Report the problems listed below.",
  unknown_variable:
    "Clear the value for the variable the collection does not reference, then try again.",
  network_error:
    "The export could not reach the backend. Check it is running, then try again.",
};

type ExportStatus = "idle" | "loading" | "success" | "error";

/**
 * Mirrors PostmanExportPanel.tsx's structure (research.md D10) but drives the workflow-scoped
 * `postman-generation` endpoint instead of the stateless export endpoint — the approved TestModel
 * and any approved IntegrationWorkflows already live on the stored workflow (research.md D2: no
 * workflow intent is attached).
 */
export function PostmanGenerationStage({
  postmanArtifact,
  specTitle,
  onGenerated,
  onContinue,
}: Readonly<{
  postmanArtifact?: ExportResult;
  specTitle?: string;
  onGenerated: (result: WorkflowResult) => void;
  /** Present once the artifact exists, so the success screen (with its downloads) can stay put
   * instead of the workflow jumping straight to execution the moment generation finishes —
   * moving on is the user's own explicit next step. */
  onContinue?: () => void;
}>) {
  const [status, setStatus] = useState<ExportStatus>(
    postmanArtifact ? "success" : "idle",
  );
  const [result, setResult] = useState<ExportResult | null>(postmanArtifact ?? null);
  const [error, setError] = useState<{
    message: string;
    error: string;
    problems?: string[];
  } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  async function handleGenerate() {
    setStatus("loading");
    setError(null);
    const outcome = await generatePostmanCollection(
      baseUrl.trim().length > 0 ? { baseUrl: baseUrl.trim() } : undefined,
    );
    if (!outcome.ok) {
      setError({
        message: outcome.message,
        error: outcome.error,
        problems: outcome.problems,
      });
      setStatus("error");
      return;
    }
    const artifact = outcome.workflow.postmanArtifact;
    if (artifact) {
      setResult(artifact);
    }
    setStatus("success");
    onGenerated(outcome);
  }

  return (
    <section
      aria-labelledby="postman-generation-heading"
      data-testid="postman-generation-stage"
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2
        id="postman-generation-heading"
        className="text-base font-semibold text-slate-900 dark:text-white"
      >
        Generate a Postman Collection
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Exports the approved scenarios as a runnable collection, a companion environment,
        and a README. Nothing is executed and no credential is written into the
        collection.
      </p>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="postman-generation-base-url"
          className="text-xs font-medium text-muted"
        >
          Base address (optional)
        </label>
        <input
          id="postman-generation-base-url"
          type="text"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={status === "loading"}
          className="w-full max-w-sm rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50"
        />
      </div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={status === "loading"}
        className={BUTTON_STYLES.primary}
      >
        {status === "loading" ? "Generating…" : "Generate Postman Collection"}
      </button>
      {status === "loading" && (
        <output className="block text-sm text-muted">
          Generating the collection, environment, and README…
        </output>
      )}
      {status === "error" && error && (
        <ErrorState
          testId="postman-generation-error"
          message={`Generation failed: ${error.message}`}
          detail={RECOVERY_GUIDANCE[error.error] ?? "Try again."}
        >
          {error.problems && error.problems.length > 0 && (
            <ul className="ml-4 list-disc">
              {error.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </ErrorState>
      )}
      {status === "success" && result && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div
            data-testid="postman-generation-success"
            className="min-w-0 space-y-3 rounded-md border border-success-200 bg-success-50 p-4 dark:border-success-500 dark:bg-success-500/10"
          >
            <p className="text-sm text-success-700 dark:text-success-100">
              {result.summary.requestCount} request(s) in {result.summary.folderCount}{" "}
              folder(s); {result.summary.byProvenance.RULE} rule-derived and{" "}
              {result.summary.byProvenance.AI} AI-derived.
            </p>
            <ul data-testid="postman-generation-downloads" className="space-y-1 text-sm">
              {artifactFiles(result, specTitle).map((file) => (
                <li key={file.filename}>
                  <button
                    type="button"
                    onClick={() =>
                      downloadArtifact(file.text, file.mimeType, file.filename)
                    }
                    className="font-medium text-brand-700 underline decoration-brand-300 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300 dark:hover:text-brand-200"
                  >
                    {file.label} ({file.filename})
                  </button>
                </li>
              ))}
            </ul>
            <PostmanExportLimitations limitations={result.limitations} />
          </div>
          <SummaryPanel
            testId="postman-generation-summary-panel"
            statValue={result.summary.requestCount}
            statLabel={`request${result.summary.requestCount === 1 ? "" : "s"} in ${result.summary.folderCount} folder${result.summary.folderCount === 1 ? "" : "s"}`}
            segments={provenanceSegments(result.summary.byProvenance)}
            description="Nothing is executed and no credential is written into the collection — download it and run it from your own environment."
            action={onContinue ? { label: "Continue to Import & Run Collection", onClick: onContinue } : undefined}
          />
        </div>
      )}
    </section>
  );
}

function provenanceSegments(byProvenance: ProvenanceCounts): SummaryPanelSegment[] {
  return [
    { key: "RULE", label: "Rule-derived", count: byProvenance.RULE, tone: "neutral" },
    { key: "AI", label: "AI-derived", count: byProvenance.AI, tone: "brand" },
  ];
}
