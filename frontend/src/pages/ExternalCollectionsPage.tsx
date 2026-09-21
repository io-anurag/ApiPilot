import { useCallback, useEffect, useState } from "react";
import type { CollectionFolderView, CollectionRequestView, CollectionView } from "@apipilot/shared-domain";
import {
  addUploadedCollectionRequest,
  deleteUploadedCollectionItem,
  fetchUploadedCollectionRuns,
  fetchUploadedCollectionView,
  fetchUploadedCollections,
  renameUploadedCollectionItem,
  reorderUploadedCollectionContainer,
  updateUploadedCollectionRequest,
  updateUploadedCollectionVariables,
  type UploadedCollectionSummary,
} from "../services/externalCollectionsClient";
import { ExternalCollectionUpload } from "../components/ExternalCollectionUpload";
import { ExternalCollectionList } from "../components/ExternalCollectionList";
import { ExternalCollectionRunPanel } from "../components/ExternalCollectionRunPanel";
import { CollectionTreeView, flattenCollectionRequests, type CollectionTreeActions } from "../components/CollectionTreeView";
import { RequestEditorPanel } from "../components/RequestEditorPanel";
import { VariablePanel } from "../components/VariablePanel";
import { ErrorState } from "../components/ErrorState";
import { BUTTON_STYLES } from "../components/controlStyles";
import type { ImportPreload } from "../services/importPreload";

/** Runs a light poll (2s) only to drive the collection editor's read-only lock (FR-017) — the
 * backend enforces the lock authoritatively regardless of this indicator's freshness; this exists
 * purely so the UI doesn't invite an edit attempt it already knows will be refused. */
const LOCK_POLL_INTERVAL_MS = 2000;

function findFolder(folders: CollectionFolderView[], id: string): CollectionFolderView | undefined {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const nested = findFolder(folder.folders, id);
    if (nested) return nested;
  }
  return undefined;
}

function findRequest(view: CollectionView, id: string): CollectionRequestView | undefined {
  function search(items: CollectionRequestView[], folders: CollectionFolderView[]): CollectionRequestView | undefined {
    const direct = items.find((item) => item.id === id);
    if (direct) return direct;
    for (const folder of folders) {
      const found = search(folder.items, folder.folders);
      if (found) return found;
    }
    return undefined;
  }
  return search(view.items, view.folders);
}

/** `containerId: "root"` targets `view` itself; otherwise the matching folder. */
function containerOf(view: CollectionView, containerId: string): { items: CollectionRequestView[]; folders: CollectionFolderView[] } | undefined {
  if (containerId === "root") return view;
  return findFolder(view.folders, containerId);
}

/**
 * Standalone "Import & Run Collection" entry point (FR-011, research.md D9) — reachable with no
 * prior OpenAPI upload and no dependency on `TestGenerationWorkflowPage`'s state. Extended (AP-028
 * specs/028-collection-editor-ui) with the pre-run collection browser, variable panel, and request
 * editor above the existing run panel.
 */
