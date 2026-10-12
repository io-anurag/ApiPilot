import { ENTRY_CONTROL } from "../controlStyles";
import { entryPercentage, type CoverageEntryFigure, type CoverageEntryState } from "./coverageViewModel";

const NEEDS_SPEC = "Needs a specification from the Guided Workflow.";

function Figure({
  label,
  figure,
  barClassName,
  note,
}: Readonly<{ label: string; figure: CoverageEntryFigure | null; barClassName: string; note?: string }>) {
  return (
    <div className="min-w-32">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold text-text-primary">{entryPercentage(figure)}</dd>
      <dd className="text-xs text-muted">
        {note ?? (figure ? `${figure.numerator} of ${figure.denominator} operations` : "no eligible operations")}
      </dd>
      {figure?.percentage != null && (
        <dd>
          <div
            role="img"
            aria-label={`${label}: ${figure.numerator} of ${figure.denominator}`}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong"
          >
            {/* The width is a genuinely dynamic value (the metric's percentage). */}
            <span className={`block h-full ${barClassName}`} style={{ width: `${figure.percentage}%` }} />
          </div>
        </dd>
      )}
    </div>
  );
}

/**
 * The "Results" entry to API Test Coverage on the start screen (`strip`) and beside the run flow in
 * Import & Run Collection (`panel`), or inside the Run step's launch card (`inline`, the panel's
 * content without its own frame). One primary action at most; with no specification the button is
 * disabled and the reason is text, not a dead control (AP-046 placement mock).
 */
export function CoverageEntryCard({
  entry,
  onOpen,
  variant,
}: Readonly<{ entry: CoverageEntryState; onOpen: () => void; variant: "strip" | "panel" | "inline" }>) {
  const panel = variant !== "strip";
  const ready = entry.status === "ready" ? entry : null;
  const reasonId = `coverage-entry-${variant}-reason`;
  const disabled = entry.status === "no-spec" || entry.status === "loading";

  let reason: string | null = null;
  if (entry.status === "no-spec") reason = NEEDS_SPEC;
  else if (entry.status === "error") reason = `Coverage is unavailable: ${entry.message}`;

  const intro = panel
    ? "Runs that pass their checks become runtime-verified coverage."
    : "See how much of the API your generated tests cover and how much real runs have verified.";

  return (
    <section
      aria-labelledby={`coverage-entry-${variant}-title`}
      data-testid={`coverage-entry-${variant}`}
      className={
        variant === "inline"
          ? "border-l-4 border-l-section-results pl-3"
          : `rounded-xl border border-l-4 border-border-strong border-l-section-results bg-surface-elevated shadow-sm ${panel ? "px-4 py-3" : "p-5"}`
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-3xl space-y-1">
          {!panel && (
            <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase text-muted">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm bg-section-results" />
              {ready ? `Results · ${ready.specification}` : "Results"}
            </p>
          )}
          <h2
            id={`coverage-entry-${variant}-title`}
            className={`font-display font-semibold tracking-tight text-text-primary ${panel ? "text-base" : "text-lg"}`}
          >
            {panel ? "Feeds API Test Coverage" : "API Test Coverage"}
          </h2>
          <p className={`text-muted ${panel ? "text-xs leading-5" : "text-sm leading-6"}`}>{intro}</p>
          {ready && (
            <dl className={`flex flex-wrap gap-x-8 gap-y-3 ${panel ? "pt-1" : "pt-2"}`}>
              {!panel && <Figure label="Specification coverage" figure={ready.specOperations} barClassName="bg-info-600" />}
              <Figure
                label={panel ? "Verified now" : "Runtime-verified"}
                figure={ready.runtimeOperations}
                barClassName="bg-success-600"
                note={ready.hasRun ? undefined : "No run yet"}
              />
              {!panel && (
                <div className="min-w-32">
                  <dt className="text-xs font-semibold uppercase text-muted">Open gaps</dt>
                  <dd className="font-mono text-xl font-semibold text-text-primary">{ready.gaps}</dd>
                  <dd className="text-xs text-muted">{ready.highPriorityGaps} high priority</dd>
                </div>
              )}
            </dl>
          )}
          {entry.status === "loading" && (
            <p role="status" className="pt-1 text-xs text-muted">
              Checking coverage…
            </p>
          )}
          {reason && (
            <p id={reasonId} className={`pt-0.5 text-text-secondary ${panel ? "text-xs" : "text-sm"}`}>
              {reason}
            </p>
          )}
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            aria-describedby={reason ? reasonId : undefined}
            className={`${ENTRY_CONTROL} px-3 py-1.5`}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm bg-section-results" />
            {panel ? "View coverage" : "Open Coverage"}
          </button>
        </div>
      </div>
    </section>
  );
}
