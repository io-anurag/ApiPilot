import { useState } from "react";
import type { Environment } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";
import { EnvironmentForm } from "../EnvironmentForm";
import { StatusBadge } from "../StatusBadge";
import { TIER_TONE } from "./performanceViewModel";

/**
 * Chooses the run's target environment and opens the environment form to add one or to edit the
 * chosen one's values (AP-029 FR-013, FR-025). The tier is always shown as text.
 */
export function EnvironmentPicker({
  environments,
  selectedId,
  suggestedNames,
  onSelect,
  onSaved,
}: Readonly<{
  environments: Environment[];
  selectedId: string | null;
  suggestedNames: readonly string[];
  onSelect: (environmentId: string) => void;
  onSaved: (environment: Environment) => void;
}>) {
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const selected = environments.find((environment) => environment.id === selectedId) ?? null;

  return (
    <div className="space-y-2">
      {environments.length === 0 ? (
        <p className="text-sm text-muted">No environment yet. Add one to hold the values a run needs.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="performance-environment" className="sr-only">
            Target environment
          </label>
          <select
            id="performance-environment"
            value={selectedId ?? ""}
            onChange={(event) => onSelect(event.target.value)}
            className="min-w-48 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name} ({environment.tier})
              </option>
            ))}
          </select>
          {selected && <StatusBadge label={`Tier: ${selected.tier}`} tone={TIER_TONE[selected.tier]} />}
        </div>
      )}
      {selected && <p className="break-all font-mono text-xs text-muted">{selected.baseUrl}</p>}
      <div className="flex flex-wrap gap-3">
        {selected && (
          <button type="button" className={BUTTON_STYLES.secondary} onClick={() => setEditing("edit")}>
            Edit values in {selected.name}
          </button>
        )}
        <button type="button" className={BUTTON_STYLES.ghost} onClick={() => setEditing("new")}>
          New environment
        </button>
      </div>
      {editing && (
        <Dialog labelledBy="environment-dialog-title" panelClassName="w-full max-w-2xl space-y-3 rounded-lg border border-border bg-surface p-5 shadow-xl" onClose={() => setEditing(null)}>
          <h3 id="environment-dialog-title" className="text-base font-semibold">
            {editing === "edit" && selected ? `Edit ${selected.name}` : "New environment"}
          </h3>
          <EnvironmentForm
            initial={editing === "edit" ? (selected ?? undefined) : undefined}
            suggestedNames={suggestedNames}
            onSaved={(environment) => {
              setEditing(null);
              onSaved(environment);
            }}
            onCancel={() => setEditing(null)}
          />
        </Dialog>
      )}
    </div>
  );
}
