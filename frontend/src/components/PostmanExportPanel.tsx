import { useEffect, useState } from "react";
import type { ApiModel, ExportResult, TestModel } from "@apipilot/shared-domain";
import {
  artifactFiles,
  artifactHref,
  requestPostmanExport,
  revokeArtifactHref,
  type PostmanExportResult,
} from "../services/postmanCollectionsClient";
import { PostmanExportLimitations } from "./PostmanExportLimitations";

/** Recovery guidance per refusal, so a failed export tells the engineer what to do next (FR-027). */
const RECOVERY_GUIDANCE: Record<string, string> = {
  empty_approved_test_model:
    "Accept at least one scenario in review, then export again.",
  unknown_operation:
    "The approved scenarios no longer match the specification. Regenerate the test model from the current specification, then export again.",
  workflow_intent_unsupported:
    "This export renders single-operation scenarios only. Remove the multi-step scenarios, or wait for workflow support, then export again.",
  collection_validation_failed:
    "The generated collection did not pass validation, so it was not delivered. Report the problems listed below.",
  unknown_variable:
    "Clear the value for the variable the collection does not reference, then export again.",
  invalid_request:
    "The export request was rejected. Reload the review workspace and try again.",
  network_error: "The export could not reach the backend. Check it is running, then try again.",
};

type ExportStatus = "idle" | "loading" | "success" | "empty" | "error";

interface DownloadLink {
  filename: string;
  label: string;
  href: string;
}

function toDownloadLinks(result: ExportResult): DownloadLink[] {
  return artifactFiles(result).map((file) => ({
    filename: file.filename,
    label: file.label,
    href: artifactHref(file.text, file.mimeType),
  }));
}

/**
 * The export action: one click produces the collection, the environment, and the accompanying
 * document (FR-022), with distinct loading, success, empty, and failure states (FR-027).
 * A supplied credential value is held only in this form's state and is never rendered back
 * from the response (FR-011).
 */
export function PostmanExportPanel({
  apiModel,
  testModel,
}: {
  apiModel: ApiModel;
  testModel: TestModel;
}) {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [result, setResult] = useState<ExportResult | null>(null);
  const [failure, setFailure] = useState<PostmanExportResult & { ok: false } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<DownloadLink[]>([]);

  useEffect(() => {
    return () => {
      for (const link of links) revokeArtifactHref(link.href);
    };
  }, [links]);

  const declaredVariables = (result?.environment.values ?? []).filter(
    (value) => value.key !== "baseUrl",
  );

  async function handleExport() {
    setStatus("loading");
    setFailure(null);
    const supplied = Object.fromEntries(
      Object.entries(variableValues).filter(
        ([key, value]) =>
          value.trim().length > 0 &&
          declaredVariables.some((variable) => variable.key === key),
      ),
    );
    const outcome = await requestPostmanExport(apiModel, testModel, {
      ...(baseUrl.trim().length > 0 ? { baseUrl: baseUrl.trim() } : {}),
      ...(Object.keys(supplied).length > 0 ? { variableValues: supplied } : {}),
    });

    if (outcome.ok) {
      setResult(outcome.result);
      setLinks(toDownloadLinks(outcome.result));
      setStatus("success");
      return;
    }

    setFailure(outcome);
    setResult(null);
    setLinks([]);
    setStatus(outcome.error === "empty_approved_test_model" ? "empty" : "error");
  }

  return (
    <section aria-labelledby="postman-export-heading" data-testid="postman-export-panel">
      <h3 id="postman-export-heading">Export a Postman collection</h3>
      <p>
        Exports the scenarios you accepted as a runnable collection, a companion environment, and
        a README. Nothing is executed and no credential is written into the collection.
      </p>

      <label htmlFor="postman-export-base-url">Base address (optional)</label>
      <input
        id="postman-export-base-url"
        type="text"
        value={baseUrl}
        placeholder="https://qa.internal.example"
        onChange={(event) => setBaseUrl(event.target.value)}
        disabled={status === "loading"}
      />

      {declaredVariables.length > 0 && (
        <fieldset data-testid="postman-export-variables">
          <legend>Values for the variables this collection references</legend>
          <p>
            These are written to the environment file only, never into the collection. Leave a
            field empty to fill it in yourself after importing.
          </p>
          {declaredVariables.map((variable) => (
            <div key={variable.key}>
              <label htmlFor={`postman-export-variable-${variable.key}`}>{variable.key}</label>
              <input
                id={`postman-export-variable-${variable.key}`}
                type={variable.type === "secret" ? "password" : "text"}
                value={variableValues[variable.key] ?? ""}
                onChange={(event) =>
                  setVariableValues((current) => ({
                    ...current,
                    [variable.key]: event.target.value,
                  }))
                }
                disabled={status === "loading"}
              />
            </div>
          ))}
        </fieldset>
      )}

      <button type="button" onClick={handleExport} disabled={status === "loading"}>
        {status === "loading" ? "Exporting…" : "Export collection"}
      </button>

      {status === "loading" && (
        <p role="status" data-testid="export-loading">
          Generating the collection, environment, and README…
        </p>
      )}

      {status === "empty" && (
        <p data-testid="export-empty">
          There are no accepted scenarios to export.{" "}
          {RECOVERY_GUIDANCE.empty_approved_test_model}
        </p>
      )}

      {status === "error" && failure && (
        <div role="alert" data-testid="export-error">
          <p>Export failed: {failure.message}</p>
          <p>{RECOVERY_GUIDANCE[failure.error] ?? "Try the export again."}</p>
          {failure.problems && failure.problems.length > 0 && (
            <ul data-testid="export-validation-problems">
              {failure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status === "success" && result && (
        <div data-testid="export-success">
          <p data-testid="export-validation-result">
            Validation passed: the collection was checked against the expected collection format
            before delivery.
          </p>
          <p>
            {result.summary.requestCount} request(s) in {result.summary.folderCount} folder(s);{" "}
            {result.summary.byProvenance.RULE} rule-derived and {result.summary.byProvenance.AI}{" "}
            AI-derived.
          </p>
          <ul data-testid="export-downloads">
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