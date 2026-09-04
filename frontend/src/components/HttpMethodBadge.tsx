const METHOD_CLASSES: Record<string, string> = {
  GET: "bg-info-100 text-info-700",
  POST: "bg-success-100 text-success-700",
  PUT: "bg-warning-100 text-warning-700",
  PATCH: "bg-brand-100 text-brand-700",
  DELETE: "bg-danger-100 text-danger-700",
};
const DEFAULT_METHOD_CLASSES = "bg-slate-100 text-slate-700";

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
