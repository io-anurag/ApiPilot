import { useEffect, useRef, useState, type RefObject } from "react";
import type { EnvironmentTier } from "@apipilot/shared-domain";
import {
  createUploadedCollection,
  type UploadedCollectionSummary,
} from "../services/externalCollectionsClient";
import type { ImportPreload } from "../services/importPreload";
import { BUTTON_STYLES, FIELD_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";
import { DropZone } from "./patterns/DropZone";

const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

function FileIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V5A1.5 1.5 0 017 3.5z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3.5V8h4" />
    </svg>
  );
}

function CheckIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 7" />
    </svg>
  );
}

/**
 * A click-to-browse (or drop) file field built on the shared `DropZone`. The file input stays inside
 * the zone's label, visually hidden but keyboard reachable; a chosen file is shown by its name and a
 * check icon, not by colour. Dropping a file selects it, as the earlier full-size input did natively.
 */
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
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      <DropZone
        active={dragging}
        icon={file ? <CheckIcon className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
        title={file ? file.name : "Choose file"}
        hint={file ? hint : `${hint} · click to browse`}
        className="min-w-0 break-all"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) onChange(dropped);
        }}
      >
        <input
          id={id}
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          className="sr-only"
        />
      </DropZone>
    </div>
  );
}

/**
 * Uploads one Postman collection.json + environment.json pair (FR-001). Standalone form — no
 * OpenAPI specification or guided workflow involved (FR-011), though its fields may arrive
 * pre-filled from the guided workflow's handoff (`preload`) — the user still reviews and submits
 * the upload themselves.
 */
export function ExternalCollectionUpload({
  onUploaded,
  preload,
}: Readonly<{
  onUploaded: (uploadedCollection: UploadedCollectionSummary) => void;
  preload?: ImportPreload | null;
}>) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<EnvironmentTier>("local");
  const [collectionFile, setCollectionFile] = useState<File | null>(null);
  const [environmentFile, setEnvironmentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collectionInputRef = useRef<HTMLInputElement>(null);
  const environmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preload) return;
    setName(preload.name);
    setCollectionFile(preload.collectionFile);
    setEnvironmentFile(preload.environmentFile);
  }, [preload]);

  async function handleSubmit() {
    if (!collectionFile || !environmentFile) return;
    setUploading(true);
    setError(null);
    // Only the workflow's own files link the upload to it: replacing either one, or never having
    // been handed over, sends nothing (specs/048 D1).
    const workflowId =
      preload?.workflowId !== undefined &&
      collectionFile === preload.collectionFile &&
      environmentFile === preload.environmentFile
        ? preload.workflowId
        : undefined;
    const result = await createUploadedCollection({
      name: name.trim(),
      tier,
      collectionFile,
      environmentFile,
      workflowId,
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

  const canSubmit =
    name.trim().length > 0 && !!collectionFile && !!environmentFile && !uploading;

  return (
    <div data-testid="external-collection-upload" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor="external-collection-name"
            className="text-xs font-medium text-text-secondary"
          >
            Name
          </label>
          <input
            id="external-collection-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD_STYLES}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor="external-collection-tier"
            className="text-xs font-medium text-text-secondary"
          >
            Tier
          </label>
          <select
            id="external-collection-tier"
            value={tier}
            onChange={(event) => setTier(event.target.value as EnvironmentTier)}
            className={FIELD_STYLES}
          >
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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

      {error && <ErrorState message={error} />}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={BUTTON_STYLES.primary}
        >
          {uploading ? "Uploading…" : "Upload collection"}
        </button>
      </div>
    </div>
  );
}
