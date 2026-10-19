import type { ScenarioDerivedFlags } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { flagViews } from "./scenarioViewModel";

const ALL_FLAGS: ScenarioDerivedFlags = { specificationNotLoaded: true, orphaned: true, stale: true, blocked: true, executable: true };

/** The derived flags that are set, as text badges. The explanation is the badge's tooltip; the legend and the detail spell it out. */
export function FlagBadges({ flags }: Readonly<{ flags: ScenarioDerivedFlags }>) {
  const views = flagViews(flags);
  if (views.length === 0) return <span className="text-xs text-text-secondary">None</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Flags">
      {views.map((view) => (
        <li key={view.key}>
          <StatusBadge label={view.label} tone={view.tone} title={view.explanation} />
        </li>
      ))}
    </ul>
  );
}

/** What each flag means, in words, so no flag is understood only through its badge or its colour. */
export function FlagLegend() {
  return (
    <details className="text-sm text-text-secondary" data-testid="flag-legend">
      <summary className="cursor-pointer font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        What the flags mean
      </summary>
      <dl className="mt-2 space-y-1">
        {flagViews(ALL_FLAGS).map((view) => (
          <div key={view.key}>
            <dt className="inline font-medium text-text-primary">{view.label}: </dt>
            <dd className="inline">{view.explanation}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The set flags with their explanations in full, for a scenario's detail. */
export function FlagExplanations({ flags }: Readonly<{ flags: ScenarioDerivedFlags }>) {
  const views = flagViews(flags);
  if (views.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Why this scenario is flagged">
      {views.map((view) => (
        <li key={view.key} className="flex flex-wrap items-baseline gap-2 text-sm text-text-secondary">
          <StatusBadge label={view.label} tone={view.tone} />
          <span>{view.explanation}</span>
        </li>
      ))}
    </ul>
  );
}
