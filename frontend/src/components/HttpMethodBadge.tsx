import { DEFAULT_METHOD_BADGE_CLASSES, METHOD_BADGE_CLASSES } from "./httpMethodStyles";

/** Solid method colours and their label colours live in httpMethodStyles.ts. */

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
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs font-bold ring-1 ring-inset ring-text-primary/15 ${METHOD_BADGE_CLASSES[normalized] ?? DEFAULT_METHOD_BADGE_CLASSES}`}
    >
      {normalized}
    </span>
  );
}
