import type { Prerequisite } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { prerequisiteVariant, summarizePrerequisites } from "./scenarioViewModel";

/**
 * What a scenario needs before it can run, and exactly what is missing (specs/057 FR-019, FR-029). Each prerequisite
 * shows its state as text (Met, Missing, Not supported, Not evaluated) with the reason the profile gave, and the
 * summary names every unmet one, so a blocked scenario never says only "blocked". Prerequisites are judged against
 * the selected profile; with none selected, none is met, and the panel says so.
 */
export function PrerequisitePanel({
  prerequisites,
  requiredIdentities,
}: Readonly<{ prerequisites: readonly Prerequisite[]; requiredIdentities: ReadonlyArray<{ role: string; label: string }> }>) {
  const summary = summarizePrerequisites(prerequisites);
  return (
    <div className="space-y-2" data-testid="prerequisite-panel">
      {summary.total === 0 ? (
        <p className="text-sm text-text-secondary">This scenario has no prerequisites.</p>
      ) : (
        <>
          <p className="text-sm text-text-primary" data-testid="prerequisite-summary">
            {summary.met} of {summary.total} prerequisites met.
            {summary.unmet.length > 0 && (
              <>
                {" "}
                Missing: {summary.unmet.map((prerequisite) => prerequisite.description).join("; ")}.
              </>
            )}
          </p>
          <ul className="space-y-1.5">
            {prerequisites.map((prerequisite) => {
              const variant = prerequisiteVariant(prerequisite);
              return (
                <li key={prerequisite.id} className="flex flex-wrap items-baseline gap-2 text-sm" data-testid="prerequisite-item">
                  <StatusBadge label={variant.label} tone={variant.tone} />
                  <span className="text-text-primary">{prerequisite.description}</span>
                  <span className="text-xs text-text-secondary">({prerequisite.kind})</span>
                  {prerequisite.detail && <span className="text-xs text-text-secondary">{prerequisite.detail}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {requiredIdentities.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase text-muted">Identities this scenario needs</p>
          <ul className="list-disc pl-5 text-sm text-text-secondary">
            {requiredIdentities.map((identity) => (
              <li key={`${identity.role}-${identity.label}`}>
                {identity.label} (role: {identity.role})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
