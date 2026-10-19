import { useId, useState } from "react";
import type { SecurityExportReply } from "@apipilot/shared-domain";
import { artifactFiles, downloadArtifact } from "../../services/postmanCollectionsClient";
import { exportSecurityPostman, type ApiResult } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Card, CardHeader } from "../patterns/Card";
import { PostmanExportLimitations } from "../PostmanExportLimitations";

/** The file-name stem for the downloads, so they are not mistaken for the test-suite export's files. */
const FILE_STEM = "Security Lab";

type Failure = Extract<ApiResult<SecurityExportReply>, { ok: false }>;

const EXCLUDED_REASON = { stale: "the specification changed", orphaned: "its operation is no longer in the specification" } as const;

const problemsOf = (failure: Failure): string[] => {
  const problems = failure.details.problems;
  return Array.isArray(problems) ? problems.filter((problem): problem is string => typeof problem === "string") : [];
};

/**
 * Export of the approved security scenarios as a Postman collection (specs/057 FR-063, US7). Only scenario versions whose
 * approval still matches their content are exported; credentials are empty variables in the environment, never values.
 * What the collection cannot express is listed rather than dropped, and approved scenarios the specification has since
 * left behind are named. It needs a loaded specification, and nothing is sent to any target.
 */
export function SecurityExportPanel({ specificationLoaded }: Readonly<{ specificationLoaded: boolean }>) {
  const [baseUrl, setBaseUrl] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reply, setReply] = useState<SecurityExportReply | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const baseUrlId = useId();
  const reasonId = useId();
  const headingId = useId();

  async function runExport() {
    setExporting(true);
    setFailure(null);
    const result = await exportSecurityPostman(baseUrl);
    setExporting(false);
    if (result.ok) {
      setReply(result.data);
      return;
    }
    setReply(null);
    setFailure(result);
  }

  const blockedReason = specificationLoaded ? null : "No specification is loaded, so the approved scenarios cannot be checked against it. Upload one in the Guided Workflow to export.";
  const problems = failure ? problemsOf(failure) : [];

  return (
    <Card as="section" aria-labelledby={headingId} data-testid="security-export-panel">
      <CardHeader
        title="Export approved scenarios (Postman)"
        titleId={headingId}
        subtitle="Only approved scenario versions are exported. Credentials are left as empty variables; no secret is written into the files."
      />
      <div className="space-y-3">
        <div className="flex max-w-lg flex-col gap-1">
          <label htmlFor={baseUrlId} className="text-xs font-medium text-text-secondary">
            Base address (optional)
          </label>
          <input
            id={baseUrlId}
            type="text"
            inputMode="url"
            value={baseUrl}
            placeholder="https://qa.internal.example"
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={exporting || blockedReason !== null}
            className={`${FIELD_STYLES} w-full font-mono`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void runExport()} disabled={exporting || blockedReason !== null} aria-describedby={blockedReason ? reasonId : undefined} className={BUTTON_STYLES.secondary}>
            {exporting ? "Exporting..." : "Export approved scenarios"}
          </button>
          {blockedReason && (
            <p id={reasonId} className="text-xs text-text-secondary" data-testid="security-export-blocked">
              {blockedReason}
            </p>
          )}
        </div>

        {exporting && <output className="block text-sm text-text-secondary">Building the collection from the approved scenarios.</output>}

        {failure?.error === "no_approved_scenarios" && <EmptyState testId="security-export-empty" message="There are no approved scenarios to export." description={failure.message} />}
        {failure && failure.error !== "no_approved_scenarios" && (
          <ErrorState testId="security-export-error" message={`The export failed: ${failure.message}`} detail="Nothing was exported. Fix the cause and try again.">
            {problems.length > 0 && (
              <ul data-testid="security-export-problems" className="ml-4 list-disc">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </ErrorState>
        )}

        {reply && (
          <div data-testid="security-export-success" className="space-y-3 rounded-md border border-success-200 bg-success-50 p-4 text-sm text-text-secondary dark:border-success-500 dark:bg-success-500/10">
            <p className="font-semibold text-success-700 dark:text-success-100">Validation passed: the collection was checked against the expected collection format before delivery.</p>
            <p>
              {reply.summary.requestCount} request(s) in {reply.summary.folderCount} folder(s). Fill in the empty credential variables in Postman after importing; the README lists them.
            </p>
            <ul data-testid="security-export-downloads" className="space-y-1">
              {artifactFiles(reply, FILE_STEM).map((file) => (
                <li key={file.filename}>
                  <button type="button" onClick={() => downloadArtifact(file.text, file.mimeType, file.filename)} className={BUTTON_STYLES.ghost}>
                    {file.label} ({file.filename})
                  </button>
                </li>
              ))}
            </ul>
            {reply.excluded.length > 0 && (
              <div data-testid="security-export-excluded">
                <p className="font-medium text-text-primary">
                  Left out because the specification has changed since they were approved ({reply.excluded.length}). Regenerate and review them to export them:
                </p>
                <ul className="list-disc pl-5">
                  {reply.excluded.map((entry) => (
                    <li key={entry.scenarioId}>
                      <span className="font-mono text-xs">{entry.scenarioId}</span>: {EXCLUDED_REASON[entry.reason]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <PostmanExportLimitations limitations={reply.limitations} />
          </div>
        )}
      </div>
    </Card>
  );
}
