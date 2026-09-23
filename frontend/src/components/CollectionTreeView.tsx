import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CollectionFolderView, CollectionRequestView } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { BUTTON_STYLES } from "./controlStyles";

/**
 * Every request in `items`/`folders`, flattened into the same folders-then-items order this
 * component itself renders in (its own doc comment below explains why that's a "kind-grouped"
 * simplification rather than always-exact original document order). Shared with
 * `ExternalCollectionRunPanel`'s run-order checklist, so what a user sees listed there matches
 * what they see in the tree, even though the backend's actual run order is its own true document
 * order via `Collection.forEachItem()` — a pre-existing, documented gap between the two only for
 * a collection that originally interleaved folders and requests at the same level.
 */
export function flattenCollectionRequests(
  items: CollectionRequestView[],
  folders: CollectionFolderView[],
): CollectionRequestView[] {
  return [...folders.flatMap((folder) => flattenCollectionRequests(folder.items, folder.folders)), ...items];
}

export interface CollectionTreeActions {
  /** `parentFolderId: null` targets the collection root. */
  onAddRequest: (parentFolderId: string | null) => void;
  /** Adds a new, empty folder — nestable, so also offered from within an existing folder's own
   * actions menu. `parentFolderId: null` targets the collection root. */
  onAddFolder: (parentFolderId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onRenameItem: (itemId: string, currentName: string) => void;
  /**
   * Moves `itemId` one position earlier/later among its own sibling kind (requests reorder among
   * requests, folders among folders) within `containerId` (`"root"` or a folder id) — see
   * CollectionTreeView's own doc comment for why cross-kind interleaving isn't exposed here.
   */
  onMoveItem: (containerId: string, itemId: string, direction: "up" | "down") => void;
}

interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * A row's move/rename/delete (and, for a folder, "add request") actions collapsed into one
 * always-visible "⋮" menu button, rather than a row of individually tiny icon buttons — that
 * earlier layout was both hard to notice (opacity-gated, ~12px glyphs) and, in the ~320px
 * sidebar, wide enough to visually overflow a nested row's card boundary. One fixed-size button
 * per row can never overflow, and stays a single easy target regardless of nesting depth.
 */
function RowActionsMenu({ label, items, disabled }: Readonly<{ label: string; items: RowMenuItem[]; disabled: boolean }>) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      // The menu itself now renders in a portal outside `containerRef` — checked separately so an
      // in-menu click isn't misread as an outside click.
      if ((event.target as HTMLElement | null)?.closest('[data-testid="row-actions-menu-portal"]')) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function handleClose() {
      setOpen(false);
    }
    // The tree's own scroll container doesn't bubble its "scroll" event, but a capturing listener
    // on window still receives it during the capture phase — closing here avoids a stale-positioned
    // menu rather than trying to keep it pinned to a button that has scrolled out from under it.
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((current) => !current);
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggleOpen}
        className="flex h-6 w-6 items-center justify-center rounded text-sm font-bold text-muted hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white"
      >
        ⋮
      </button>
      {/* Rendered into `document.body` via a portal rather than positioned `absolute` inside the
          tree's own row — the tree's scrollable container (`overflow-y-auto`, CollectionTreeView's
          own doc comment) otherwise counts this menu toward its scrollable content and shows a
          scrollbar for it alone, even when the visible rows don't need one. `position: fixed`
          with a viewport-relative offset keeps it visually anchored under the button regardless. */}
      {open &&
        menuPosition &&
        createPortal(
          <div
            data-testid="row-actions-menu-portal"
            role="menu"
            aria-label={`Actions for ${label}`}
            style={{ position: "fixed", top: menuPosition.top, right: menuPosition.right }}
            className="z-50 w-36 rounded-md border border-border bg-surface py-1 shadow-md"
          >
            {items.map((menuItem) => (
              <button
                key={menuItem.label}
                type="button"
                role="menuitem"
                disabled={menuItem.disabled}
                onClick={() => {
                  setOpen(false);
                  menuItem.onSelect();
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 ${menuItem.danger ? "text-danger-700 dark:text-danger-300" : "text-slate-700 dark:text-slate-200"}`}
              >
                {menuItem.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

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
        className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${isSelected ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
      >
        <button
          type="button"
          onClick={() => onSelectRequest(item)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <HttpMethodBadge method={item.raw.method} />
          <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">{item.name}</span>
          {item.wasEdited && (
            <span className="shrink-0 rounded bg-warning-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
              Edited
            </span>
          )}
        </button>
        <RowActionsMenu
          label={item.name}
          disabled={locked}
          items={[
            { label: "Move up", disabled: index === 0, onSelect: () => actions.onMoveItem(containerId, item.id, "up") },
            {
              label: "Move down",
              disabled: index === siblingCount - 1,
              onSelect: () => actions.onMoveItem(containerId, item.id, "down"),
            },
            { label: "Rename", onSelect: () => actions.onRenameItem(item.id, item.name) },
            { label: "Delete", danger: true, onSelect: () => actions.onDeleteItem(item.id) },
          ]}
        />
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
      <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-slate-800 dark:text-slate-100"
        >
          <span aria-hidden="true" className="shrink-0">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="min-w-0 truncate">{folder.name}</span>
        </button>
        <RowActionsMenu
          label={folder.name}
          disabled={locked}
          items={[
            { label: "Add request here", onSelect: () => actions.onAddRequest(folder.id) },
            { label: "Add folder here", onSelect: () => actions.onAddFolder(folder.id) },
            { label: "Move up", disabled: index === 0, onSelect: () => actions.onMoveItem(containerId, folder.id, "up") },
            {
              label: "Move down",
              disabled: index === siblingCount - 1,
              onSelect: () => actions.onMoveItem(containerId, folder.id, "down"),
            },
            { label: "Rename", onSelect: () => actions.onRenameItem(folder.id, folder.name) },
            { label: "Delete", danger: true, onSelect: () => actions.onDeleteItem(folder.id) },
          ]}
        />
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
  headerAction,
}: Readonly<{
  items: CollectionRequestView[];
  folders: CollectionFolderView[];
  selectedRequestId?: string;
  onSelectRequest: (item: CollectionRequestView) => void;
  locked: boolean;
  actions: CollectionTreeActions;
  /** Rendered at the start of the header row, before "+ Add request" (e.g. the page's own
   * "Variables" toggle) — so both live on the one header row rather than stacking separately. */
  headerAction?: ReactNode;
}>) {
  return (
    // `flex-1 min-h-0` (a flex item inside the page's own fixed-height `flex-col` wrapper) so this
    // box fills that height; the list below then takes whatever remains via its own
    // `flex-1 min-h-0` and scrolls once the tree outgrows it.
    <div className="flex min-h-0 flex-1 flex-col space-y-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        {headerAction}
        <button
          type="button"
          disabled={locked}
          onClick={() => actions.onAddFolder(null)}
          className={`ml-auto ${BUTTON_STYLES.ghost}`}
        >
          + Add folder
        </button>
        <button type="button" disabled={locked} onClick={() => actions.onAddRequest(null)} className={BUTTON_STYLES.ghost}>
          + Add request
        </button>
      </div>
      {locked && (
        <p role="status" className="rounded-md border border-warning-100 bg-warning-50 px-2 py-1 text-xs text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100">
          This collection is read-only while a run is in progress.
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
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
