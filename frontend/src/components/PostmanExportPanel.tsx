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
  empty_approved_test_model: "Accept at least one scenario in review, then export again.",
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
  network_error:
    "The export could not reach the backend. Check it is running, then try again.",
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
}: Readonly<{
  apiModel: ApiModel;
  testModel: TestModel;
}>) {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [result, setResult] = useState<ExportResult | null>(null);
  const [failure, setFailure] = useState<(PostmanExportResult & { ok: false }) | null>(
    null,
  );
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
    <section
      aria-labelledby="postman-export-heading"
      data-testid="postman-export-panel"
      className="space-y-4 rounded-md border border-border bg-surface p-5 shadow-sm"
    >
      <div className="space-y-1">
        <h3
          id="postman-export-heading"
          className="text-base font-semibold text-slate-900"
        >
          Export a Postman collection
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Exports the scenarios you accepted as a runnable collection, a companion
          environment, and a README. Nothing is executed and no credential is written into
          the collection.
        </p>
      </div>

      <div className="flex max-w-lg flex-col gap-1">
        <label
          htmlFor="postman-export-base-url"
          className="text-xs font-medium text-muted"
        >
          Base address (optional)
        </label>
        <input
          id="postman-export-base-url"
          type="text"
          value={baseUrl}
          placeholder="https://qa.internal.example"
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={status === "loading"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50"
        />
      </div>

      {declaredVariables.length > 0 && (
        <fieldset
          data-testid="postman-export-variables"
          className="space-y-3 border-t border-border pt-4"
        >
          <legend className="text-sm font-semibold text-slate-900">
            Values for referenced variables
          </legend>
          <p className="text-sm leading-6 text-muted">
            These are written to the environment file only, never into the collection.
            Leave a field empty to fill it in yourself after importing.
          </p>
          {declaredVariables.map((variable) => (
            <div key={variable.key} className="flex max-w-lg flex-col gap-1">
              <label
                htmlFor={`postman-export-variable-${variable.key}`}
                className="font-mono text-xs font-medium text-slate-700"
              >
                {variable.key}
              </label>
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
                className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50"
              />
            </div>
          ))}
        </fieldset>
      )}

      <button
        type="button"
        onClick={handleExport}
        disabled={status === "loading"}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Exporting…" : "Export collection"}
      </button>

      {status === "loading" && (
        <output
          data-testid="export-loading"
          className="block border-l-4 border-brand-500 bg-brand-50 px-3 py-2 text-sm text-brand-800"
        >
          Generating the collection, environment, and README…
        </output>
      )}

      {status === "empty" && (
        <p
          data-testid="export-empty"
          className="border border-dashed border-border bg-slate-50 px-4 py-5 text-sm text-slate-700"
        >
          There are no accepted scenarios to export.{" "}
          {RECOVERY_GUIDANCE.empty_approved_test_model}
        </p>
      )}

      {status === "error" && failure && (
        <div
          role="alert"
          data-testid="export-error"
          className="space-y-1 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"
        >
          <p className="font-semibold">Export failed: {failure.message}</p>
          <p>{RECOVERY_GUIDANCE[failure.error] ?? "Try the export again."}</p>
          {failure.problems && failure.problems.length > 0 && (
            <ul data-testid="export-validation-problems" className="ml-4 list-disc">
              {failure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status === "success" && result && (
        <div
          data-testid="export-success"
          className="space-y-3 rounded-md border border-success-200 bg-success-50 p-4 text-sm text-slate-700"
        >
          <p
            data-testid="export-validation-result"
            className="font-semibold text-success-700"
          >
            Validation passed: the collection was checked against the expected collection
            format before delivery.
          </p>
          <p>
            {result.summary.requestCount} request(s) in {result.summary.folderCount}{" "}
            folder(s); {result.summary.byProvenance.RULE} rule-derived and{" "}
            {result.summary.byProvenance.AI} AI-derived.
          </p>
          <ul data-testid="export-downloads" className="space-y-1">
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
