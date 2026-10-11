import type { CoverageNotice as Notice } from "@apipilot/shared-domain";

const WARNING_TONE =
  "rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100";

const WARNING_LEAD = "Attention";

/**
 * The evidence notice and every specific explanation of stale, incomplete or unavailable data
 * (FR-020), gathered in one panel: most are standing explanations, so they read as reference text
 * rather than as a stack of alerts. A warning keeps its own highlighted row, and every notice
 * leads with a word, so severity is never carried by colour alone.
 */
export function CoverageNotices({ notices }: Readonly<{ notices: readonly Notice[] }>) {
  if (notices.length === 0) return null;
  const warnings = notices.filter((notice) => notice.severity === "warning");
  const notes = notices.filter((notice) => notice.severity === "info");
  return (
    <section aria-labelledby="coverage-notices-title" className="rounded-lg border border-border bg-surface p-4">
      <h3 id="coverage-notices-title" className="mb-2 text-sm font-semibold text-text-primary">
        About these figures
      </h3>
      <div data-testid="coverage-notices" className="space-y-3 text-sm text-text-secondary">
        {warnings.length > 0 && (
          <ul aria-label="Coverage warnings" className="space-y-1.5">
            {warnings.map((notice) => (
              <li key={notice.code} data-notice={notice.code} className={WARNING_TONE}>
                <strong className="font-semibold">{WARNING_LEAD}: </strong>
                {notice.message}
              </li>
            ))}
          </ul>
        )}
        {notes.length > 0 && (
          <div className="rounded-md border border-border bg-surface-subtle px-3 py-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</h4>
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
    </section>
  );
}
