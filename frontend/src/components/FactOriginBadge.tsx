import type { FactConfidence, FactOrigin } from "@apipilot/shared-domain";

const LABELS: Record<FactOrigin, string> = {
  documented: "Documented",
  declared: "Declared",
  observed: "Observed",
  inferred: "Inferred",
};

const MEANINGS: Record<FactOrigin, string> = {
  documented: "Stated by the OpenAPI specification",
  declared: "Stated by the API definition you supplied",
  observed: "Seen in the capture; not a guarantee of the API's behaviour",
  inferred: "Derived by ApiPilot from what the capture showed",
};

const TONES: Record<FactOrigin, string> = {
  documented: "border-border-strong text-text-secondary",
  declared: "border-brand-500/50 text-brand-700 dark:text-brand-300",
  observed: "border-info-400 text-info-700 dark:text-info-100",
  inferred: "border-warning-300 text-warning-700 dark:border-warning-500 dark:text-warning-100",
};

/**
 * Where a fact comes from (specs/056 FR-043): documented in a specification, declared in an API
 * definition, observed in a capture, or inferred by ApiPilot. The origin is always text, with the
 * number of observations behind an observed or inferred fact and a confidence word; colour is only a
 * secondary cue (CLAUDE.md section 38).
 */
export function FactOriginBadge({
  origin,
  observationCount,
  confidence,
}: Readonly<{ origin: FactOrigin; observationCount?: number; confidence?: FactConfidence }>) {
  const counted = (origin === "observed" || origin === "inferred") && observationCount !== undefined;
  const label = counted ? `${LABELS[origin]} ×${observationCount}` : LABELS[origin];
  const spoken = counted
    ? `${LABELS[origin]}, ${observationCount} observation${observationCount === 1 ? "" : "s"}${confidence ? `, ${confidence} confidence` : ""}`
    : LABELS[origin];
  return (
    <span
      data-testid="fact-origin-badge"
      data-origin={origin}
      title={MEANINGS[origin]}
      aria-label={spoken}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${TONES[origin]}`}
    >
      <span aria-hidden="true">{label}</span>
      {counted && confidence && (
        <span aria-hidden="true" className="font-normal text-muted">
          · {confidence}
        </span>
      )}
    </span>
  );
}
