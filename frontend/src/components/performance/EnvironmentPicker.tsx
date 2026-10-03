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
  // The Name field as typed, so the dialog title follows it before the environment is saved.
  const [draftName, setDraftName] = useState("");
  const selected =
    environments.find((environment) => environment.id === selectedId) ?? null;
  const draft = draftName.trim();
  let dialogTitle = draft ? `New environment: ${draft}` : "New environment";
  if (editing === "edit" && selected) dialogTitle = `Edit ${draft || selected.name}`;

  function openDialog(mode: "new" | "edit") {
    setDraftName(mode === "edit" && selected ? selected.name : "");
    setEditing(mode);
  }

  return (
    <div className="space-y-2">
      {environments.length === 0 ? (
        <p className="text-sm text-muted">
          No environment yet. Add one to hold the values a run needs.
        </p>
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
            {/* Without this, the browser shows the first environment as chosen when none is. */}
            {!selected && (
              <option value="" disabled>
                Choose an environment
              </option>
            )}
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name} ({environment.tier})
              </option>
            ))}
          </select>
          {selected && (
            <StatusBadge
              label={`Tier: ${selected.tier}`}
              tone={TIER_TONE[selected.tier]}
            />
          )}
        </div>
      )}
      {selected && (
        <p className="break-all font-mono text-xs text-muted">{selected.baseUrl}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {selected && (
          <button
            type="button"
            className={BUTTON_STYLES.secondary}
            onClick={() => openDialog("edit")}
          >
            Edit values in {selected.name}
          </button>
        )}
        <button
          type="button"
          className={BUTTON_STYLES.ghost}
          onClick={() => openDialog("new")}
        >
          New environment
        </button>
      </div>
      {editing && (
        // The panel is a column capped at the window height: the title and the Save/Cancel row
        // stay in view while only the form body between them scrolls.
        <Dialog
          labelledBy="environment-dialog-title"
          panelClassName="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl"
          onClose={() => setEditing(null)}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3
              id="environment-dialog-title"
              title={dialogTitle}
              className="min-w-0 truncate text-base font-semibold"
            >
              {dialogTitle}
            </h3>
            <button
              type="button"
              aria-label="Close environment dialog"
              onClick={() => setEditing(null)}
              className="shrink-0 rounded p-1 text-lg leading-none text-muted hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-slate-100"
            >
              ×
            </button>
          </div>
          <EnvironmentForm
            initial={editing === "edit" ? (selected ?? undefined) : undefined}
            suggestedNames={suggestedNames}
            onNameChange={setDraftName}
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
