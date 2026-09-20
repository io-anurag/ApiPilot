import { useRef, useState } from "react";
import type { EnvironmentTier } from "@apipilot/shared-domain";
import { createUploadedCollection, type UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { BUTTON_STYLES } from "./controlStyles";

const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

/**
 * Uploads one Postman collection.json + environment.json pair (FR-001). Standalone form — no
 * OpenAPI specification or guided workflow involved (FR-011).
 */
export function ExternalCollectionUpload({
  onUploaded,
}: Readonly<{ onUploaded: (uploadedCollection: UploadedCollectionSummary) => void }>) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<EnvironmentTier>("local");
  const [collectionFile, setCollectionFile] = useState<File | null>(null);
  const [environmentFile, setEnvironmentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collectionInputRef = useRef<HTMLInputElement>(null);
  const environmentInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (!collectionFile || !environmentFile) return;
    setUploading(true);
    setError(null);
    const result = await createUploadedCollection({
      name: name.trim(),
      tier,
      collectionFile,
      environmentFile,
    });
    setUploading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setName("");
    setCollectionFile(null);
    setEnvironmentFile(null);
    if (collectionInputRef.current) collectionInputRef.current.value = "";
    if (environmentInputRef.current) environmentInputRef.current.value = "";
    onUploaded(result.uploadedCollection);
  }

  const canSubmit = name.trim().length > 0 && !!collectionFile && !!environmentFile && !uploading;

  return (
    <div
      data-testid="external-collection-upload"
      className="space-y-3 rounded-md border border-border bg-slate-50 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="external-collection-name" className="text-xs font-medium text-muted">
            Name
          </label>
          <input
            id="external-collection-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="external-collection-tier" className="text-xs font-medium text-muted">
            Tier
          </label>
          <select
            id="external-collection-tier"
            value={tier}
            onChange={(event) => setTier(event.target.value as EnvironmentTier)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          >
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="external-collection-collection-file" className="text-xs font-medium text-muted">
            Collection (.json)
          </label>
          <input
            id="external-collection-collection-file"
            ref={collectionInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(event) => setCollectionFile(event.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="external-collection-environment-file" className="text-xs font-medium text-muted">
            Environment (.json)
          </label>
          <input
            id="external-collection-environment-file"
            ref={environmentInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(event) => setEnvironmentFile(event.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}

      <button type="button" onClick={handleSubmit} disabled={!canSubmit} className={BUTTON_STYLES.primary}>
        {uploading ? "Uploading…" : "Upload collection"}
      </button>
    </div>
  );
}
