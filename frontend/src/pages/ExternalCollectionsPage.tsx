import { useEffect, useState } from "react";
import {
  fetchUploadedCollections,
  type UploadedCollectionSummary,
} from "../services/externalCollectionsClient";
import { ExternalCollectionUpload } from "../components/ExternalCollectionUpload";
import { ExternalCollectionList } from "../components/ExternalCollectionList";
import { ExternalCollectionRunPanel } from "../components/ExternalCollectionRunPanel";

/**
 * Standalone "Import & Run Collection" entry point (FR-011, research.md D9) — reachable with no
 * prior OpenAPI upload and no dependency on `TestGenerationWorkflowPage`'s state.
 */
export function ExternalCollectionsPage() {
  const [uploadedCollections, setUploadedCollections] = useState<UploadedCollectionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchUploadedCollections().then((result) => {
      if (!cancelled && result.ok) setUploadedCollections(result.uploadedCollections);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUploaded(uploadedCollection: UploadedCollectionSummary) {
    setUploadedCollections((current) => [uploadedCollection, ...current]);
    setSelectedId(uploadedCollection.id);
  }

  function handleRemoved(id: string) {
    setUploadedCollections((current) => current.filter((c) => c.id !== id));
    setSelectedId((current) => (current === id ? undefined : current));
  }

  const selected = uploadedCollections.find((c) => c.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase text-brand-700">
            Bring your own collection
          </p>
          <p className="mt-1 text-sm text-muted">
            Run an existing Postman collection and environment, without first uploading an OpenAPI
            specification.
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />
        <div className="flex items-center justify-between border-b border-border bg-slate-50 px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Import a Postman collection</p>
            <p className="mt-0.5 text-xs text-muted">
              Collection + environment JSON · exported from Postman, shared by a teammate, or
              hand-authored
            </p>
          </div>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <ExternalCollectionUpload onUploaded={handleUploaded} />
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted">Uploaded collections</h3>
            <ExternalCollectionList
              uploadedCollections={uploadedCollections}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemoved={handleRemoved}
            />
          </div>
        </div>
      </section>

      {selected && <ExternalCollectionRunPanel uploadedCollection={selected} />}
    </div>
  );
}
