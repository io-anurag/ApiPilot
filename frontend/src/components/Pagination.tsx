import { BUTTON_STYLES } from "./controlStyles";

/** Number of pages for `total` items; an empty list still has one (empty) page. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Page navigation with a page-size selector, for long lists. `page` is 1-based. The parent owns the
 * state and slices its own data; this component only renders the controls, so the same selection
 * model (for example "Select all" over every item) is not tied to what is on screen.
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  noun = "items",
  testId = "pagination",
}: Readonly<{
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  noun?: string;
  testId?: string;
}>) {
  const pages = pageCount(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const selectId = `${testId}-page-size`;

  return (
    <nav
      aria-label={`${noun} pagination`}
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-text-secondary"
    >
      <p className="text-muted" aria-live="polite">
        Showing {first}–{last} of {total} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-xs font-medium text-muted">
          Per page
        </label>
        <select
          id={selectId}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="First page"
          className={BUTTON_STYLES.secondary}
        >
          «
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={BUTTON_STYLES.secondary}
        >
          Previous
        </button>
        <span className="px-1 font-medium text-text-primary">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className={BUTTON_STYLES.secondary}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pages)}
          disabled={page >= pages}
          aria-label="Last page"
          className={BUTTON_STYLES.secondary}
        >
          »
        </button>
      </div>
    </nav>
  );
}
