/**
 * Shared loading-placeholder primitive (spec 027 FR-006). Scope is content-panel loading only —
 * not a button's own busy state, which stays a disabled button + label change (research.md D7).
 * Uses Tailwind's `animate-pulse`, whose animation duration is already neutralized under
 * `prefers-reduced-motion` by the global rule in `index.css` (FR-015), so no extra handling is
 * needed here.
 */
export function Skeleton({
  className = "h-4 w-full rounded bg-slate-200 dark:bg-slate-600",
}: Readonly<{ className?: string }>) {
  return (
    <span aria-hidden="true" data-testid="skeleton" className={`inline-block animate-pulse ${className}`} />
  );
}
