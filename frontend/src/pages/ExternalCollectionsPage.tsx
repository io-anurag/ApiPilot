import { useCallback, useEffect, useState } from "react";
import type {
  CollectionFolderView,
  CollectionRequestView,
  CollectionView,
} from "@apipilot/shared-domain";
import {
  addUploadedCollectionFolder,
  addUploadedCollectionRequest,
  deleteUploadedCollectionItem,
  fetchUploadedCollectionRuns,
  fetchUploadedCollectionView,
  fetchUploadedCollections,
  moveUploadedCollectionItem,
  renameUploadedCollectionItem,
  reorderUploadedCollectionContainer,
  updateUploadedCollectionRequest,
  updateUploadedCollectionVariables,
  type UploadedCollectionSummary,
} from "../services/externalCollectionsClient";
import { ExternalCollectionUpload } from "../components/ExternalCollectionUpload";
import { ExternalCollectionList } from "../components/ExternalCollectionList";
import { ExternalCollectionRunPanel } from "../components/ExternalCollectionRunPanel";
import {
  CollectionTreeView,
  flattenCollectionRequestPlacements,
  type CollectionTreeActions,
} from "../components/CollectionTreeView";
import { MoveItemDialog, describeMoveResult } from "../components/MoveItemDialog";
import { RequestEditorPanel } from "../components/RequestEditorPanel";
import { VariablePanel } from "../components/VariablePanel";
import { ErrorState } from "../components/ErrorState";
import { PromptDialog } from "../components/PromptDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ImportRunCollectionBar, ImportRunHero } from "../components/ImportRunHero";
import { ImportRunStepper } from "../components/ImportRunStepper";
import { resolveStep, type ImportRunStepId } from "../components/importRunSteps";
import type { ImportPreload } from "../services/importPreload";
import type { RunOrder } from "../utils/runOrder";

/** Runs a light poll (2s) only to drive the collection editor's read-only lock (FR-017) — the
 * backend enforces the lock authoritatively regardless of this indicator's freshness; this exists
 * purely so the UI doesn't invite an edit attempt it already knows will be refused. */
const LOCK_POLL_INTERVAL_MS = 2000;

function findFolder(
  folders: CollectionFolderView[],
  id: string,
): CollectionFolderView | undefined {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const nested = findFolder(folder.folders, id);
    if (nested) return nested;
  }
  return undefined;
}

