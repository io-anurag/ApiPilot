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
      <section className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Import a Postman Collection</h2>
        <p className="text-sm text-slate-600">
          Upload an existing Postman collection and environment — exported from Postman itself,
          received from a teammate, or hand-authored — and run it, without first uploading an
          OpenAPI specification.
        </p>
        <ExternalCollectionUpload onUploaded={handleUploaded} />
        <ExternalCollectionList
          uploadedCollections={uploadedCollections}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRemoved={handleRemoved}
        />
      </section>
      {selected && <ExternalCollectionRunPanel uploadedCollection={selected} />}
    </div>
  );
}
