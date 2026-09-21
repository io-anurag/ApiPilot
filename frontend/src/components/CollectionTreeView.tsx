import { useState } from "react";
import type { CollectionFolderView, CollectionRequestView } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { BUTTON_STYLES } from "./controlStyles";

export interface CollectionTreeActions {
  /** `parentFolderId: null` targets the collection root. */
  onAddRequest: (parentFolderId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onRenameItem: (itemId: string, currentName: string) => void;
  /**
   * Moves `itemId` one position earlier/later among its own sibling kind (requests reorder among
   * requests, folders among folders) within `containerId` (`"root"` or a folder id) — see
   * CollectionTreeView's own doc comment for why cross-kind interleaving isn't exposed here.
   */
  onMoveItem: (containerId: string, itemId: string, direction: "up" | "down") => void;
}

const ICON_BUTTON = "rounded px-1.5 py-0.5 text-xs text-muted hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white";

function RequestRow({
  item,
  selectedRequestId,
  onSelectRequest,
  containerId,
  index,
  siblingCount,
  locked,
  actions,
}: Readonly<{
  item: CollectionRequestView;
  selectedRequestId: string | undefined;
  onSelectRequest: (item: CollectionRequestView) => void;
  containerId: string;
  index: number;
  siblingCount: number;
  locked: boolean;
  actions: CollectionTreeActions;
}>) {
  const isSelected = item.id === selectedRequestId;
  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isSelected ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
      >
        <button
          type="button"
          onClick={() => onSelectRequest(item)}
          className="flex flex-1 items-center gap-2 text-left text-sm"
        >
          <HttpMethodBadge method={item.raw.method} />
          <span className="truncate text-slate-800 dark:text-slate-100">{item.name}</span>
          {item.wasEdited && (
            <span className="rounded bg-warning-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
              Edited
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={`Move ${item.name} up`}
          disabled={locked || index === 0}
          onClick={() => actions.onMoveItem(containerId, item.id, "up")}
          className={ICON_BUTTON}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${item.name} down`}
          disabled={locked || index === siblingCount - 1}
          onClick={() => actions.onMoveItem(containerId, item.id, "down")}
          className={ICON_BUTTON}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Rename ${item.name}`}
          disabled={locked}
          onClick={() => actions.onRenameItem(item.id, item.name)}
          className={ICON_BUTTON}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${item.name}`}
          disabled={locked}
          onClick={() => actions.onDeleteItem(item.id)}
          className={`${ICON_BUTTON} hover:text-danger-700 dark:hover:text-danger-300`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function FolderRow({
  folder,
  containerId,
  index,
  siblingCount,
  selectedRequestId,
  onSelectRequest,
  locked,
  actions,
}: Readonly<{
  folder: CollectionFolderView;
  containerId: string;
  index: number;
  siblingCount: number;
  selectedRequestId: string | undefined;
  onSelectRequest: (item: CollectionRequestView) => void;
  locked: boolean;
  actions: CollectionTreeActions;
}>) {
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-slate-800 dark:text-slate-100"
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <span className="truncate">{folder.name}</span>
        </button>
        <button
          type="button"
          aria-label={`Add request to ${folder.name}`}
          disabled={locked}
          onClick={() => actions.onAddRequest(folder.id)}
          className={ICON_BUTTON}
        >
          + Request
        </button>
        <button
          type="button"
          aria-label={`Move ${folder.name} up`}
          disabled={locked || index === 0}
          onClick={() => actions.onMoveItem(containerId, folder.id, "up")}
          className={ICON_BUTTON}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${folder.name} down`}
          disabled={locked || index === siblingCount - 1}
          onClick={() => actions.onMoveItem(containerId, folder.id, "down")}
          className={ICON_BUTTON}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={`Rename ${folder.name}`}
          disabled={locked}
          onClick={() => actions.onRenameItem(folder.id, folder.name)}
          className={ICON_BUTTON}
        >
          Rename
        </button>
        <button
          type="button"
          aria-label={`Delete ${folder.name}`}
          disabled={locked}
          onClick={() => actions.onDeleteItem(folder.id)}
          className={`${ICON_BUTTON} hover:text-danger-700 dark:hover:text-danger-300`}
        >
          Delete
        </button>
      </div>
      {expanded && (
        <ul className="ml-5 space-y-0.5 border-l border-border pl-2">
          {folder.folders.map((child, i) => (
            <FolderRow
              key={child.id}
              folder={child}
              containerId={folder.id}
              index={i}
              siblingCount={folder.folders.length}
              selectedRequestId={selectedRequestId}
              onSelectRequest={onSelectRequest}
              locked={locked}
              actions={actions}
            />
          ))}
          {folder.items.map((item, i) => (
            <RequestRow
              key={item.id}
              item={item}
              selectedRequestId={selectedRequestId}
              onSelectRequest={onSelectRequest}
              containerId={folder.id}
              index={i}
              siblingCount={folder.items.length}
              locked={locked}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Recursive folder/request tree for a loaded collection (FR-001, FR-002 via `RequestEditorPanel`'s
 * own preview; FR-013–FR-016 via the per-row add/rename/delete/move controls below) — read-only
 * (every control disabled) while `locked` is true (FR-017).
 *
 * `folders`/`items` are two separate lists per data-model.md's `CollectionView`/
 * `CollectionFolderView` shape (folders always rendered before a container's own requests). This
 * groups by kind rather than reproducing a literal fully-interleaved Postman document order —
 * move-up/move-down accordingly reorders a request among requests or a folder among folders, not
 * across the two groups. A collection whose author interleaved folders and requests keeps each
 * kind's own relative order faithfully; only cross-kind interleaving isn't reproducible from this
 * view (documented simplification, not silently mismodeled).
 */
export function CollectionTreeView({
  items,
  folders,
  selectedRequestId,
  onSelectRequest,
  locked,
  actions,
}: Readonly<{
  items: CollectionRequestView[];
  folders: CollectionFolderView[];
  selectedRequestId?: string;
  onSelectRequest: (item: CollectionRequestView) => void;
  locked: boolean;
  actions: CollectionTreeActions;
}>) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted">Collection</h3>
        <button
          type="button"
          disabled={locked}
          onClick={() => actions.onAddRequest(null)}
          className={BUTTON_STYLES.ghost}
        >
          + Add request
        </button>
      </div>
      {locked && (
        <p role="status" className="rounded-md border border-warning-100 bg-warning-50 px-2 py-1 text-xs text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100">
          This collection is read-only while a run is in progress.
        </p>
      )}
      <ul className="space-y-0.5">
        {folders.map((folder, i) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            containerId="root"
            index={i}
            siblingCount={folders.length}
            selectedRequestId={selectedRequestId}
            onSelectRequest={onSelectRequest}
            locked={locked}
            actions={actions}
          />
        ))}
        {items.map((item, i) => (
          <RequestRow
            key={item.id}
            item={item}
            selectedRequestId={selectedRequestId}
            onSelectRequest={onSelectRequest}
            containerId="root"
            index={i}
            siblingCount={items.length}
            locked={locked}
            actions={actions}
          />
        ))}
      </ul>
    </div>
  );
}
