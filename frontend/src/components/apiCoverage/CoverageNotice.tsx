import type { CoverageNotice as Notice } from "@apipilot/shared-domain";
import { Card, CardHeader } from "../patterns/Card";

const WARNING_TONE = "flex items-start gap-3 rounded-xl border border-warning-600/30 bg-warning-100 px-3.5 py-3 text-text-primary dark:bg-warning-500/10";

const WARNING_LEAD = "Attention";

/**
 * The evidence notice and every specific explanation of stale, incomplete or unavailable data
 * (FR-020), gathered in one card: most are standing explanations, so they read as reference text
 * rather than as a stack of alerts. A warning keeps its own highlighted row in the pattern set's
 * warning-banner anatomy, and every notice leads with a word and a mark, so severity is never carried
 * by colour alone.
 */
export function CoverageNotices({ notices }: Readonly<{ notices: readonly Notice[] }>) {
  if (notices.length === 0) return null;
  const warnings = notices.filter((notice) => notice.severity === "warning");
  const notes = notices.filter((notice) => notice.severity === "info");
  return (
    <Card as="section" aria-labelledby="coverage-notices-title">
      <CardHeader title="About these figures" titleId="coverage-notices-title" level={3} />
      <div data-testid="coverage-notices" className="space-y-3 text-sm text-text-secondary">
        {warnings.length > 0 && (
          <ul aria-label="Coverage warnings" className="space-y-2">
            {warnings.map((notice) => (
              <li key={notice.code} data-notice={notice.code} className={WARNING_TONE}>
                <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-warning-700 font-mono text-xs font-bold text-warning-700 dark:border-warning-100 dark:text-warning-100">
                  !
                </span>
                <span className="min-w-0">
                  <strong className="font-semibold">{WARNING_LEAD}: </strong>
                  {notice.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <div className="rounded-xl bg-surface-subtle px-3.5 py-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Notes</h4>
            <ul aria-label="Coverage notes" className="mt-1 list-disc space-y-1 pl-4">
              {notes.map((notice) => (
                <li key={notice.code} data-notice={notice.code}>
                  {notice.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
