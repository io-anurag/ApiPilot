import { useRef, useState, type RefObject } from "react";
import type { EnvironmentTier } from "@apipilot/shared-domain";
import { createUploadedCollection, type UploadedCollectionSummary } from "../services/externalCollectionsClient";
import { BUTTON_STYLES } from "./controlStyles";

const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

function FileIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V5A1.5 1.5 0 017 3.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3.5V8h4" />
    </svg>
  );
}

/** A compact, click-to-browse file field styled like the Guided Workflow upload dropzone. */
function FilePickerField({
  id,
  label,
  hint,
  file,
  onChange,
  inputRef,
}: Readonly<{
  id: string;
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
  inputRef: RefObject<HTMLInputElement>;
}>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <label
        htmlFor={id}
        className={`relative flex items-center gap-2.5 rounded-md border border-dashed px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-1 ${
          file
            ? "border-brand-300 bg-brand-50/50"
            : "cursor-pointer border-slate-300 bg-surface hover:border-brand-400 hover:bg-brand-50/30"
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
            file ? "border-brand-200 bg-white text-brand-700" : "border-border bg-slate-50 text-muted"
          }`}
        >
          <FileIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">
            {file ? file.name : "Choose file"}
          </span>
          <span className="block truncate text-xs text-muted">{file ? hint : `${hint} · click to browse`}</span>
        </span>
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

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
        <FilePickerField
          id="external-collection-collection-file"
          label="Collection (.json)"
          hint="Postman collection"
          file={collectionFile}
          onChange={setCollectionFile}
          inputRef={collectionInputRef}
        />
        <FilePickerField
          id="external-collection-environment-file"
          label="Environment (.json)"
          hint="Postman environment"
          file={environmentFile}
          onChange={setEnvironmentFile}
          inputRef={environmentInputRef}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}

      <button type="button" onClick={handleSubmit} disabled={!canSubmit} className={BUTTON_STYLES.primary}>
        {uploading ? "Uploading…" : "Upload collection"}
      </button>
    </div>
  );
}
