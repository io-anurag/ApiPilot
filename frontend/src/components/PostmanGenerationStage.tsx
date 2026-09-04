import { useEffect, useState } from "react";
import type { ExportResult } from "@apipilot/shared-domain";
import {
  artifactFiles,
  artifactHref,
  revokeArtifactHref,
} from "../services/postmanCollectionsClient";
import { generatePostmanCollection, type WorkflowResult } from "../services/testGenerationWorkflowClient";
import { PostmanExportLimitations } from "./PostmanExportLimitations";

const RECOVERY_GUIDANCE: Record<string, string> = {
  empty_approved_scenarios: "Accept at least one scenario in review, then finalize and try again.",
  unknown_operation:
    "The approved scenarios no longer match the specification. Restart the workflow from the current specification.",
  collection_validation_failed:
    "The generated collection did not pass validation, so it was not delivered. Report the problems listed below.",
  unknown_variable: "Clear the value for the variable the collection does not reference, then try again.",
  network_error: "The export could not reach the backend. Check it is running, then try again.",
};

type ExportStatus = "idle" | "loading" | "success" | "error";

interface DownloadLink {
  filename: string;
  label: string;
  href: string;
}

/**
 * Mirrors PostmanExportPanel.tsx's structure (research.md D10) but drives the workflow-scoped
 * `postman-generation` endpoint instead of the stateless export endpoint — the approved TestModel
 * and any approved IntegrationWorkflows already live on the stored workflow (research.md D2: no
 * workflow intent is attached).
 */
export function PostmanGenerationStage({
  postmanArtifact,
  onGenerated,
}: {
  postmanArtifact?: ExportResult;
  onGenerated: (result: WorkflowResult) => void;
}) {
  const [status, setStatus] = useState<ExportStatus>(postmanArtifact ? "success" : "idle");
  const [result, setResult] = useState<ExportResult | null>(postmanArtifact ?? null);
  const [error, setError] = useState<{ message: string; error: string; problems?: string[] } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [links, setLinks] = useState<DownloadLink[]>([]);

  useEffect(() => {
    return () => {
      for (const link of links) revokeArtifactHref(link.href);
    };
  }, [links]);

  async function handleGenerate() {
    setStatus("loading");
    setError(null);
    const outcome = await generatePostmanCollection(baseUrl.trim().length > 0 ? { baseUrl: baseUrl.trim() } : undefined);
    if (!outcome.ok) {
      setError({ message: outcome.message, error: outcome.error, problems: outcome.problems });
      setStatus("error");
      return;
    }
    const artifact = outcome.workflow.postmanArtifact;
    if (artifact) {
      setResult(artifact);
      setLinks(
        artifactFiles(artifact).map((file) => ({
          filename: file.filename,
          label: file.label,
          href: artifactHref(file.text, file.mimeType),
        })),
      );
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
      <h2 id="postman-generation-heading" className="text-base font-semibold text-slate-900">
        Generate a Postman Collection
      </h2>
      <p className="text-sm text-slate-600">
        Exports the approved scenarios as a runnable collection, a companion environment, and a
        README. Nothing is executed and no credential is written into the collection.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="postman-generation-base-url" className="text-xs font-medium text-muted">
          Base address (optional)
        </label>
        <input
          id="postman-generation-base-url"
          type="text"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={status === "loading"}
          className="w-full max-w-sm rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
        />
      </div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={status === "loading"}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Generating…" : "Generate Postman Collection"}
      </button>
      {status === "loading" && (
        <p role="status" className="text-sm text-muted">
          Generating the collection, environment, and README…
        </p>
      )}
      {status === "error" && error && (
        <div role="alert" data-testid="postman-generation-error" className="space-y-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <p className="font-medium">Generation failed: {error.message}</p>
          <p>{RECOVERY_GUIDANCE[error.error] ?? "Try again."}</p>
          {error.problems && error.problems.length > 0 && (
            <ul className="ml-4 list-disc">
              {error.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status === "success" && result && (
        <div data-testid="postman-generation-success" className="space-y-3 rounded-md border border-success-200 bg-success-50 p-4">
          <p className="text-sm text-success-700">
            {result.summary.requestCount} request(s) in {result.summary.folderCount} folder(s);{" "}
            {result.summary.byProvenance.RULE} rule-derived and {result.summary.byProvenance.AI} AI-derived.
          </p>
          <ul data-testid="postman-generation-downloads" className="space-y-1 text-sm">
            {links.map((link) => (
              <li key={link.filename}>
                <a
                  href={link.href}
                  download={link.filename}
                  className="font-medium text-brand-700 underline decoration-brand-300 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {link.label} ({link.filename})
                </a>
              </li>
            ))}
          </ul>
          <PostmanExportLimitations limitations={result.limitations} />
        </div>
      )}
    </section>
  );
}