export function ExternalCollectionsPage({
  preload,
}: Readonly<{ preload?: ImportPreload | null }>) {
  const [uploadedCollections, setUploadedCollections] = useState<
    UploadedCollectionSummary[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [collectionView, setCollectionView] = useState<CollectionView | undefined>(undefined);
  const [selectedRequestId, setSelectedRequestId] = useState<string | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"request" | "variables">("request");

  useEffect(() => {
    let cancelled = false;
    fetchUploadedCollections().then((result) => {
      if (!cancelled && result.ok) setUploadedCollections(result.uploadedCollections);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCollectionView = useCallback(async (id: string) => {
    console.log("DEBUG refreshCollectionView start", id);
    const result = await fetchUploadedCollectionView(id);
    console.log("DEBUG refreshCollectionView result", result);
    if (result.ok) {
      setCollectionView(result.collectionView);
      setViewError(null);
    } else {
      setViewError(result.message);
    }
  }, []);

  useEffect(() => {
    setCollectionView(undefined);
    setSelectedRequestId(undefined);
    setViewError(null);
    setMainView("request");
    if (selectedId) {
      refreshCollectionView(selectedId);
    }
  }, [selectedId, refreshCollectionView]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    async function poll() {
      const result = await fetchUploadedCollectionRuns(selectedId!);
      if (!cancelled && result.ok) {
        setLocked(result.runs.some((run) => run.status === "in-progress"));
      }
    }
    poll();
    const interval = setInterval(poll, LOCK_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  function handleUploaded(uploadedCollection: UploadedCollectionSummary) {
    setUploadedCollections((current) => [uploadedCollection, ...current]);
    setSelectedId(uploadedCollection.id);
  }

  function handleRemoved(id: string) {
    setUploadedCollections((current) => current.filter((c) => c.id !== id));
    setSelectedId((current) => (current === id ? undefined : current));
  }

  const selected = uploadedCollections.find((c) => c.id === selectedId);
  const selectedRequest = collectionView && selectedRequestId ? findRequest(collectionView, selectedRequestId) : undefined;

  async function handleSaveVariables(variableValues: Record<string, string>) {
    if (!selectedId) return;
    const result = await updateUploadedCollectionVariables(selectedId, variableValues);
    if (!result.ok) throw new Error(result.message);
    setCollectionView(result.collectionView);
  }

  async function handleSaveRequest(requestId: string, edit: Parameters<typeof updateUploadedCollectionRequest>[2]) {
    if (!selectedId) return;
    const result = await updateUploadedCollectionRequest(selectedId, requestId, edit);
    if (!result.ok) throw new Error(result.message);
    setCollectionView(result.collectionView);
  }

  const treeActions: CollectionTreeActions = {
    onAddRequest: async (parentFolderId) => {
      if (!selectedId) return;
      const name = window.prompt("New request name")?.trim();
      if (!name) return;
      const result = await addUploadedCollectionRequest(selectedId, {
        parentFolderId,
        name,
        method: "GET",
        url: "",
        headers: [],
      });
      if (result.ok) {
        setCollectionView(result.collectionView);
        setSelectedRequestId(result.newItemId);
        setMainView("request");
      } else {
        setViewError(result.message);
      }
    },
    onDeleteItem: async (itemId) => {
      if (!selectedId) return;
      if (!window.confirm("Delete this item? This cannot be undone.")) return;
      const result = await deleteUploadedCollectionItem(selectedId, itemId);
      if (result.ok) {
        setCollectionView(result.collectionView);
        setSelectedRequestId((current) => (current === itemId ? undefined : current));
      } else {
        setViewError(result.message);
      }
    },
    onRenameItem: async (itemId, currentName) => {
      if (!selectedId) return;
      const name = window.prompt("New name", currentName)?.trim();
      if (!name) return;
      const result = await renameUploadedCollectionItem(selectedId, itemId, name);
      if (result.ok) setCollectionView(result.collectionView);
      else setViewError(result.message);
    },
    onMoveItem: async (containerId, itemId, direction) => {
      if (!selectedId || !collectionView) return;
      const container = containerOf(collectionView, containerId);
      if (!container) return;
      const isFolder = container.folders.some((f) => f.id === itemId);
      const kindIds = (isFolder ? container.folders : container.items).map((entry) => entry.id);
      const index = kindIds.indexOf(itemId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= kindIds.length) return;
      [kindIds[index], kindIds[swapWith]] = [kindIds[swapWith], kindIds[index]];
      // Reordering always submits the complete child-id set the backend requires
      // (data-model.md's InvalidOrderError rule): folders' own new order followed by items' own
      // new order. Folders are always ordered before a container's requests in this view
      // (CollectionTreeView's own doc comment), so a collection whose original document
      // interleaved them differently is normalized to folders-then-requests the first time this
      // control is used in that container — a deliberate, documented simplification.
      const otherKindIds = (isFolder ? container.items : container.folders).map((entry) => entry.id);
      const orderedIds = isFolder ? [...kindIds, ...otherKindIds] : [...otherKindIds, ...kindIds];
      const result = await reorderUploadedCollectionContainer(selectedId, containerId, orderedIds);
      if (result.ok) setCollectionView(result.collectionView);
      else setViewError(result.message);
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Bring your own collection
          </p>
          <p className="mt-1 text-sm text-muted">
            Run an existing Postman collection and environment, without first uploading an
            OpenAPI specification.
          </p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="h-1 bg-gradient-to-r from-brand-400 via-brand-600 to-brand-800" />
        <div className="flex items-center justify-between border-b border-border bg-slate-50 dark:bg-white/5 px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Import a Postman collection
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Collection + environment JSON · exported from Postman, shared by a teammate,
              or hand-authored
            </p>
          </div>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <ExternalCollectionUpload onUploaded={handleUploaded} preload={preload} />
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted">
              Uploaded collections
            </h3>
            <ExternalCollectionList
              uploadedCollections={uploadedCollections}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemoved={handleRemoved}
            />
          </div>
        </div>
      </section>

      {selected && collectionView && (
        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            {viewError && <ErrorState message={viewError} />}
            {/* The collection tree always stays in the sidebar (it's the primary navigation);
                variables get the full-width main pane below instead of this ~320px rail — their
                row layout (name + value + source label) doesn't fit a sidebar this narrow. The
                "Variables" toggle lives in the tree's own header row, next to "+ Add request". */}
            <CollectionTreeView
              items={collectionView.items}
              folders={collectionView.folders}
              selectedRequestId={mainView === "request" ? selectedRequestId : undefined}
              onSelectRequest={(item) => {
                setSelectedRequestId(item.id);
                setMainView("request");
              }}
              locked={locked}
              actions={treeActions}
              headerAction={
                // Same ghost text-link weight as "+ Add request" right next to it (rather than a
                // boxed pill), so the two header actions read as one visual family; "selected"
                // (mainView === "variables") is shown the same way CollectionTreeView already
                // shows the selected request — an underline plus the brand color, not a filled box.
                <button
                  type="button"
                  aria-pressed={mainView === "variables"}
                  onClick={() => setMainView("variables")}
                  className={`flex items-center gap-1.5 ${BUTTON_STYLES.ghost} ${mainView === "variables" ? "underline" : ""}`}
                >
                  Variables
                  {collectionView.variables.some((v) => !v.resolved) && (
                    <span
                      aria-label="Some variables are unresolved"
                      title="Some variables are unresolved"
                      className="inline-block h-1.5 w-1.5 rounded-full bg-danger-500"
                    />
                  )}
                </button>
              }
            />
          </div>
          <div>
            {mainView === "variables" ? (
              <VariablePanel variables={collectionView.variables} locked={locked} onSave={handleSaveVariables} />
            ) : selectedRequest ? (
              // `key` forces a fresh mount per request id — RequestEditorPanel's form fields are
              // local `useState`, initialized once from `request.raw`; without this key, selecting
              // a different request left the previously selected request's form values on screen
              // (same component instance, same position in the tree, so React reuses it rather
              // than reinitializing state) instead of loading the newly selected request's own
              // method/URL/headers/body/test script.
              <RequestEditorPanel key={selectedRequest.id} request={selectedRequest} locked={locked} onSave={handleSaveRequest} />
            ) : (
              <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
                Select a request from the collection to view and edit it.
              </p>
            )}
          </div>
        </section>
      )}

      {selected && (
        <ExternalCollectionRunPanel
          uploadedCollection={selected}
          requests={collectionView ? flattenCollectionRequests(collectionView.items, collectionView.folders) : []}
        />
      )}
    </div>
  );
}
