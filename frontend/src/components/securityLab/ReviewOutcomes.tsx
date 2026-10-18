import type { ReviewItemOutcome, SecurityReviewAction } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { REFUSAL_LABEL, outcomeSummary } from "./scenarioViewModel";
import { reviewStateVariant } from "./securityViewModel";

/** What one review request did, kept so the outcome stays on screen until the engineer dismisses it. */
export interface ReviewReport {
  readonly action: SecurityReviewAction;
  readonly applied: readonly ReviewItemOutcome[];
  readonly refused: readonly ReviewItemOutcome[];
  /** Scenario titles by id, so an outcome names the scenario rather than only an identifier. */
  readonly titles: Readonly<Record<string, string>>;
}

/** The most rows of one kind shown, so a very large batch does not build a very large table. The summary always counts every item. */
const MAX_ROWS = 200;

function OutcomeRows({ outcomes, titles, kind }: Readonly<{ outcomes: readonly ReviewItemOutcome[]; titles: ReviewReport["titles"]; kind: "applied" | "refused" }>) {
  const shown = outcomes.slice(0, MAX_ROWS);
  return (
    <div className="space-y-1">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label={kind === "applied" ? "Scenarios the action was applied to" : "Scenarios the action was refused for"}>
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">{kind === "applied" ? "Applied" : "Refused"} scenarios</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
              <th scope="col" className={TABLE_STYLES.th}>Result</th>
              <th scope="col" className={TABLE_STYLES.th}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((outcome) => (
              <tr key={`${outcome.id}-${outcome.version}`} data-testid="review-outcome-row" data-result={kind}>
                <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                  {titles[outcome.id] ?? outcome.id}
                </th>
                <td className={TABLE_STYLES.td}>
                  {kind === "applied" ? (
                    <StatusBadge label="Applied" tone="success" />
                  ) : (
                    <StatusBadge label={outcome.reasonCode ? `Refused: ${REFUSAL_LABEL[outcome.reasonCode]}` : "Refused"} tone="danger" />
                  )}
                </td>
                <td className={TABLE_STYLES.td}>
                  {kind === "applied"
                    ? outcome.reviewState
                      ? `Now ${reviewStateVariant(outcome.reviewState).label.toLowerCase()}.`
                      : "Applied."
                    : (outcome.message ?? "The server gave no reason.")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {outcomes.length > MAX_ROWS && <p className="text-xs text-text-secondary">Showing the first {MAX_ROWS} of {outcomes.length}.</p>}
    </div>
  );
}

/**
 * The per-item outcome of a review request (specs/057 FR-031, contracts "Per-item outcomes are returned and shown;
 * a partial application is never reported as complete"). The summary is a status message, so a screen reader hears
 * it; each item is then listed with its result as text, and every refused item shows the server's reason.
 */
export function ReviewOutcomes({ report, onDismiss }: Readonly<{ report: ReviewReport; onDismiss: () => void }>) {
  const { action, applied, refused, titles } = report;
  return (
    <section aria-label="Review outcome" data-testid="review-outcomes" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm font-medium text-text-primary" data-testid="review-outcome-summary">
          {outcomeSummary(action, applied.length, refused.length)}
        </p>
        <button type="button" onClick={onDismiss} className={BUTTON_STYLES.secondary}>
          Dismiss outcome
        </button>
      </div>
      {refused.length > 0 && <OutcomeRows outcomes={refused} titles={titles} kind="refused" />}
      {applied.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Applied to {applied.length} {applied.length === 1 ? "scenario" : "scenarios"}
          </summary>
          <div className="mt-2">
            <OutcomeRows outcomes={applied} titles={titles} kind="applied" />
          </div>
        </details>
      )}
    </section>
  );
}
