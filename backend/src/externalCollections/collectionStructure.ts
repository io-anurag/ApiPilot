import type { Collection, Item, ItemGroup, RequestAuth } from "postman-collection";
import postmanCollection from "postman-collection";
import type { MoveCarried } from "@apipilot/shared-domain";
import { FolderNotFoundError, InvalidMoveError, InvalidOrderError, ItemNotFoundError } from "./errors";

/** Default-import access, for the ESM/CJS interop reason documented in `uploadedCollectionParsing.ts`. */
export const RequestAuthCtor = (postmanCollection as unknown as { RequestAuth: typeof RequestAuth }).RequestAuth;

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
 * Adds a new, empty folder to a chosen parent folder or the collection root — same mechanism as
 * `addRequest`, via the SDK's own `PropertyList.add()`. The SDK's `_createNewGroupedItem` (see
 * `item-group.js`) picks `ItemGroup` over `Item` for a plain object based solely on whether it has
 * a truthy `item` property, so an empty `item: []` array is sufficient to create a folder rather
 * than a request. Throws `FolderNotFoundError` when `parentFolderId` is given but doesn't resolve.
 */
export function addFolder(collection: Collection, parentFolderId: string | null, name: string): { newItemId: string } {
  const target: Container | undefined = parentFolderId === null ? collection : findFolder(collection, parentFolderId);
  if (!target) throw new FolderNotFoundError(parentFolderId ?? "");

  // Same pattern as `addRequest` above: the SDK's runtime `PropertyList.add()` happily accepts a
  // plain object it normalizes itself, but its typings only declare already-constructed
  // `Item`/`ItemGroup` instances.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  target.items.add({ name, item: [] } as any);
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

/** Every folder from the collection root down to (and including) the folder with `id`; `undefined` if none matches. */
function folderPathTo(collection: Collection, id: string): Folder[] | undefined {
  function search(list: Array<Item | Folder>, path: Folder[]): Folder[] | undefined {
    for (const member of list) {
      if (!isFolder(member)) continue;
      const here = [...path, member];
      if (member.id === id) return here;
      const found = search(member.items.all(), here);
      if (found) return found;
    }
    return undefined;
  }
  return search(collection.items.all(), []);
}

/** `auth` when it is a usable auth block — the same test `Item.getAuth()` applies while walking parents. */
function validAuth(auth: RequestAuth | undefined): RequestAuth | undefined {
  return auth && RequestAuthCtor.isValidType(auth.type) ? auth : undefined;
}

/** The auth an item or folder sets on itself (a request keeps it on `request.auth`), ignoring inheritance. */
export function ownAuth(member: Item | Folder): RequestAuth | undefined {
  return validAuth(isFolder(member) ? member.auth : member.request?.auth);
}

/**
 * The nearest auth an item inside `chain` (root → innermost folder) inherits, and the container
 * that provides it — mirrors `Item.getAuth()`'s own parent walk, so it matches what Newman sends.
 */
export function inheritedAuth(collection: Collection, chain: Folder[]): { auth: RequestAuth; source: Container } | undefined {
  for (const folder of [...chain].reverse()) {
    const auth = validAuth(folder.auth);
    if (auth) return { auth, source: folder };
  }
  const collectionAuth = validAuth(collection.auth);
  return collectionAuth ? { auth: collectionAuth, source: collection } : undefined;
}

const COPIED_SCRIPT_MARKER = /^\/\/ Copied by ApiPilot from folder ".*" \(id: ([^)]+)\) when this item was moved\.$/;

/** First line of a script copied onto a moved item (FR-015b): names its folder, and lets a later move detect it. */
function copiedScriptMarker(folder: Folder): string {
  return `// Copied by ApiPilot from folder ${JSON.stringify(folder.name)} (id: ${folder.id}) when this item was moved.`;
}

/** The folder id a script was copied from by a move (FR-015b), read from its marker line; `undefined` for any other script. */
export function copiedScriptSourceFolderId(source: string): string | undefined {
  const firstLine = source.split(/\r\n|\r|\n/, 1)[0] ?? "";
  return COPIED_SCRIPT_MARKER.exec(firstLine)?.[1];
}

const SCRIPT_EVENTS = ["prerequest", "test"] as const;

