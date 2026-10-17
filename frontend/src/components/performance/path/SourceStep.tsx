import { useState, type ChangeEvent } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import type { QuickTestSession } from "../../../hooks/useQuickTest";
import { BUTTON_STYLES } from "../../controlStyles";
import { ConfirmDialog } from "../../ConfirmDialog";
import { ErrorState } from "../../ErrorState";
import { Skeleton } from "../../Skeleton";
import { Card, CardHeader } from "../../patterns/Card";
import { DropZone } from "../../patterns/DropZone";
import { Pill } from "../../patterns/Pill";
import { SourceDetailCard } from "./SourceDetailCard";
import { SourcePicker } from "./SourcePicker";
import { SOURCE_LABELS, type SourceKind } from "./pathState";

const ACCEPT = ".yaml,.yml";

/** The accepted input, as the start screen's upload card states it (047 FR-025: unchanged limits). */
const SPECIFICATION_META = "OpenAPI 3.x · YAML · up to 10 MB";

export const REPLACE_SPECIFICATION_MESSAGE = "Replace the uploaded specification with the new one? Plans already created from it are kept, and so are runs and reports.";

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 14.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-4.5" />
    </svg>
  );
}

const SOURCE_HEADINGS: Record<Exclude<SourceKind, "specification">, string> = {
  workflow: "Start from the guided workflow",
  collection: "Start from a Postman collection",
  empty: "Start with an empty plan",
};

const SOURCE_NOTES: Record<Exclude<SourceKind, "specification">, string> = {
  workflow: "The approved workflows of the guided workflow are seeded as they are, one chain each. You see exactly what will be seeded on the next step.",
  collection: "You choose the collection and its requests on the next step.",
  empty: "You write every step yourself on the Plan step.",
};

/**
 * Step 1 of the Performance path (specs/047-unified-performance-tab FR-006, FR-014, FR-023 to FR-025):
 * the source, and for a specification its upload. The specification uploaded earlier in this session is
 * offered for reuse; uploading a different one asks first and keeps plans, runs and reports. Once a plan
 * exists the source is read-only: it shows what the plan was seeded from. The look follows
 * specs/050-performance-source-step-redesign.
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
    <Card as="section" aria-labelledby="performance-source-title" className="space-y-5" data-testid="source-step">
      <div className="space-y-1">
        <CardHeader title="Choose a source" titleId="performance-source-title" subtitle={locked ? undefined : "Where should the plan's steps come from?"} />
        {locked && (
          <p className="text-sm text-text-secondary">
            This plan was seeded from {planSourceLabel ?? (source ? SOURCE_LABELS[source].toLowerCase() : "its source")}. The source cannot change once a plan exists; start a new test from the entry screen to use another.
          </p>
        )}
      </div>
      <SourcePicker selected={source} locked={locked} onPick={onSourceChange} />

      {source === "specification" && locked && current && planSourceLabel && planSourceLabel !== current.specification.filename && (
        <p className="text-sm text-text-secondary" data-testid="spec-source-changed">
          The uploaded specification is now {current.specification.filename}. This plan keeps working from its saved steps.
        </p>
      )}

      {source === "specification" && !locked && (
        <SourceDetailCard title="Performance test from a specification" meta={SPECIFICATION_META} stateLabel={current && !replacing ? "Ready" : "Required"} ready={current !== null && !replacing}>
          <div className="space-y-1">
            <h3 className="font-display text-lg font-semibold text-text-primary">Upload specification</h3>
            <p className="text-sm leading-6 text-text-secondary">The document stays in your local workflow and is never sent to a cloud AI provider.</p>
          </div>

          {quickTest.state.kind === "loading" && <Skeleton className="h-16 w-full rounded bg-surface-strong" />}

          {current && !replacing && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm" data-testid="uploaded-specification">
              <span className="font-semibold text-text-primary">{current.specification.info?.title ?? current.specification.filename}</span>
              <span className="break-all font-mono text-xs text-muted">{current.specification.filename}</span>
              <Pill tone="mint">{`${current.specification.operationCount} operations analyzed`}</Pill>
              <span className="text-text-secondary">Uploaded earlier in this session.</span>
              <button type="button" className={`${BUTTON_STYLES.secondary} ml-auto`} onClick={() => onReplacingChange(true)}>
                Upload a different specification
              </button>
            </div>
          )}

          {showUpload && (
            <div className="space-y-2">
              <DropZone
                htmlFor="performance-specification-upload"
                disabled={quickTest.uploading}
                icon={<UploadIcon />}
                title="Drag and drop your specification here"
                hint="or click to browse your files"
                className="relative"
              >
                <input
                  id="performance-specification-upload"
                  type="file"
                  accept={ACCEPT}
                  aria-label="Upload OpenAPI specification"
                  disabled={quickTest.uploading}
                  onChange={handleFile}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
              </DropZone>
              {quickTest.uploading && (
                <p role="status" className="text-sm text-text-secondary">
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
        </SourceDetailCard>
      )}

      {quickTest.error && source === "specification" && !locked && <ErrorState message={quickTest.error} testId="specification-upload-error" />}

      {source && source !== "specification" && (
        <SourceDetailCard title={`Performance test from ${SOURCE_LABELS[source].toLowerCase()}`} meta="Nothing to upload" stateLabel="Ready" ready>
          <div className="space-y-1">
            <h3 className="font-display text-lg font-semibold text-text-primary">{SOURCE_HEADINGS[source]}</h3>
            <p className="text-sm leading-6 text-text-secondary">{SOURCE_NOTES[source]}</p>
          </div>
        </SourceDetailCard>
      )}

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
    </Card>
  );
}
