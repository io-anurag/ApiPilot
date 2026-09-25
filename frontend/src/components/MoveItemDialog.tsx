import { useEffect, useRef, useState } from "react";
import type { CollectionFolderView, CollectionView, MoveCarried } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "./controlStyles";
import { Dialog } from "./Dialog";

/** A folder together with the folders above it, root first. */
interface FolderEntry {
  folder: CollectionFolderView;
  ancestors: CollectionFolderView[];
}

function listFolders(folders: CollectionFolderView[], ancestors: CollectionFolderView[] = []): FolderEntry[] {
  return folders.flatMap((folder) => [{ folder, ancestors }, ...listFolders(folder.folders, [...ancestors, folder])]);
}

/** One place an item can be moved to: the collection root, or a folder shown by its full path. */
export interface MoveDestination {
  containerId: string;
  label: string;
  /** Root first, ending with the destination itself; empty for the collection root. */
  chain: CollectionFolderView[];
}

/** The item being moved, with its current container chain, found anywhere in the tree. */
interface MovedItem {
  name: string;
  isFolder: boolean;
  chain: CollectionFolderView[];
  copiedScriptFolderIds: string[];
}

function findMovedItem(view: CollectionView, itemId: string): MovedItem | undefined {
  const rootRequest = view.items.find((item) => item.id === itemId);
  if (rootRequest) return { name: rootRequest.name, isFolder: false, chain: [], copiedScriptFolderIds: rootRequest.copiedScriptFolderIds };
  for (const { folder, ancestors } of listFolders(view.folders)) {
    if (folder.id === itemId) {
      return { name: folder.name, isFolder: true, chain: ancestors, copiedScriptFolderIds: folder.copiedScriptFolderIds };
    }
    const request = folder.items.find((item) => item.id === itemId);
    if (request) {
      return { name: request.name, isFolder: false, chain: [...ancestors, folder], copiedScriptFolderIds: request.copiedScriptFolderIds };
    }
  }
  return undefined;
}

/**
 * Every valid destination for `itemId` (FR-015a): the root and each folder, except the item's
 * current container and, for a folder, the folder itself and everything inside it.
 */
export function buildMoveDestinations(view: CollectionView, itemId: string): MoveDestination[] {
  const moved = findMovedItem(view, itemId);
  if (!moved) return [];
  const currentContainerId = moved.chain.at(-1)?.id ?? "root";
  const all: MoveDestination[] = [
    { containerId: "root", label: "Collection root", chain: [] },
    ...listFolders(view.folders).map(({ folder, ancestors }) => ({
      containerId: folder.id,
      label: [...ancestors, folder].map((entry) => entry.name).join(" / "),
      chain: [...ancestors, folder],
    })),
  ];
  return all.filter(
    (destination) =>
      destination.containerId !== currentContainerId &&
      !(moved.isFolder && destination.chain.some((folder) => folder.id === itemId)),
  );
}

const SCRIPT_LABEL: Record<"prerequest" | "test", string> = { prerequest: "pre-request", test: "test" };

/** The notice shown after a move: what was copied into the item, since ApiPilot's editor shows neither auth nor pre-request scripts (FR-015b). */
export function describeMoveResult(itemName: string, carried: MoveCarried): string {
  const copied: string[] = [];
  if (carried.auth) {
    const from = carried.auth.fromFolderName ? `folder “${carried.auth.fromFolderName}”` : "the collection";
    copied.push(carried.auth.type === "noauth" ? "an explicit “No Auth”, so the new folder’s auth does not apply" : `its ${carried.auth.type} auth from ${from}`);
  }
  for (const folder of carried.scriptsFromFolders) {
    copied.push(`the ${folder.events.map((event) => SCRIPT_LABEL[event]).join(" and ")} scripts of folder “${folder.name}”`);
  }
  if (copied.length === 0) return `Moved “${itemName}”. Nothing needed copying: it keeps the same auth and scripts.`;
  const testsNote = carried.scriptsFromFolders.some((folder) => folder.events.includes("test"))
    ? " Saving its Tests tab merges copied test scripts with its own, so two scripts declaring the same variable name can then conflict."
    : "";
  return `Moved “${itemName}” and marked it edited. Copied into it: ${copied.join("; ")}.${testsNote}`;
}

