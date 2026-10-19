import { useId, useState, type ReactNode } from "react";
import { SEVERITIES, type FindingStatus, type SecurityFinding, type Severity } from "@apipilot/shared-domain";
import { patchFinding } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { Banner } from "../patterns/Banner";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { EvidenceView } from "./EvidenceView";
import { CONFIDENCE_LABEL, STATUS_EXPLANATION, checkFindingChange, findingTitle, occurrenceText, resolvedAssertionText, statusTargets } from "./findingViewModel";
import { expectedBasisView, formatTimestamp, splitOperationKey } from "./scenarioViewModel";
import { findingStatusVariant, severityVariant } from "./securityViewModel";

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      {children}
    </section>
  );
}

/**
 * One finding in full (specs/057 FR-054 to FR-059): what was expected against what was observed (a sentence, never a
 * response body), every occurrence with its time, its confidence and the basis of that confidence, the remediation, where
 * it came from (the scenario version, the run and the specification element), the finding it supersedes, its history,
 * and the controls to change its status or severity, which need a note. An occurrence whose raw evidence has gone with
 * its session says so. Occurrences are counted beside the finding and never added to a count of findings.
 */
export function FindingDetail({
  finding,
  categoryName,
  headingId,
  onChanged,
  onOpenScenario,
  onOpenRun,
  onOpenFinding,
}: Readonly<{
  finding: SecurityFinding;
  categoryName?: string;
  headingId: string;
  onChanged: (updated: SecurityFinding) => void;
  onOpenScenario: (scenarioId: string, version: number) => void;
  onOpenRun: (runId: string) => void;
  onOpenFinding: (id: string) => void;
}>) {
  const base = useId();
  const [status, setStatus] = useState<FindingStatus | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);

  const operation = splitOperationKey(finding.operationKey);
  const statusView = findingStatusVariant(finding.status);
  const severityView = severityVariant(finding.severity.current);
  const basis = expectedBasisView(finding.expected);
  const latest = finding.occurrences[finding.occurrences.length - 1];
  const change = checkFindingChange({ finding, status, severity, note });
  const resolved = resolvedAssertionText(finding);

  async function send(body: Parameters<typeof patchFinding>[1], reset: boolean) {
    setBusy(true);
    setError(null);
    const result = await patchFinding(finding.id, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (reset) {
      setStatus("");
      setSeverity("");
      setNote("");
    }
    onChanged(result.data);
  }

  return (
    <article className="space-y-4" aria-labelledby={headingId} data-testid="finding-detail">
      <header className="space-y-2">
        <h3 id={headingId} tabIndex={-1} className="text-lg font-semibold text-text-primary focus:outline-none">
          {findingTitle(finding, categoryName)}
        </h3>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          {operation.method && <HttpMethodBadge method={operation.method} />}
          <span className="break-all font-mono text-xs text-text-primary">{operation.path}</span>
          <span>{occurrenceText(finding.occurrenceCount)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label={`Severity: ${severityView.label}`} tone={severityView.tone} />
          <StatusBadge label={`Status: ${statusView.label}`} tone={statusView.tone} />
          {finding.unreviewedOccurrence && <StatusBadge label="Unreviewed occurrence" tone="warning" />}
        </div>
        <p className="text-sm text-text-secondary" data-testid="status-explanation">
          {STATUS_EXPLANATION[finding.status]}
          {finding.severity.current !== finding.severity.suggested && ` Suggested severity was ${severityVariant(finding.severity.suggested).label.toLowerCase()}; you changed it.`}
        </p>
        {resolved && (
          <p className="text-sm text-text-secondary" data-testid="resolved-assertion">
            {resolved}
          </p>
        )}
      </header>

      {finding.unreviewedOccurrence && (
        <Banner tone="warning" title="A new occurrence has not been reviewed" role="status" testId="unreviewed-banner">
          <span>This finding is marked {finding.status.replace("-", " ")}, and a new occurrence has arrived since. Review it, then acknowledge it.</span>
          <span className="mt-2 block">
            <button type="button" onClick={() => void send({ acknowledgeOccurrences: true }, false)} disabled={busy} className={BUTTON_STYLES.secondary}>
              Acknowledge the new occurrence
            </button>
          </span>
        </Banner>
      )}

      <Section title="Expected and observed">
        <dl className="grid gap-3 sm:grid-cols-2" data-testid="expected-observed">
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase text-muted">Expected</dt>
            <dd className="text-sm text-text-primary">{finding.expected.statement}</dd>
            <dd className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              <StatusBadge label={basis.label} tone={basis.tone} />
              <span>{basis.detail}</span>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase text-muted">Observed (latest occurrence)</dt>
            <dd className="text-sm text-text-primary">
              {latest ? (
                <>
                  {latest.observed.responseStatus !== undefined ? `Status ${latest.observed.responseStatus}. ` : ""}
                  {latest.observed.statement}
                  {latest.observed.truncated ? " (response truncated)" : ""}
                </>
              ) : (
                "No occurrence is recorded."
              )}
            </dd>
            <dd className="text-xs text-text-secondary">A bounded sentence about the response. The response body is not kept here.</dd>
          </div>
        </dl>
      </Section>

      <Section title={`Occurrences (${finding.occurrenceCount})`}>
        <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Occurrences of this finding">
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Each failed result of this scenario version, with time, confidence and the evidence behind it</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>When</th>
                <th scope="col" className={TABLE_STYLES.th}>Observed</th>
                <th scope="col" className={TABLE_STYLES.th}>Confidence</th>
                <th scope="col" className={TABLE_STYLES.th}>Run</th>
                <th scope="col" className={TABLE_STYLES.th}>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {finding.occurrences.map((occurrence) => (
                <tr key={occurrence.resultId} data-testid="occurrence-row">
                  <th scope="row" className={`${TABLE_STYLES.td} whitespace-nowrap text-left font-medium`}>{formatTimestamp(occurrence.at)}</th>
                  <td className={`${TABLE_STYLES.td} max-w-xs`}>
                    {occurrence.observed.responseStatus !== undefined ? `Status ${occurrence.observed.responseStatus}. ` : ""}
                    {occurrence.observed.statement}
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-xs`}>
                    <span className="block font-medium">{CONFIDENCE_LABEL[occurrence.confidence.level]}</span>
                    <span className="block text-xs text-text-secondary">{occurrence.confidence.basis}</span>
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <button type="button" onClick={() => onOpenRun(occurrence.runId)} aria-label={`Open the run of the occurrence at ${formatTimestamp(occurrence.at)}`} className={BUTTON_STYLES.secondary}>
                      Open run
                    </button>
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-xs`}>
                    {occurrence.evidenceAvailable === false ? (
                      <span className="text-xs text-text-secondary">Raw evidence is no longer available: the session that held it has ended.</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEvidenceFor(evidenceFor === occurrence.resultId ? null : occurrence.resultId)}
                        aria-expanded={evidenceFor === occurrence.resultId}
                        aria-label={`View the evidence of the occurrence at ${formatTimestamp(occurrence.at)}`}
                        className={BUTTON_STYLES.secondary}
                      >
                        {evidenceFor === occurrence.resultId ? "Hide evidence" : "View evidence"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evidenceFor && <EvidenceView key={evidenceFor} findingId={finding.id} resultId={evidenceFor} onClose={() => setEvidenceFor(null)} />}
      </Section>

      <Section title="Remediation">
        <p className="text-sm text-text-primary" data-testid="remediation">
          {finding.remediation}
        </p>
        <p className="text-xs text-text-secondary">
          Guidance from rule <span className="font-mono">{finding.remediationId}</span>. It is general advice for this kind of finding, not a statement about your code.
        </p>
      </Section>

      <Section title="Where it came from">
        <ul className="space-y-1 text-sm text-text-secondary">
          <li>
            Scenario version {finding.scenarioVersion}:{" "}
            <button type="button" onClick={() => onOpenScenario(finding.scenarioId, finding.scenarioVersion)} className={BUTTON_STYLES.ghost}>
              Open the scenario
            </button>
          </li>
          <li>
            Specification element: <span className="break-all font-mono text-xs text-text-primary">{finding.specElementPointer}</span>
          </li>
          {finding.taxonomy.length > 0 && (
            <li>
              Taxonomy:{" "}
              {finding.taxonomy.map((entry) => (
                <span key={`${entry.id}-${entry.relation}`} className="mr-1.5 rounded border border-border-strong px-1.5 py-0.5 font-mono text-xs">
                  {entry.id}
                  {entry.relation === "related" ? " (related)" : ""}
                </span>
              ))}
            </li>
          )}
          {finding.supersedes && (
            <li data-testid="supersedes">
              Supersedes the finding for an earlier version of this scenario:{" "}
              <button type="button" onClick={() => onOpenFinding(finding.supersedes as string)} className={BUTTON_STYLES.ghost}>
                Open the earlier finding
              </button>
            </li>
          )}
          <li>
            First failed {formatTimestamp(finding.firstFailedAt)}; latest {formatTimestamp(finding.latestFailedAt)}.
          </li>
        </ul>
      </Section>

      <Section title="Change status or severity">
        <form
          aria-label="Change status or severity"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (change.body && !busy) void send(change.body, true);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${base}-status`} className="text-xs font-medium text-text-secondary">
                New status (now {statusView.label.toLowerCase()})
              </label>
              <select id={`${base}-status`} value={status} onChange={(event) => setStatus(event.target.value as FindingStatus | "")} className={FIELD_STYLES}>
                <option value="">Keep the status</option>
                {statusTargets(finding.status).map((target) => (
                  <option key={target} value={target}>
                    {findingStatusVariant(target).label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${base}-severity`} className="text-xs font-medium text-text-secondary">
                New severity (now {severityView.label.toLowerCase()})
              </label>
              <select id={`${base}-severity`} value={severity} onChange={(event) => setSeverity(event.target.value as Severity | "")} className={FIELD_STYLES}>
                <option value="">Keep the severity</option>
                {SEVERITIES.filter((candidate) => candidate !== finding.severity.current).map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {severityVariant(candidate).label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${base}-note`} className="text-xs font-medium text-text-secondary">
              Note: why (required for a status or severity change, kept in the history)
            </label>
            <textarea id={`${base}-note`} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className={`${FIELD_STYLES} w-full`} />
          </div>
          {error && <ErrorState testId="finding-update-error" message="The change was not saved" detail={error} />}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !change.body} aria-describedby={change.body ? undefined : `${base}-needed`} className={BUTTON_STYLES.primary}>
              {busy ? "Saving..." : "Save change"}
            </button>
            {!change.body && (
              <span id={`${base}-needed`} className="text-xs text-text-secondary" data-testid="change-needed">
                {change.reasons.join(" ")}
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section title="History">
        {finding.history.length === 0 ? (
          <p className="text-sm text-text-secondary">No change has been made to this finding.</p>
        ) : (
          <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Finding history">
            <table className={TABLE_STYLES.table}>
              <caption className="sr-only">Every change to this finding, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col" className={TABLE_STYLES.th}>When</th>
                  <th scope="col" className={TABLE_STYLES.th}>What changed</th>
                  <th scope="col" className={TABLE_STYLES.th}>Note</th>
                  <th scope="col" className={TABLE_STYLES.th}>By</th>
                </tr>
              </thead>
              <tbody>
                {finding.history.map((entry, index) => (
                  <tr key={`${entry.at}-${index}`} data-testid="history-row">
                    <th scope="row" className={`${TABLE_STYLES.td} whitespace-nowrap text-left font-medium`}>{formatTimestamp(entry.at)}</th>
                    <td className={TABLE_STYLES.td}>
                      {entry.field}: {entry.from} to {entry.to}
                    </td>
                    <td className={`${TABLE_STYLES.td} max-w-md`}>{entry.note ?? ""}</td>
                    <td className={TABLE_STYLES.td}>{entry.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </article>
  );
}