function findRequest(
  view: CollectionView,
  id: string,
): CollectionRequestView | undefined {
  function search(
    items: CollectionRequestView[],
    folders: CollectionFolderView[],
  ): CollectionRequestView | undefined {
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

function countFolders(folders: CollectionFolderView[]): number {
  return folders.reduce((total, folder) => total + 1 + countFolders(folder.folders), 0);
}

/** `containerId: "root"` targets `view` itself; otherwise the matching folder. */
function containerOf(
  view: CollectionView,
  containerId: string,
): { items: CollectionRequestView[]; folders: CollectionFolderView[] } | undefined {
  if (containerId === "root") return view;
  return findFolder(view.folders, containerId);
}

/**
 * Four steps (AP-042) — Collection, Review requests, Run, Results — one on screen at a time, so a
 * large collection no longer pushes the run controls far below the fold. The Collection step is the
 * original hero around the import card; later steps shrink it to a header. The run panel stays
 * mounted on every step (hidden outside Run and Results) so a run in progress keeps polling.
 *
 * Standalone "Import & Run Collection" entry point (FR-011, research.md D9) — reachable with no
 * prior OpenAPI upload and no dependency on `TestGenerationWorkflowPage`'s state. Extended (AP-028
 * specs/028-collection-editor-ui) with the pre-run collection browser, variable panel, and request
 * editor above the existing run panel.
 */
export function ExternalCollectionsPage({
  preload,
  onExit,
  onOpenChainPlan,
}: Readonly<{
  preload?: ImportPreload | null;
  onExit?: () => void;
  /** AP-037 FR-020: opens a request-chain plan seeded from the run panel's ordered selection. */
  onOpenChainPlan?: (planId: string) => void;
}>) {
  const [uploadedCollections, setUploadedCollections] = useState<
    UploadedCollectionSummary[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [collectionView, setCollectionView] = useState<CollectionView | undefined>(
    undefined,
  );
  const [selectedRequestId, setSelectedRequestId] = useState<string | undefined>(
    undefined,
  );
  const [locked, setLocked] = useState(false);
  const [requestedStep, setRequestedStep] = useState<ImportRunStepId>("collection");
  const [hasRuns, setHasRuns] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"request" | "variables">("request");
  const [addRequestDialog, setAddRequestDialog] = useState<{
    parentFolderId: string | null;
  } | null>(null);
  const [addFolderDialog, setAddFolderDialog] = useState<{
    parentFolderId: string | null;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    itemId: string;
    currentName: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ itemId: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    itemId: string;
    itemName: string;
  } | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  // Each collection's per-run order (specs/028 FR-015c), kept here rather than in the run panel so
  // it lasts across runs and collection switches until the page is reloaded; never persisted.
  const [runOrders, setRunOrders] = useState<Record<string, RunOrder>>({});

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
    const result = await fetchUploadedCollectionView(id);
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
  const progress = { hasCollection: !!selected, hasRuns: !!selected && hasRuns };
  const step = resolveStep(requestedStep, progress);
  const selectedRequest =
    collectionView && selectedRequestId
      ? findRequest(collectionView, selectedRequestId)
      : undefined;

  // Deselects whichever of RequestEditorPanel/VariablePanel is currently open, returning the main
  // pane to its empty-selection placeholder — each panel's own close control, rather than a single
  // button that dismissed the whole tree+editor section (which also hid the tree you'd need to
  // pick a different request from).
  function handleClosePanel() {
    setSelectedRequestId(undefined);
    setMainView("request");
  }

  async function handleSaveVariables(variableValues: Record<string, string>) {
    if (!selectedId) return;
    const result = await updateUploadedCollectionVariables(selectedId, variableValues);
    if (!result.ok) throw new Error(result.message);
    setCollectionView(result.collectionView);
  }

  async function handleSaveRequest(
    requestId: string,
    edit: Parameters<typeof updateUploadedCollectionRequest>[2],
  ) {
    if (!selectedId) return;
    const result = await updateUploadedCollectionRequest(selectedId, requestId, edit);
    if (!result.ok) throw new Error(result.message);
    setCollectionView(result.collectionView);
  }

  async function handleConfirmAddRequest(name: string) {
    if (!selectedId || !addRequestDialog) return;
    const { parentFolderId } = addRequestDialog;
    setAddRequestDialog(null);
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
  }

  async function handleConfirmAddFolder(name: string) {
    if (!selectedId || !addFolderDialog) return;
    const { parentFolderId } = addFolderDialog;
    setAddFolderDialog(null);
    const result = await addUploadedCollectionFolder(selectedId, {
      parentFolderId,
      name,
    });
    if (result.ok) setCollectionView(result.collectionView);
    else setViewError(result.message);
  }

  async function handleConfirmRename(name: string) {
    if (!selectedId || !renameDialog) return;
    const { itemId } = renameDialog;
    setRenameDialog(null);
    const result = await renameUploadedCollectionItem(selectedId, itemId, name);
    if (result.ok) setCollectionView(result.collectionView);
    else setViewError(result.message);
  }

  async function handleConfirmDelete() {
    if (!selectedId || !deleteDialog) return;
    const { itemId } = deleteDialog;
    setDeleteDialog(null);
    const result = await deleteUploadedCollectionItem(selectedId, itemId);
    if (result.ok) {
      setCollectionView(result.collectionView);
      setSelectedRequestId((current) => (current === itemId ? undefined : current));
    } else {
      setViewError(result.message);
    }
  }

  async function handleConfirmMove(targetContainerId: string) {
    if (!selectedId || !moveDialog) return;
    const { itemId, itemName } = moveDialog;
    setMoveDialog(null);
    const result = await moveUploadedCollectionItem(
      selectedId,
      itemId,
      targetContainerId,
    );
    if (result.ok) {
      setCollectionView(result.collectionView);
      setMoveNotice(describeMoveResult(itemName, result.carried));
    } else {
      setViewError(result.message);
    }
  }

  function openMoveDialog(itemId: string) {
    if (!collectionView) return;
    const name =
      findRequest(collectionView, itemId)?.name ??
      findFolder(collectionView.folders, itemId)?.name ??
      "item";
    setMoveNotice(null);
    setMoveDialog({ itemId, itemName: name });
  }

  const treeActions: CollectionTreeActions = {
    // Opens an in-app PromptDialog/ConfirmDialog instead of the native window.prompt/confirm,
    // which rendered unstyled, ignored dark mode, and looked indistinguishable from a browser
    // chrome dialog rather than part of the application.
    onAddRequest: (parentFolderId) => setAddRequestDialog({ parentFolderId }),
    onAddFolder: (parentFolderId) => setAddFolderDialog({ parentFolderId }),
    onDeleteItem: (itemId) => setDeleteDialog({ itemId }),
    onRenameItem: (itemId, currentName) => setRenameDialog({ itemId, currentName }),
    onMoveItem: async (containerId, itemId, direction) => {
      if (!selectedId || !collectionView) return;
      const container = containerOf(collectionView, containerId);
      if (!container) return;
      const isFolder = container.folders.some((f) => f.id === itemId);
      const kindIds = (isFolder ? container.folders : container.items).map(
        (entry) => entry.id,
      );
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
      const otherKindIds = (isFolder ? container.items : container.folders).map(
        (entry) => entry.id,
      );
      const orderedIds = isFolder
        ? [...kindIds, ...otherKindIds]
        : [...otherKindIds, ...kindIds];
      const result = await reorderUploadedCollectionContainer(
        selectedId,
        containerId,
        orderedIds,
      );
      if (result.ok) setCollectionView(result.collectionView);
      else setViewError(result.message);
    },
    onMoveItemTo: openMoveDialog,
  };

  const requestPlacements = collectionView
    ? flattenCollectionRequestPlacements(collectionView.items, collectionView.folders)
    : [];
  const runOrderPlacements = new Map(
    requestPlacements.map(({ request, ...placement }) => [request.id, placement]),
  );

  return (
    <div className="space-y-5">
      {onExit && (
        <div className="flex justify-start">
          <button
            type="button"
            aria-label="Exit Import & Run Collection and return to the start screen"
            onClick={onExit}
            className={BUTTON_STYLES.ghost}
          >
            ← Back to start
          </button>
        </div>
      )}
      <ImportRunStepper current={step} progress={progress} onSelect={setRequestedStep} />
      <ImportRunHero
        compact={step !== "collection"}
        // Always mounted (hidden by the hero on later steps), so a half-filled upload form and the
        // list's selection survive a visit to another step.
        aside={
          <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[6px_6px_0_0_var(--color-border)]">
            <div className="h-1 bg-brand-600" />
            <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  Import a Postman collection
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Collection + environment JSON · exported from Postman, shared by a
                  teammate, or hand-authored
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
              {selected && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <p className="text-xs text-muted">Selected: {selected.name}</p>
                  <button
                    type="button"
                    onClick={() => setRequestedStep("review")}
                    className={BUTTON_STYLES.primary}
                  >
                    Review requests →
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />

      {step !== "collection" && selected && (
        <ImportRunCollectionBar
          collection={selected}
          requestCount={collectionView ? requestPlacements.length : undefined}
          folderCount={collectionView ? countFolders(collectionView.folders) : undefined}
          variableCount={collectionView?.variables.length}
          onChange={() => setRequestedStep("collection")}
        />
      )}

      {step === "review" && selected && !collectionView && (
        viewError ? (
          <ErrorState message={viewError} />
        ) : (
          <p role="status" className="text-sm text-muted">Loading the collection…</p>
        )
      )}

      {step === "review" && selected && collectionView && (
        <section className="space-y-3">
          {viewError && <ErrorState message={viewError} />}
          {moveNotice && (
            <div
              role="status"
              className="flex items-start justify-between gap-3 rounded-md bg-info-50 px-3 py-2 text-sm text-info-700 dark:bg-info-500/15 dark:text-info-100"
            >
              <p>{moveNotice}</p>
              <button
                type="button"
                onClick={() => setMoveNotice(null)}
                className={BUTTON_STYLES.ghost}
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
            {/* A fixed height rather than stretching to the right column: a large collection then
                scrolls inside the tree (CollectionTreeView's own `overflow-y-auto` list) instead of
                growing the whole page. */}
            <div className="flex h-128 flex-col gap-3">
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
            {/* `min-w-0` lets this `1fr` grid track shrink below its content's width, so a long
                unbroken value (e.g. a bearer token in the resolved preview) wraps inside the panel
                instead of stretching it past the viewport. */}
            <div className="min-w-0">
              {mainView === "variables" ? (
                <VariablePanel
                  variables={collectionView.variables}
                  locked={locked}
                  onSave={handleSaveVariables}
                  onClose={handleClosePanel}
                />
              ) : selectedRequest ? (
                // `key` forces a fresh mount per request id — RequestEditorPanel's form fields are
                // local `useState`, initialized once from `request.raw`; without this key, selecting
                // a different request left the previously selected request's form values on screen
                // (same component instance, same position in the tree, so React reuses it rather
                // than reinitializing state) instead of loading the newly selected request's own
                // method/URL/headers/body/test script.
                <RequestEditorPanel
                  key={selectedRequest.id}
                  request={selectedRequest}
                  locked={locked}
                  onSave={handleSaveRequest}
                  onClose={handleClosePanel}
                />
              ) : (
                <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
                  Select a request from the collection to view and edit it.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => setRequestedStep("collection")} className={BUTTON_STYLES.secondary}>
              ← Collection
            </button>
            <button type="button" onClick={() => setRequestedStep("run")} className={BUTTON_STYLES.primary}>
              Set up run →
            </button>
          </div>
        </section>
      )}

      {selected && (
        <ExternalCollectionRunPanel
          view={step === "run" ? "run" : step === "results" ? "results" : "hidden"}
          onRunStarted={() => setRequestedStep("results")}
          onHasRunsChange={setHasRuns}
          onRunAgain={() => setRequestedStep("run")}
          onViewResults={() => setRequestedStep("results")}
          uploadedCollection={selected}
          requests={requestPlacements.map((placement) => placement.request)}
          placements={collectionView ? runOrderPlacements : undefined}
          runOrder={runOrders[selected.id]}
          onRunOrderChange={
            collectionView
              ? (runOrder) =>
                  setRunOrders((current) => ({ ...current, [selected.id]: runOrder }))
              : undefined
          }
          onOpenChainPlan={onOpenChainPlan}
          onConfirmed={() =>
            setUploadedCollections((current) =>
              current.map((c) =>
                c.id === selected.id
                  ? { ...c, confirmedAt: new Date().toISOString() }
                  : c,
              ),
            )
          }
        />
      )}

      {step === "run" && selected && (
        <div className="flex justify-start">
          <button type="button" onClick={() => setRequestedStep("review")} className={BUTTON_STYLES.secondary}>
            ← Review requests
          </button>
        </div>
      )}

      {addRequestDialog && (
        <PromptDialog
          title="Add request"
          label="New request name"
          confirmLabel="Add"
          onConfirm={handleConfirmAddRequest}
          onCancel={() => setAddRequestDialog(null)}
        />
      )}
      {addFolderDialog && (
        <PromptDialog
          title="Add folder"
          label="New folder name"
          confirmLabel="Add"
          onConfirm={handleConfirmAddFolder}
          onCancel={() => setAddFolderDialog(null)}
        />
      )}
      {renameDialog && (
        <PromptDialog
          title="Rename"
          label="New name"
          initialValue={renameDialog.currentName}
          confirmLabel="Rename"
          onConfirm={handleConfirmRename}
          onCancel={() => setRenameDialog(null)}
        />
      )}
      {moveDialog && collectionView && (
        <MoveItemDialog
          view={collectionView}
          itemId={moveDialog.itemId}
          onConfirm={handleConfirmMove}
          onCancel={() => setMoveDialog(null)}
        />
      )}
      {deleteDialog && (
        <ConfirmDialog
          message="Delete this item? This cannot be undone. Deleting a folder deletes every request nested within it."
          affectedCount={1}
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteDialog(null)}
        />
      )}
    </div>
  );
}
