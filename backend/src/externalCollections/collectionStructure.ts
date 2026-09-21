import type { Collection, Item, ItemGroup } from "postman-collection";
import { FolderNotFoundError, InvalidOrderError, ItemNotFoundError } from "./errors";

type Folder = ItemGroup<Item>;
type Container = Collection | Folder;

function isFolder(member: Item | Folder): member is Folder {
  return "items" in member && member.items !== undefined;
}

/** Finds a folder anywhere in the tree by its stable id (research.md D9); `undefined` if none matches. */
function findFolder(collection: Collection, id: string): Folder | undefined {
  function search(list: Array<Item | Folder>): Folder | undefined {
    for (const member of list) {
      if (!isFolder(member)) continue;
      if (member.id === id) return member;
      const found = search(member.items.all());
      if (found) return found;
    }
    return undefined;
  }
  return search(collection.items.all());
}

/** Finds the container (root or a specific folder) an item/folder with `id` lives directly inside. */
function findContainerOf(collection: Collection, id: string): Container | undefined {
  function search(container: Container, list: Array<Item | Folder>): Container | undefined {
    for (const member of list) {
      if (member.id === id) return container;
      if (isFolder(member)) {
        const found = search(member, member.items.all());
        if (found) return found;
      }
    }
    return undefined;
  }
  return search(collection, collection.items.all());
}

export interface NewRequestInput {
  name: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
}

/**
 * Adds a new request to a chosen folder or the collection root (FR-013), via the SDK's own
 * `PropertyList.add()` (research.md D10). Throws `FolderNotFoundError` when `parentFolderId` is
 * given but doesn't resolve.
 */
export function addRequest(collection: Collection, parentFolderId: string | null, input: NewRequestInput): { newItemId: string } {
  const target: Container | undefined = parentFolderId === null ? collection : findFolder(collection, parentFolderId);
  if (!target) throw new FolderNotFoundError(parentFolderId ?? "");

  // The typings model `request.url` as a live `Url` instance, but the SDK's own runtime
  // constructor (and every existing parse path in this codebase) accepts a plain string just as
  // happily — the same pattern `uploadedCollectionParsing.ts` already uses for the top-level
  // collection JSON.
  const definition = {
    name: input.name,
    request: {
      method: input.method,
      url: input.url,
      header: input.headers,
      ...(input.body !== undefined ? { body: { mode: "raw", raw: input.body } } : {}),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  } as any;
  target.items.add(definition);
  const members = target.items.all();
  const added = members[members.length - 1];
  return { newItemId: added.id };
}

/**
 * Deletes a request or folder — and, for a folder, everything nested within it (FR-014) — via the
 * SDK's own `PropertyList.remove()`. Throws `ItemNotFoundError` if `id` doesn't resolve.
 */
export function deleteItem(collection: Collection, id: string): void {
  const container = findContainerOf(collection, id);
  if (!container) throw new ItemNotFoundError(id);
  container.items.remove((member: Item | Folder) => member.id === id, undefined);
}

/** Renames an existing request or folder (FR-016). Throws `ItemNotFoundError` if `id` doesn't resolve. */
export function renameItem(collection: Collection, id: string, name: string): void {
  const container = findContainerOf(collection, id);
  if (!container) throw new ItemNotFoundError(id);
  const member = container.items.all().find((entry) => entry.id === id);
  if (!member) throw new ItemNotFoundError(id);
  member.name = name;
}

/**
 * Reorders a container's ("root" or a folder id) direct children to match `orderedIds` (FR-015),
 * by clearing and re-adding the SDK's own already-constructed Item/ItemGroup instances in the new
 * order (`PropertyList` exposes no dedicated reorder method — this composes its existing `.clear()`
 * and `.add()` primitives rather than hand-rolling JSON array surgery, research.md D10).
 *
 * `orderedIds` MUST be exactly the container's current direct-child id set, only reordered
 * (data-model.md FR-015 rule) — throws `InvalidOrderError` otherwise, and `ItemNotFoundError` if
 * `containerId` itself doesn't resolve to a folder (other than the literal `"root"`).
 */
export function reorderContainer(collection: Collection, containerId: string, orderedIds: string[]): void {
  const container: Container | undefined = containerId === "root" ? collection : findFolder(collection, containerId);
  if (!container) throw new ItemNotFoundError(containerId);

  const currentMembers = container.items.all();
  const currentIds = new Set(currentMembers.map((member) => member.id));
  const orderedIdSet = new Set(orderedIds);
  const isExactPermutation =
    currentIds.size === orderedIds.length &&
    orderedIdSet.size === orderedIds.length &&
    [...currentIds].every((id) => orderedIdSet.has(id));
  if (!isExactPermutation) throw new InvalidOrderError();

  const byId = new Map(currentMembers.map((member) => [member.id, member]));
  container.items.clear();
  for (const id of orderedIds) {
    const member = byId.get(id);
    if (member) container.items.add(member);
  }
}
