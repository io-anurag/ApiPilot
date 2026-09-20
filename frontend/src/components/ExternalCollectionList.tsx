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

function InboxIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12l2.5-6.5A1.5 1.5 0 018 4.5h8a1.5 1.5 0 011.5 1l2.5 6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h4.5l1 2h5l1-2H20v6a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-6z" />
    </svg>
  );
}

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
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted">
          <InboxIcon className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-slate-700">No uploaded collections yet</p>
        <p className="text-xs text-muted">Upload a collection above to run it here.</p>
      </div>
    );
  }

  return (
    <ul
      data-testid="external-collection-list"
      className="divide-y divide-border rounded-md border border-border"
    >
      {uploadedCollections.map((uploadedCollection) => (
        <li
          key={uploadedCollection.id}
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm ${
            uploadedCollection.id === selectedId ? "bg-brand-50/50" : "hover:bg-slate-50"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(uploadedCollection.id)}
            aria-current={uploadedCollection.id === selectedId}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="min-w-0 truncate font-medium text-slate-700">{uploadedCollection.name}</span>
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