/**
 * Moves a request or folder into another container ("root" or a folder id) (FR-015a), keeping
 * what it had (FR-015b):
 * - inherited auth the move would change is written onto the item (`noauth` if none applied);
 * - the pre-request/test scripts of every folder it leaves are copied onto it, outermost first,
 *   ahead of its own, each as its own event starting with `copiedScriptMarker`.
 *
 * The folders it leaves are its former ancestors that are not ancestors of the target, so moving
 * into a subfolder copies nothing: those scripts still run there. Only a folder's *own* events are
 * copied (`listenersOwn`), because `listeners()` also pulls in the collection's and outer
 * folders'. The item keeps its instance, so its id and edited marker survive; it lands last among
 * its own kind, matching the tree's folders-then-requests view.
 */
export function moveItem(collection: Collection, itemId: string, targetContainerId: string): MoveCarried {
  const currentContainer = findContainerOf(collection, itemId);
  const member = currentContainer?.items.all().find((entry) => entry.id === itemId);
  if (!currentContainer || !member) throw new ItemNotFoundError(itemId);

  const targetChain = targetContainerId === "root" ? [] : folderPathTo(collection, targetContainerId);
  if (!targetChain) throw new ItemNotFoundError(targetContainerId);
  const target: Container = targetChain.length === 0 ? collection : targetChain[targetChain.length - 1];

  if (target === currentContainer) throw new InvalidMoveError("The item is already in that folder.");
  if (isFolder(member) && targetChain.some((folder) => folder.id === member.id)) {
    throw new InvalidMoveError("A folder cannot be moved into itself or into one of its own subfolders.");
  }

  const currentChain = currentContainer === collection ? [] : (folderPathTo(collection, currentContainer.id) ?? []);
  const leftFolders = currentChain.filter((folder) => !targetChain.some((kept) => kept.id === folder.id));

  let carriedAuth: MoveCarried["auth"] = null;
  if (!ownAuth(member)) {
    const before = inheritedAuth(collection, currentChain);
    const after = inheritedAuth(collection, targetChain);
    if (before?.source !== after?.source) {
      const auth = new RequestAuthCtor(before ? before.auth.toJSON() : { type: "noauth" });
      if (isFolder(member)) member.auth = auth;
      else member.request.auth = auth;
      carriedAuth = {
        type: before ? before.auth.type : "noauth",
        fromFolderName: before && before.source !== collection ? before.source.name : null,
      };
    }
  }

  const copiedEvents: Array<{ listen: string; script: { type: string; exec: string[] } }> = [];
  const scriptsFromFolders: MoveCarried["scriptsFromFolders"] = [];
  for (const folder of leftFolders) {
    const events: Array<(typeof SCRIPT_EVENTS)[number]> = [];
    for (const listen of SCRIPT_EVENTS) {
      for (const event of folder.events.listenersOwn(listen)) {
        const source = event.script?.toSource();
        if (!source || source.trim().length === 0) continue;
        copiedEvents.push({
          listen,
          script: { type: "text/javascript", exec: [copiedScriptMarker(folder), ...source.split(/\r\n|\r|\n/)] },
        });
        if (!events.includes(listen)) events.push(listen);
      }
    }
    if (events.length > 0) scriptsFromFolders.push({ id: folder.id, name: folder.name, events });
  }
  if (copiedEvents.length > 0) {
    const ownEvents = member.events.all();
    member.events.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same plain-definition `add()` pattern as `addRequest` above
    for (const definition of copiedEvents) member.events.add(definition as any);
    for (const event of ownEvents) member.events.add(event);
  }

  // Detached explicitly, as `deleteItem` does: a parsed member's parent link is its folder, not the
  // list, so `PropertyList.insert` would not remove it from the old list by itself. A folder then
  // goes after the target's last folder and a request after everything: each lands last of its kind.
  currentContainer.items.remove((entry: Item | Folder) => entry.id === itemId, undefined);
  if (isFolder(member)) {
    const targetMembers = target.items.all();
    const lastFolderIndex = targetMembers.map((entry) => isFolder(entry)).lastIndexOf(true);
    const before = targetMembers[lastFolderIndex + 1];
    if (before) target.items.insert(member, before);
    else target.items.add(member);
  } else {
    target.items.add(member);
  }

  return { auth: carriedAuth, scriptsFromFolders };
}
