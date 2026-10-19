import type { ReactNode } from "react";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchFindingEvidence } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { CodeBlock } from "../CodeBlock";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { evidenceRecordText } from "./findingViewModel";

/**
 * The redacted evidence behind one occurrence (specs/057 FR-048 to FR-050, FR-057): each request that was sent and the
 * response, laid out as text in scrolling code blocks. Secrets were redacted before they were stored. The evidence is
 * session data, so once the session that held it has ended it says so plainly and the retained observed summary of the
 * occurrence is what remains; an unreadable evidence list is an error, never "no evidence".
 */
export function EvidenceView({ findingId, resultId, onClose }: Readonly<{ findingId: string; resultId: string; onClose: () => void }>) {
  const evidence = useSecurityResource((signal) => fetchFindingEvidence(findingId, resultId, { signal }), [findingId, resultId]);

  let body: ReactNode;
  if (evidence.problem && !evidence.data) {
    body = (
      <ErrorState testId="evidence-error" message="The evidence could not be read" detail={`${evidence.problem.message} This is not the same as no evidence.`}>
        <button type="button" onClick={evidence.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!evidence.data) {
    body = (
      <div role="status" aria-label="Loading the evidence">
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
      </div>
    );
  } else if (!evidence.data.available) {
    body = (
      <p className="text-sm text-text-secondary" data-testid="evidence-unavailable">
        Raw evidence is no longer available: the session that held it has ended. The observed summary of this occurrence is kept.
      </p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-xs text-text-secondary">Secrets in these requests and responses were redacted before they were stored.</p>
        {evidence.data.records.map((record) => (
          <CodeBlock key={record.index} label={`Request ${record.index + 1} of ${evidence.data?.records.length}: ${record.method} ${record.urlRedacted}`} content={evidenceRecordText(record)} />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Evidence" data-testid="evidence-view" className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-text-primary">Evidence for this occurrence</h4>
        <button type="button" onClick={onClose} className={BUTTON_STYLES.secondary}>
          Close evidence
        </button>
      </div>
      {body}
    </section>
  );
}
