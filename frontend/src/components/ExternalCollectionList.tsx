import type { EnvironmentTier } from "@apipilot/shared-domain";
import { removeUploadedCollection, type UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { BUTTON_STYLES } from "./controlStyles";

const TIER_TONE: Record<EnvironmentTier, StatusTone> = {
  local: "neutral",
  dev: "neutral",
  qa: "info",
  staging: "warning",
  production: "danger",
};

/** Lists, selects among, and removes uploaded collections (FR-016/FR-017). */
export function ExternalCollectionList({
  uploadedCollections,
  selectedId,
  onSelect,
  onRemoved,
}: Readonly<{
  uploadedCollections: UploadedCollectionSummary[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onRemoved: (id: string) => void;
}>) {
  async function handleRemove(id: string) {
    const result = await removeUploadedCollection(id);
    if (result.ok) onRemoved(id);
  }

  if (uploadedCollections.length === 0) {
    return <p className="text-sm text-muted">No uploaded collections yet.</p>;
  }

  return (
    <ul data-testid="external-collection-list" className="divide-y divide-border">
      {uploadedCollections.map((uploadedCollection) => (
        <li
          key={uploadedCollection.id}
          className={`flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-sm ${
            uploadedCollection.id === selectedId ? "bg-slate-50" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(uploadedCollection.id)}
            aria-current={uploadedCollection.id === selectedId}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="min-w-0 truncate text-slate-700">{uploadedCollection.name}</span>
            <StatusBadge label={uploadedCollection.tier} tone={TIER_TONE[uploadedCollection.tier]} />
            {!uploadedCollection.confirmedAt && <StatusBadge label="Unverified" tone="warning" />}
          </button>
          <button
            type="button"
            onClick={() => handleRemove(uploadedCollection.id)}
            className={BUTTON_STYLES.ghost}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
