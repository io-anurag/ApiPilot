import { useState, type ReactNode } from "react";
import type { RetainedAssessmentSummary } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { deleteAllRetainedData, deleteAssessment, fetchRetainedData } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Card, CardHeader } from "../patterns/Card";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { PromptDialog } from "../PromptDialog";
import { Skeleton } from "../Skeleton";

/** What the browser's retention cookie means for retained work. Shown beside the data it governs. */
export const RETENTION_COOKIE_LIMITATION =
  "The browser's retention cookie is what links this browser to its retained work, so clearing cookies or using another browser or profile means this work can no longer be reached (it stays stored until deleted or the cap is reached).";

export const DELETE_ALL_PHRASE = "DELETE ALL";

type Pending = { kind: "assessment"; assessment: RetainedAssessmentSummary } | { kind: "all" };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Retained data (specs/057 FR-051, research R13): what is kept until the engineer deletes it, what goes when the session
 * ends, what each assessment holds, and how to delete it. Deleting is deliberate: it asks for the assessment's label (or
 * DELETE ALL) to be typed, and it is permanent. Whatever the server refuses (a wrong confirmation, an assessment that is
 * gone, a run in progress) is shown as the server's own message. It reads retained records, so it works with no
 * specification loaded.
 */
export function RetainedDataPanel({ onDeleted }: Readonly<{ onDeleted?: () => void }>) {
  const data = useSecurityResource((signal) => fetchRetainedData({ signal }));
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function confirm(value: string) {
    if (!pending) return;
    setPending(null);
    setBusy(true);
    setError(null);
    setDone(null);
    const result = pending.kind === "all" ? await deleteAllRetainedData(value) : await deleteAssessment(pending.assessment.assessmentKey, value);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(pending.kind === "all" ? "Everything retained for this browser was deleted." : `The retained work of “${pending.assessment.assessmentLabel}” was deleted.`);
    data.refresh();
    onDeleted?.();
  }

  let body: ReactNode;
  if (data.problem && !data.data) {
    body = (
      <ErrorState testId="retained-error" message="The retained data could not be read" detail={`${data.problem.message} This is not the same as nothing being retained.`}>
        <button type="button" onClick={data.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!data.data) {
    body = (
      <div role="status" aria-label="Reading the retained data">
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
      </div>
    );
  } else {
    const summary = data.data;
    body = (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label="Kept until you delete it" className="space-y-1">
            <h3 className="text-sm font-semibold text-text-primary">Kept until you delete it</h3>
            <ul className="list-disc pl-5 text-sm text-text-secondary" data-testid="retained-list">
              {summary.retained.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <section aria-label="Removed when the session ends" className="space-y-1">
            <h3 className="text-sm font-semibold text-text-primary">Removed when the session ends</h3>
            <ul className="list-disc pl-5 text-sm text-text-secondary" data-testid="removed-list">
              {summary.removedWithSession.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>

        <p className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm text-text-primary" data-testid="retention-cookie-limitation">
          {RETENTION_COOKIE_LIMITATION}
        </p>

        <p className="text-sm text-text-secondary" data-testid="retained-totals">
          Retained now: {plural(summary.totals.scenarios, "scenario", "scenarios")}, {plural(summary.totals.runs, "run", "runs")}, {plural(summary.totals.findings, "finding", "findings")}. Caps: up to{" "}
          {summary.caps.maxScenarios} scenarios and {summary.caps.maxRuns} runs; generating or running past a cap is refused until you delete something.
        </p>

        {summary.assessments.length === 0 ? (
          <EmptyState compact message="Nothing is retained for this browser." testId="retained-empty" />
        ) : (
          <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Retained assessments">
            <table className={TABLE_STYLES.table}>
              <caption className="sr-only">Retained assessments with the scenarios, runs and findings each holds</caption>
              <thead>
                <tr>
                  <th scope="col" className={TABLE_STYLES.th}>Assessment</th>
                  <th scope="col" className={TABLE_STYLES.th}>Scenarios</th>
                  <th scope="col" className={TABLE_STYLES.th}>Runs</th>
                  <th scope="col" className={TABLE_STYLES.th}>Findings</th>
                  <th scope="col" className={TABLE_STYLES.th}>Delete</th>
                </tr>
              </thead>
              <tbody>
                {summary.assessments.map((assessment) => (
                  <tr key={assessment.assessmentKey} data-testid="retained-row">
                    <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>{assessment.assessmentLabel}</th>
                    <td className={TABLE_STYLES.td}>{assessment.scenarios}</td>
                    <td className={TABLE_STYLES.td}>{assessment.runs}</td>
                    <td className={TABLE_STYLES.td}>{assessment.findings}</td>
                    <td className={TABLE_STYLES.td}>
                      <button type="button" onClick={() => setPending({ kind: "assessment", assessment })} disabled={busy} aria-label={`Delete the retained work of ${assessment.assessmentLabel}`} className={BUTTON_STYLES.danger}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <button type="button" onClick={() => setPending({ kind: "all" })} disabled={busy} className={BUTTON_STYLES.danger}>
            Delete everything retained for this browser
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card as="section" aria-labelledby="retained-heading" data-testid="retained-data-panel">
      <CardHeader title="Retained data" titleId="retained-heading" subtitle="What is kept, what goes with the session, and how to delete it." />
      <div className="space-y-3">
        {body}
        {error && <ErrorState testId="retained-delete-error" message="Nothing was deleted" detail={error} />}
        {done && (
          <p role="status" className="text-sm font-medium text-text-primary" data-testid="retained-done">
            {done}
          </p>
        )}
      </div>
      {pending && (
        <PromptDialog
          title={
            pending.kind === "all"
              ? `Delete everything retained for this browser: ${plural(data.data?.totals.scenarios ?? 0, "scenario", "scenarios")}, ${plural(data.data?.totals.runs ?? 0, "run", "runs")}, ${plural(data.data?.totals.findings ?? 0, "finding", "findings")}, and your profiles, credentials and evidence in this session. This cannot be undone. Type ${DELETE_ALL_PHRASE} to confirm.`
              : `Delete all retained work of “${pending.assessment.assessmentLabel}”: ${plural(pending.assessment.scenarios, "scenario", "scenarios")}, ${plural(pending.assessment.runs, "run", "runs")}, ${plural(pending.assessment.findings, "finding", "findings")}. This cannot be undone. Type the assessment label exactly to confirm: ${pending.assessment.assessmentLabel}`
          }
          label={pending.kind === "all" ? `Type ${DELETE_ALL_PHRASE}` : "Type the assessment label"}
          confirmLabel="Delete permanently"
          onConfirm={(value) => void confirm(value)}
          onCancel={() => setPending(null)}
        />
      )}
    </Card>
  );
}