/**
 * What choosing `destination` means for the item's scripts (FR-015b): the folders on the new path
 * whose scripts will start running for it, and folders whose scripts it already carries a copy of
 * and would therefore run twice.
 */
export function describeMoveScripts(
  view: CollectionView,
  itemId: string,
  destination: MoveDestination,
): { alsoRuns: string[]; runsTwice: string[] } {
  const moved = findMovedItem(view, itemId);
  if (!moved) return { alsoRuns: [], runsTwice: [] };
  const currentIds = new Set(moved.chain.map((folder) => folder.id));
  const alsoRuns = destination.chain
    .filter((folder) => !currentIds.has(folder.id) && folder.scriptEvents.length > 0)
    .map((folder) => `${folder.name} (${folder.scriptEvents.map((event) => SCRIPT_LABEL[event]).join(" and ")})`);
  const runsTwice = destination.chain
    .filter((folder) => moved.copiedScriptFolderIds.includes(folder.id))
    .map((folder) => folder.name);
  return { alsoRuns, runsTwice };
}

/**
 * "Move to…" picker for a request or folder (FR-015a). Before confirming it states that the item
 * keeps its inherited auth and scripts, lists the destination's scripts that will also run, and
 * warns when a folder's scripts would run twice (FR-015b).
 */
export function MoveItemDialog({
  view,
  itemId,
  onConfirm,
  onCancel,
}: Readonly<{
  view: CollectionView;
  itemId: string;
  onConfirm: (targetContainerId: string) => void;
  onCancel: () => void;
}>) {
  const destinations = buildMoveDestinations(view, itemId);
  const itemName = findMovedItem(view, itemId)?.name ?? "item";
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const firstOptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstOptionRef.current?.focus();
  }, []);

  const target = destinations.find((destination) => destination.containerId === targetId);
  const scripts = target ? describeMoveScripts(view, itemId, target) : undefined;

  return (
    <Dialog role="dialog" labelledBy="move-item-dialog-title" testId="move-item-dialog" onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (targetId) onConfirm(targetId);
        }}
        className="space-y-3"
      >
        <p id="move-item-dialog-title" className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Move “{itemName}” to…
        </p>
        {destinations.length === 0 ? (
          <p className="text-sm text-muted">There is no other folder to move it to.</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="sr-only">Destination</legend>
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
              {destinations.map((destination, index) => (
                <label
                  key={destination.containerId}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <input
                    ref={index === 0 ? firstOptionRef : undefined}
                    type="radio"
                    name="move-destination"
                    value={destination.containerId}
                    checked={targetId === destination.containerId}
                    onChange={() => setTargetId(destination.containerId)}
                    className="h-4 w-4 shrink-0 border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  />
                  <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">{destination.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <p className="text-xs text-muted">
          It keeps the auth and the scripts it gets from the folders it leaves: they are copied into it.
        </p>
        {scripts && scripts.alsoRuns.length > 0 && (
          <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200">
            <span className="font-semibold">Also runs there:</span> scripts of {scripts.alsoRuns.join(", ")}. A folder&apos;s
            scripts run for everything inside it.
          </p>
        )}
        {scripts && scripts.runsTwice.length > 0 && (
          <p role="alert" className="rounded-md bg-warning-100 px-2 py-1.5 text-xs text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
            <span className="font-semibold">Warning:</span> it already carries a copy of the scripts of{" "}
            {scripts.runsTwice.join(", ")}. They would run twice.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={BUTTON_STYLES.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={!targetId} className={BUTTON_STYLES.primary}>
            Move
          </button>
        </div>
      </form>
    </Dialog>
  );
}
