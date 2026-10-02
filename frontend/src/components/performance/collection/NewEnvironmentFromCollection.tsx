import { useId, useState } from "react";
import { createEnvironmentFromCollection } from "../../../services/collectionPerformanceClient";
import { BUTTON_STYLES } from "../../controlStyles";
import { ErrorState } from "../../ErrorState";

/**
 * AP-036 FR-017 (specs/036-collection-performance-test research R17): "New environment from this
 * collection" creates a target environment holding the values the plan needs, as the collection
 * resolves them. The values are copied on the server; this control never sees one, and the values
 * checklist then shows each as present or missing.
 */
const REFUSALS: Record<string, string> = {
  duplicate_environment_name: "An environment with this name already exists. Choose another name.",
  base_url_missing: "The collection gives its base URL variable no value, so an environment cannot be created from it.",
  collection_deleted: "The collection this plan was built from was deleted.",
};

export function NewEnvironmentFromCollection({ collectionName, onCreated }: Readonly<{ collectionName: string; onCreated: (environmentId: string) => void }>) {
  const id = useId();
  const [name, setName] = useState(`perf from ${collectionName}`.slice(0, 100));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <form
      aria-label="New environment from this collection"
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || name.trim() === "") return;
        setBusy(true);
        setProblem(null);
        void createEnvironmentFromCollection(name.trim()).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setProblem(REFUSALS[result.error] ?? result.message);
            return;
          }
          onCreated(result.environment.id);
        });
      }}
    >
      <p className="text-sm">Create a target environment with the base URL and values {collectionName} already has. The values are copied without being shown.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${id}-name`} className="flex flex-col gap-1 text-xs font-medium text-muted">
          Environment name
          <input
            id={`${id}-name`}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            className="w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <button type="submit" className={BUTTON_STYLES.secondary} disabled={busy || name.trim() === ""}>
          {busy ? "Creating…" : "New environment from this collection"}
        </button>
      </div>
      {problem && <ErrorState message={problem} testId="new-environment-from-collection-error" />}
    </form>
  );
}
