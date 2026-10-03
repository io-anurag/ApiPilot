import type { SeedingReport, SeedingReportItemKind } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";

const KIND_LABELS: Record<SeedingReportItemKind, string> = {
  "pre-request-script": "Pre-request scripts not carried over",
  "unrecognised-statement": "Test script statements not carried over",
  "unsupported-dynamic-variable": "Dynamic variables not supported",
  "left-out-request": "Requests left out",
  "no-positive-scenario": "Operations with no positive scenario",
  "workflow-fallback": "Workflows seeded as single steps",
  "basic-auth-encoded-value": "Basic auth values to provide",
  "literal-credential-moved": "Literal credentials moved to the environment",
  "literal-credential-dropped": "Literal credentials not kept",
};

/**
 * What seeding could not carry over, grouped by kind, each with its source (FR-025). It never gates
 * the script; it stays here for as long as the plan exists.
 */
export function SeedingReportView({ report, onGoToStep }: Readonly<{ report: SeedingReport; onGoToStep: (stepId: string) => void }>) {
  const groups = (Object.keys(KIND_LABELS) as SeedingReportItemKind[])
    .map((kind) => ({ kind, items: report.items.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0);
  return (
    <section aria-labelledby="seeding-report-title" className="space-y-3 rounded-lg border border-border bg-surface p-4" data-testid="seeding-report">
      <h3 id="seeding-report-title" className="text-sm font-semibold">
        Seeding report
      </h3>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">Everything was carried over.</p>
      ) : (
        groups.map((group) => (
          <details key={group.kind} open>
            <summary className="cursor-pointer text-sm font-medium">
              {KIND_LABELS[group.kind]} ({group.items.length})
            </summary>
            <ul className="mt-2 space-y-1 pl-4 text-sm">
              {group.items.map((item, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{item.sourceLabel}</span>
                  <span className="text-muted">{item.detail}</span>
                  {item.stepId && (
                    <button type="button" className={BUTTON_STYLES.ghost} onClick={() => onGoToStep(item.stepId!)}>
                      Go to step
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
      <p className="text-xs text-muted">The seeding report never blocks the script. The plan is never re-derived from its source.</p>
    </section>
  );
}
