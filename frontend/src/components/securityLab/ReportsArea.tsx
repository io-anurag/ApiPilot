import { useMemo, useState, type ReactNode } from "react";
import { FINDING_STATUSES, SCENARIO_OUTCOME_KINDS, SECURITY_REVIEW_STATES, type SecurityReport } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { downloadReport, fetchReport, listRuns } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { findingTitle, occurrenceText } from "./findingViewModel";
import { RetainedDataPanel } from "./RetainedDataPanel";
import { RUN_STATUS } from "./runViewModel";
import { saveBlob } from "./saveBlob";
import { SecurityExportPanel } from "./SecurityExportPanel";
import { formatTimestamp } from "./scenarioViewModel";
import { SEVERITY_ORDER, findingStatusVariant, outcomeVariant, reviewStateVariant, severityVariant, supportLevelVariant } from "./securityViewModel";

type Format = "html" | "json";

function ReportBody({ report }: Readonly<{ report: SecurityReport }>) {
  const { overview } = report;
  const names = Object.fromEntries(report.categoryCoverage.map((entry) => [entry.categoryId, entry.name]));
  return (
    <div className="space-y-4" data-testid="report-body">
      <Card as="section" aria-labelledby="report-summary-heading" variant="flat">
        <CardHeader title="Assessment summary" titleId="report-summary-heading" level={3} />
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="report-summary">
          <div>
            <dt className="inline text-text-secondary">Assessment: </dt>
            <dd className="inline font-medium text-text-primary">{report.assessmentLabel ?? "All retained assessments"}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Generated: </dt>
            <dd className="inline text-text-primary">{formatTimestamp(report.generatedAt)}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Specification: </dt>
            <dd className="inline text-text-primary">
              {overview.specificationLoaded ? `loaded${report.specificationRevision ? `, revision ${report.specificationRevision.slice(0, 12)}` : ""}` : "not loaded: this report is built from retained work"}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Taxonomy: </dt>
            <dd className="inline text-text-primary">{report.taxonomyEdition}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Scenarios: </dt>
            <dd className="inline text-text-primary">
              {overview.scenarioCounts.total} ({SECURITY_REVIEW_STATES.map((state) => `${reviewStateVariant(state).label} ${overview.scenarioCounts.byReviewState[state]}`).join(", ")})
            </dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Findings: </dt>
            <dd className="inline text-text-primary">
              {overview.findingCounts.total} ({SEVERITY_ORDER.map((severity) => `${severityVariant(severity).label} ${overview.findingCounts.bySeverity[severity]}`).join(", ")}); {occurrenceText(overview.findingCounts.occurrences)}, counted
              separately
            </dd>
          </div>
        </dl>
      </Card>

      <Card as="section" aria-labelledby="report-coverage-heading" variant="flat">
        <CardHeader title="Category coverage and outcomes" titleId="report-coverage-heading" level={3} />
        <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Category coverage">
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Each category, its support level, its scenarios and the outcomes of their results</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Category</th>
                <th scope="col" className={TABLE_STYLES.th}>Support level</th>
                <th scope="col" className={TABLE_STYLES.th}>Scenarios</th>
                {SCENARIO_OUTCOME_KINDS.map((kind) => (
                  <th key={kind} scope="col" className={TABLE_STYLES.th}>{outcomeVariant(kind).label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.categoryCoverage.map((entry) => {
                const level = supportLevelVariant(entry.supportLevel);
                return (
                  <tr key={entry.categoryId} data-testid="coverage-row" data-category={entry.categoryId}>
                    <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>{entry.name}</th>
                    <td className={TABLE_STYLES.td}><StatusBadge label={level.label} tone={level.tone} /></td>
                    <td className={TABLE_STYLES.td}>{entry.scenarios}</td>
                    {SCENARIO_OUTCOME_KINDS.map((kind) => (
                      <td key={kind} className={TABLE_STYLES.td}>{entry.outcomes[kind]}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {report.notCovered.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-sm font-semibold text-text-primary">Not covered</p>
            <ul className="list-disc pl-5 text-sm text-text-secondary" data-testid="not-covered">
              {report.notCovered.map((entry) => (
                <li key={entry.categoryId}>
                  {names[entry.categoryId] ?? entry.categoryId}: {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-xs text-text-secondary">Blocked, errored and not run are not passes.</p>
      </Card>

      <Card as="section" aria-labelledby="report-findings-heading" variant="flat">
        <CardHeader title="Findings and remediation status" titleId="report-findings-heading" level={3} subtitle="Evidence basis: requests a run actually sent." />
        {report.findings.length === 0 ? (
          <EmptyState compact message="There are no findings in this report. That is not proof that the API is secure." testId="report-no-findings" />
        ) : (
          <>
            <p className="mb-2 text-sm text-text-secondary" data-testid="report-finding-status-counts">
              {FINDING_STATUSES.map((status) => `${findingStatusVariant(status).label} ${overviewStatus(report, status)}`).join(", ")}
            </p>
            <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Findings in the report">
              <table className={TABLE_STYLES.table}>
                <caption className="sr-only">Findings with severity, status, occurrences and the suggested remediation</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TABLE_STYLES.th}>Finding</th>
                    <th scope="col" className={TABLE_STYLES.th}>Severity</th>
                    <th scope="col" className={TABLE_STYLES.th}>Status</th>
                    <th scope="col" className={TABLE_STYLES.th}>Occurrences</th>
                    <th scope="col" className={TABLE_STYLES.th}>Remediation</th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((finding) => {
                    const severity = severityVariant(finding.severity.current);
                    const status = findingStatusVariant(finding.status);
                    return (
                      <tr key={finding.id} data-testid="report-finding-row">
                        <th scope="row" className={`${TABLE_STYLES.td} max-w-xs text-left font-medium`}>{findingTitle(finding, names[finding.categoryId])}</th>
                        <td className={TABLE_STYLES.td}><StatusBadge label={severity.label} tone={severity.tone} /></td>
                        <td className={TABLE_STYLES.td}><StatusBadge label={status.label} tone={status.tone} /></td>
                        <td className={TABLE_STYLES.td}>{occurrenceText(finding.occurrenceCount)}</td>
                        <td className={`${TABLE_STYLES.td} max-w-md text-xs`}>{finding.remediation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card as="section" aria-labelledby="report-runs-heading" variant="flat">
        <CardHeader title="Runs included" titleId="report-runs-heading" level={3} />
        {report.runs.length === 0 ? (
          <EmptyState compact message="No run is included: nothing in this report has been sent to a target." testId="report-no-runs" />
        ) : (
          <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Runs in the report">
            <table className={TABLE_STYLES.table}>
              <caption className="sr-only">Runs included in the report</caption>
              <thead>
                <tr>
                  <th scope="col" className={TABLE_STYLES.th}>Started</th>
                  <th scope="col" className={TABLE_STYLES.th}>Profile</th>
                  <th scope="col" className={TABLE_STYLES.th}>Target</th>
                  <th scope="col" className={TABLE_STYLES.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.runs.map((run) => (
                  <tr key={run.id} data-testid="report-run-row">
                    <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>{formatTimestamp(run.startedAt)}</th>
                    <td className={TABLE_STYLES.td}>{run.profileName}</td>
                    <td className={TABLE_STYLES.td}>
                      {run.tier} <span className="break-all font-mono text-xs">{run.baseUrl}</span>
                    </td>
                    <td className={TABLE_STYLES.td}><StatusBadge label={RUN_STATUS[run.status].label} tone={RUN_STATUS[run.status].tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Banner tone="neutral" title="Limits of this assessment" testId="report-limits">
        {report.limitsStatement}
      </Banner>
    </div>
  );
}

const overviewStatus = (report: SecurityReport, status: (typeof FINDING_STATUSES)[number]): number => report.overview.findingCounts.byStatus[status];

/**
 * The Reports area (specs/057 FR-061, FR-062): the assessment as a report on screen and as an HTML or JSON file, from
 * retained work, so it needs no specification and can be made after the session that gathered the evidence has ended.
 * The report can be narrowed to some runs. Nothing to report yet is its own state, with the server's message. Below it,
 * the retained data and how to delete it.
 */
export function ReportsArea({ specificationLoaded = true }: Readonly<{ specificationLoaded?: boolean }> = {}) {
  const runs = useSecurityResource((signal) => listRuns({ signal }));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [epoch, setEpoch] = useState(0);
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const runIds = useMemo(() => [...chosen].sort(), [chosen]);
  const report = useSecurityResource((signal) => fetchReport(runIds.length > 0 ? runIds : undefined, { signal }), [runIds.join(","), epoch]);
  const nothing = report.problem?.kind === "error" && report.problem.code === "nothing_to_report";

  async function download(format: Format) {
    setDownloading(format);
    setDownloadError(null);
    setDownloaded(null);
    const result = await downloadReport(format, runIds.length > 0 ? runIds : undefined);
    setDownloading(null);
    if (!result.ok) {
      setDownloadError(result.message);
      return;
    }
    saveBlob(result.data.blob, result.data.fileName);
    setDownloaded(result.data.fileName);
  }

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  let reportBody: ReactNode;
  if (nothing) {
    reportBody = (
      <EmptyState message="There is nothing to report yet." description={report.problem?.message ?? "Generate scenarios, run them, or analyze a specification first."} testId="report-nothing" />
    );
  } else if (report.problem && !report.data) {
    reportBody = (
      <ErrorState testId="report-error" message="The report could not be built" detail={`${report.problem.message} This is not the same as an empty report.`}>
        <button type="button" onClick={report.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!report.data) {
    reportBody = (
      <div role="status" aria-label="Building the report" className="space-y-3">
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
        <Skeleton className="h-40 w-full rounded bg-surface-strong" />
      </div>
    );
  } else {
    reportBody = <ReportBody report={report.data} />;
  }

  const downloadBlocked = nothing ? "There is nothing to report yet, so there is nothing to download." : undefined;

  return (
    <div data-testid="security-reports" className="space-y-4">
      <Card as="section" aria-labelledby="report-heading">
        <CardHeader
          title="Assessment report"
          titleId="report-heading"
          subtitle="Built from retained work, so it needs no specification. It states what was and was not tested."
          actions={
            <>
              <button type="button" onClick={() => void download("html")} disabled={downloading !== null || downloadBlocked !== undefined} aria-describedby={downloadBlocked ? "report-download-blocked" : undefined} className={BUTTON_STYLES.primary}>
                {downloading === "html" ? "Preparing..." : "Download HTML report"}
              </button>
              <button type="button" onClick={() => void download("json")} disabled={downloading !== null || downloadBlocked !== undefined} aria-describedby={downloadBlocked ? "report-download-blocked" : undefined} className={BUTTON_STYLES.secondary}>
                {downloading === "json" ? "Preparing..." : "Download JSON report"}
              </button>
            </>
          }
        />
        <div className="space-y-4">
          {downloadBlocked && (
            <p id="report-download-blocked" className="text-xs text-text-secondary">
              {downloadBlocked}
            </p>
          )}
          {downloadError && <ErrorState testId="report-download-error" message="The report was not downloaded" detail={downloadError} />}
          {downloaded && (
            <p role="status" className="text-sm text-text-secondary" data-testid="report-downloaded">
              Saved {downloaded}.
            </p>
          )}

          {runs.data && runs.data.runs.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-semibold text-text-primary">Limit the report to some runs (none ticked means every run)</legend>
              <div className="flex flex-col gap-1">
                {runs.data.runs.map((run) => (
                  <label key={run.id} className="flex items-center gap-2 text-sm text-text-primary">
                    <input type="checkbox" className="h-4 w-4 rounded border-border-control" checked={chosen.has(run.id)} onChange={(event) => toggle(run.id, event.target.checked)} />
                    Run started {formatTimestamp(run.startedAt)}, {run.profileSummary.environmentName} ({run.profileSummary.tier}), {RUN_STATUS[run.status].label.toLowerCase()}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {runs.problem && !runs.data && (
            <ErrorState testId="report-runs-error" message="The list of runs could not be read" detail={`${runs.problem.message} The report can still be made for every run.`}>
              <button type="button" onClick={runs.refresh} className={BUTTON_STYLES.secondary}>
                Retry
              </button>
            </ErrorState>
          )}

          {reportBody}
        </div>
      </Card>

      <SecurityExportPanel specificationLoaded={specificationLoaded} />

      <RetainedDataPanel onDeleted={() => { runs.refresh(); setChosen(new Set()); setEpoch((current) => current + 1); }} />
    </div>
  );
}
