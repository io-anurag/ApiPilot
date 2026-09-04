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
    <section aria-labelledby="postman-generation-heading" data-testid="postman-generation-stage">
      <h2 id="postman-generation-heading">Generate a Postman Collection</h2>
      <p>
        Exports the approved scenarios as a runnable collection, a companion environment, and a
        README. Nothing is executed and no credential is written into the collection.
      </p>
      <label htmlFor="postman-generation-base-url">Base address (optional)</label>
      <input
        id="postman-generation-base-url"
        type="text"
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.target.value)}
        disabled={status === "loading"}
      />
      <button type="button" onClick={handleGenerate} disabled={status === "loading"}>
        {status === "loading" ? "Generating…" : "Generate Postman Collection"}
      </button>
      {status === "loading" && <p role="status">Generating the collection, environment, and README…</p>}
      {status === "error" && error && (
        <div role="alert" data-testid="postman-generation-error">
          <p>Generation failed: {error.message}</p>
          <p>{RECOVERY_GUIDANCE[error.error] ?? "Try again."}</p>
          {error.problems && error.problems.length > 0 && (
            <ul>
              {error.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status === "success" && result && (
        <div data-testid="postman-generation-success">
          <p>
            {result.summary.requestCount} request(s) in {result.summary.folderCount} folder(s);{" "}
            {result.summary.byProvenance.RULE} rule-derived and {result.summary.byProvenance.AI} AI-derived.
          </p>
          <ul data-testid="postman-generation-downloads">
            {links.map((link) => (
              <li key={link.filename}>
                <a href={link.href} download={link.filename}>
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
