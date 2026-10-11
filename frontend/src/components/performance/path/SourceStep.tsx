import { useState, type ChangeEvent } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import type { QuickTestSession } from "../../../hooks/useQuickTest";
import { BUTTON_STYLES } from "../../controlStyles";
import { ConfirmDialog } from "../../ConfirmDialog";
import { ErrorState } from "../../ErrorState";
import { Skeleton } from "../../Skeleton";
import { StatusBadge } from "../../StatusBadge";
import { SourcePicker } from "./SourcePicker";
import { SOURCE_LABELS, type SourceKind } from "./pathState";

const ACCEPT = ".yaml,.yml";

export const REPLACE_SPECIFICATION_MESSAGE = "Replace the uploaded specification with the new one? Plans already created from it are kept, and so are runs and reports.";

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 14.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-4.5" />
    </svg>
  );
}

const SOURCE_NOTES: Record<Exclude<SourceKind, "specification">, string> = {
  workflow: "The approved workflows of the guided workflow are seeded as they are, one chain each. You see exactly what will be seeded on the next step.",
  collection: "You choose the collection and its requests on the next step.",
  empty: "You write every step yourself on the Plan step.",
};

/**
 * Step 1 of the Performance path (specs/047-unified-performance-tab FR-006, FR-014, FR-023 to FR-025):
 * the source, and for a specification its upload. The specification uploaded earlier in this session is
 * offered for reuse; uploading a different one asks first and keeps plans, runs and reports. Once a plan
 * exists the source is read-only: it shows what the plan was seeded from.
 */
export function SourceStep({
  source,
  locked,
  planSourceLabel,
  onSourceChange,
  quickTest,
  replacing,
  onReplacingChange,
  onSpecificationUploaded,
}: Readonly<{
  source: SourceKind | null;
  /** A plan exists, so the source cannot change. */
  locked: boolean;
  /** What the existing plan was seeded from, for the read-only summary. */
  planSourceLabel?: string;
  onSourceChange: (source: SourceKind) => void;
  quickTest: QuickTestSession;
  replacing: boolean;
  onReplacingChange: (replacing: boolean) => void;
  onSpecificationUploaded: (quickTest: QuickPerformanceTestView) => void;
}>) {
  const [pending, setPending] = useState<File | null>(null);
  const current = quickTest.state.kind === "ready" ? quickTest.state.quickTest : null;

  async function send(file: File, replaceExisting: boolean) {
    const uploaded = await quickTest.upload(file, replaceExisting);
    if (uploaded) {
      onReplacingChange(false);
      onSpecificationUploaded(uploaded);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Replacing asks first; nothing is sent until the engineer confirms (FR-024).
    if (current) setPending(file);
    else void send(file, false);
  }

  const showUpload = source === "specification" && !locked && quickTest.state.kind !== "loading" && (current === null || replacing);

  return (
    <div className="space-y-4" data-testid="source-step">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Choose a source</h3>
        {locked && (
          <p className="text-sm text-muted">
            This plan was seeded from {planSourceLabel ?? (source ? SOURCE_LABELS[source].toLowerCase() : "its source")}. The source cannot change once a plan exists; start a new test from the entry screen to use another.
          </p>
        )}
      </div>
      <SourcePicker selected={source} locked={locked} onPick={onSourceChange} />

      {source === "specification" && locked && current && planSourceLabel && planSourceLabel !== current.specification.filename && (
        <p className="text-sm text-muted" data-testid="spec-source-changed">
          The uploaded specification is now {current.specification.filename}. This plan keeps working from its saved steps.
        </p>
      )}

      {source === "specification" && !locked && quickTest.state.kind === "loading" && <Skeleton className="h-16 w-full rounded bg-surface-strong" />}

      {source === "specification" && !locked && current && !replacing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm" data-testid="uploaded-specification">
          <span className="font-semibold">{current.specification.info?.title ?? current.specification.filename}</span>
          <span className="font-mono text-xs text-muted">{current.specification.filename}</span>
          <StatusBadge label={`${current.specification.operationCount} operations analyzed`} />
          <span className="text-muted">Uploaded earlier in this session.</span>
          <button type="button" className={`${BUTTON_STYLES.secondary} ml-auto`} onClick={() => onReplacingChange(true)}>
            Upload a different specification
          </button>
        </div>
      )}

      {showUpload && (
        <div className="max-w-xl space-y-2">
          <label
            htmlFor="performance-specification-upload"
            className={`relative flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 ${quickTest.uploading ? "cursor-not-allowed border-border bg-surface-subtle opacity-60" : "cursor-pointer border-border-strong bg-surface-subtle hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-500/10"}`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-200 bg-surface text-brand-700 dark:border-brand-500 dark:text-brand-300">
              <UploadIcon />
            </span>
            <span className="text-sm font-medium text-text-primary">Drag and drop your specification here</span>
            <span className="text-xs text-muted">or click to browse your files. OpenAPI 3.x, YAML, up to 10 MB.</span>
            <input
              id="performance-specification-upload"
              type="file"
              accept={ACCEPT}
              aria-label="Upload OpenAPI specification"
              disabled={quickTest.uploading}
              onChange={handleFile}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          </label>
          {quickTest.uploading && (
            <p role="status" className="text-sm text-muted">
              Analyzing the specification...
            </p>
          )}
          {current && replacing && (
            <button type="button" className={BUTTON_STYLES.ghost} onClick={() => onReplacingChange(false)}>
              Keep {current.specification.filename}
            </button>
          )}
        </div>
      )}

      {quickTest.error && source === "specification" && !locked && <ErrorState message={quickTest.error} testId="specification-upload-error" />}

      {source && source !== "specification" && <p className="max-w-2xl text-sm text-muted">{SOURCE_NOTES[source]}</p>}

      {pending && (
        <ConfirmDialog
          message={REPLACE_SPECIFICATION_MESSAGE}
          affectedCount={1}
          confirmLabel="Replace"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const file = pending;
            setPending(null);
            void send(file, true);
          }}
        />
      )}
    </div>
  );
}
