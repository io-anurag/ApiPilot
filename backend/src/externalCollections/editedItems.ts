/**
 * `postman-collection`'s `Item`/`ItemGroup` constructors copy only the fields they recognize
 * (`_.mergeDefined` in `item.js`/`item-group.js`) — an unrecognized property like `_apipilotEdited`
 * set on the source JSON is silently dropped the moment the SDK parses it, and is therefore gone
 * again by the time `.toJSON()` re-serializes the parsed object. The SDK has no "this request was
 * user-edited" concept of its own to preserve.
 *
 * `_apipilotEdited` (research.md D4, D6) is therefore tracked by operating on the collection's
 * *plain* JSON tree directly — reading and writing this one marker never goes through the SDK's
 * typed object model, while every structural/field mutation itself still does (research.md D10).
 * This is a small, bounded post-processing step over the SDK's own `.toJSON()` output, not a
 * parallel hand-rolled structural editor.
 */

interface RawItemNode {
  id?: unknown;
  item?: unknown;
  _apipilotEdited?: unknown;
  [key: string]: unknown;
}

function walkItems(items: unknown, visit: (node: RawItemNode) => void): void {
  if (!Array.isArray(items)) return;
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const node = entry as RawItemNode;
    visit(node);
    if (Array.isArray(node.item)) walkItems(node.item, visit);
  }
}

/** Every item id (request or folder) marked `_apipilotEdited: true` anywhere in the stored collection JSON. */
export function findEditedItemIds(rawCollectionJson: string): Set<string> {
  const ids = new Set<string>();
  let parsed: { item?: unknown };
  try {
    parsed = JSON.parse(rawCollectionJson) as { item?: unknown };
  } catch {
    return ids; // malformed JSON is validated/refused elsewhere; nothing to report here.
  }
  walkItems(parsed.item, (node) => {
    if (node._apipilotEdited === true && typeof node.id === "string") ids.add(node.id);
  });
  return ids;
}

/**
 * Marks one item (by its stable id, research.md D2/D9) as edited, directly on an already-built
 * plain JSON collection tree (e.g. the output of `collection.toJSON()`) — mutates and returns the
 * same object. No-op if `itemId` isn't found (callers validate existence beforehand via the SDK).
 */
export function markItemEdited(collectionJsonObject: unknown, itemId: string): unknown {
  const root = collectionJsonObject as { item?: unknown };
  walkItems(root.item, (node) => {
    if (node.id === itemId) {
      node._apipilotEdited = true;
    }
  });
  return collectionJsonObject;
}
