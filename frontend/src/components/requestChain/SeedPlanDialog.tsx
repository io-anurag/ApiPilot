import { useId, useState } from "react";
import { seedPlan, type SeedSourceInput } from "../../services/requestChainClient";
import { BUTTON_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";
import { ErrorState } from "../ErrorState";
import { EnvironmentForCredentials } from "../performance/EnvironmentForCredentials";

const SOURCE_TEXT: Record<SeedSourceInput["kind"], string> = {
  specification: "the uploaded specification: one step per operation, from its positive scenario",
  workflow: "the guided workflow: one chain per approved workflow, and one step per other operation",
  collection: "the selected requests: one chain per top-level folder, in run order",
};

/**
 * Creates a request-chain plan from a source, once (specs/037-request-chain-performance FR-020,
 * FR-026). The plan is a first draft the engineer owns; it is never re-derived from its source.
 * Literal credentials found while seeding move into the environment chosen here, or are dropped and
 * listed in the seeding report when none is chosen (FR-027).
 */
export function SeedPlanDialog({
  source,
  defaultName,
  onSeeded,
  onCancel,
}: Readonly<{ source: SeedSourceInput; defaultName: string; onSeeded: (planId: string) => void; onCancel: () => void }>) {
  const id = useId();
  const [name, setName] = useState(defaultName);
  const [environmentId, setEnvironmentId] = useState(
    source.kind === "collection" ? "collection" : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    let environment: { environmentId?: string | null } = {};
    if (source.kind === "collection" && environmentId !== "collection") {
      environment = { environmentId: environmentId || null };
    } else if (source.kind !== "collection" && environmentId) {
      environment = { environmentId };
    }
    const result = await seedPlan({ name: name.trim(), source, ...environment });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSeeded(result.plan.id);
  }

  return (
    <Dialog labelledBy={`${id}-title`} testId="seed-plan-dialog" onClose={onCancel}>
      <div className="space-y-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          Create request-chain plan
        </h2>
        <p className="text-sm text-muted">
          Seeds a first draft from {SOURCE_TEXT[source.kind]}. Every part of every step
          stays editable, and the plan is never re-derived from its source afterwards.
        </p>
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Plan name
          </label>
          <input id={`${id}-name`} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <EnvironmentForCredentials
          environmentId={environmentId}
          onChange={setEnvironmentId}
          offerCollectionSettings={source.kind === "collection"}
        />
        {error && <ErrorState message={error} testId="seed-plan-error" />}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_STYLES.secondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={BUTTON_STYLES.primary} disabled={busy || name.trim() === ""} onClick={() => void handleCreate()}>
            {busy ? "Creating…" : "Create plan"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
