/**
 * The table of the pattern set (AP-054 FR-014, FR-017): a semantic `<table>` whose header row is
 * tinted mint, inside a scroll container that belongs to the card, so a wide table scrolls inside
 * its card and never the page. Pair it with `Pagination` for the pager.
 */
export const TABLE_STYLES = {
  /** The scroll container: wraps the `<table>`; focusable so keyboard users can scroll it. */
  scroll: "overflow-x-auto rounded-xl",
  table: "w-full min-w-xl border-collapse text-sm",
  /** The header row's cells. */
  th: "whitespace-nowrap bg-mint px-3.5 py-2.5 text-left text-xs font-medium text-text-secondary first:rounded-l-lg last:rounded-r-lg",
  td: "border-b border-border px-3.5 py-3 align-middle text-text-primary",
  /** Monospace cell for API paths, ids and values. */
  tdMono: "border-b border-border px-3.5 py-3 align-middle font-mono text-xs text-text-primary",
} as const;
