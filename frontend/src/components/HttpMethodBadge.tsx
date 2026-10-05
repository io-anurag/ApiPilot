const METHOD_CLASSES: Record<string, string> = {
  GET: "bg-info-100 text-info-700 dark:bg-info-500/15 dark:text-info-100",
  POST: "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  PUT: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  PATCH: "bg-chart-4/15 text-chart-4",
  DELETE: "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100",
};
const DEFAULT_METHOD_CLASSES = "bg-surface-strong text-text-secondary";

/**
 * Single source of truth for HTTP-method visual treatment (FR-001, FR-002; post-/speckit-analyze
 * finding U1), imported by OperationList, OperationDetail, and TestScenarioReviewList instead of
 * each file re-implementing its own method styling.
 */
export function HttpMethodBadge({ method }: { method: string }) {
  const normalized = method.toUpperCase();
  return (
    <span
      data-testid="http-method-badge"
      data-method={normalized}
      aria-label={`HTTP method ${normalized}`}
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${METHOD_CLASSES[normalized] ?? DEFAULT_METHOD_CLASSES}`}
    >
      {normalized}
    </span>
  );
}
