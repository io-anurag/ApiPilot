import { useEffect, useId, useState } from "react";
import type { Environment } from "@apipilot/shared-domain";
import { fetchEnvironments } from "../../services/environmentsClient";
import { FIELD_STYLES } from "../controlStyles";

/**
 * The optional environment a plan's literal credentials move into when it is seeded (specs/037 FR-027).
 * Without one they are dropped and listed in the seeding report. Shared by the seed dialog and the
 * Performance path's Operations step (specs/047-unified-performance-tab).
 */
export function EnvironmentForCredentials({
  environmentId,
  onChange,
  offerCollectionSettings = false,
  collectionSettingsLabel = "Collection settings (copy)",
}: Readonly<{
  environmentId: string;
  onChange: (environmentId: string) => void;
  offerCollectionSettings?: boolean;
  collectionSettingsLabel?: string;
}>) {
  const id = useId();
  const [environments, setEnvironments] = useState<Environment[]>([]);

  useEffect(() => {
    void fetchEnvironments().then((result) => {
      if (result.ok) setEnvironments(result.environments);
    });
  }, []);

  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-environment`} className="text-sm font-medium text-text-primary">
        {offerCollectionSettings
          ? "Target environment"
          : "Environment for credentials (optional)"}
      </label>
      <select
        id={`${id}-environment`}
        className={`${FIELD_STYLES} w-full`}
        value={environmentId}
        onChange={(event) => onChange(event.target.value)}
      >
        {offerCollectionSettings && (
          <option value="collection">{collectionSettingsLabel}</option>
        )}
        <option value="">None: literal credentials are not kept</option>
        {environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {environment.name} ({environment.tier})
          </option>
        ))}
      </select>
      <p className="text-xs text-muted">
        A credential written as text in the source is moved into this environment as a
        secret value. Without one, it is dropped and listed so you can set it.
      </p>
    </div>
  );
}
