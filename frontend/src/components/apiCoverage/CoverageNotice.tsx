import type { CoverageNotice as Notice } from "@apipilot/shared-domain";

const TONE = {
  info: "border-info-100 bg-info-50 text-info-700 dark:border-info-500 dark:bg-info-500/10 dark:text-info-100",
  warning:
    "border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100",
} as const;

const LEAD = { info: "Note", warning: "Attention" } as const;

/**
 * The evidence notice and every specific explanation of stale, incomplete or unavailable data
 * (FR-020). Each notice leads with a word, so severity is never carried by colour alone.
 */
export function CoverageNotices({ notices }: Readonly<{ notices: readonly Notice[] }>) {
  if (notices.length === 0) return null;
  return (
    <ul data-testid="coverage-notices" className="space-y-2" aria-label="Coverage notices">
      {notices.map((notice) => (
        <li
          key={notice.code}
          data-notice={notice.code}
          className={`rounded-md border px-3 py-2 text-sm ${TONE[notice.severity]}`}
        >
          <strong className="font-semibold">{LEAD[notice.severity]}: </strong>
          {notice.message}
        </li>
      ))}
    </ul>
  );
}
