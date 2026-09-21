import type { Collection, Item, ItemGroup } from "postman-collection";
import { RequestNotFoundError } from "./errors";
import { markItemEdited } from "./editedItems";

type Folder = ItemGroup<Item>;

function isFolder(member: Item | Folder): member is Folder {
  return "items" in member && member.items !== undefined;
}

function findItem(collection: Collection, id: string): Item | undefined {
  function search(list: Array<Item | Folder>): Item | undefined {
    for (const member of list) {
      if (isFolder(member)) {
        const found = search(member.items.all());
        if (found) return found;
      } else if (member.id === id) {
        return member;
      }
    }
    return undefined;
  }
  return search(collection.items.all());
}

export interface RequestEditInput {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
}

/**
 * Applies a direct field edit (FR-007) to an existing request via `postman-collection`'s own
 * `Request.update()` (research.md D10) — locates the item anywhere in the tree by its stable id
 * (research.md D2), updates its method/URL/headers/body in place, and marks it edited
 * (`editedItems.ts`, research.md D4/D6). Returns the final JSON string ready to persist. Throws
 * `RequestNotFoundError` if `requestId` doesn't resolve (FR-012's discard-on-mismatch case is the
 * caller's responsibility — this function simply refuses a stale id rather than guessing).
 *
 * Note: omitting `edit.body` leaves the request's existing body untouched rather than clearing it
 * — `Request.update()` only ever merges a *defined* `body` (never treats "absent" as "clear this
 * field"). Clearing a body entirely isn't exposed by this endpoint; only setting/replacing one is.
 */
export function applyRequestOverride(collection: Collection, requestId: string, edit: RequestEditInput): string {
  const item = findItem(collection, requestId);
  if (!item) throw new RequestNotFoundError(requestId);

  item.request.update({
    method: edit.method,
    url: edit.url,
    header: edit.headers,
    ...(edit.body !== undefined ? { body: { mode: "raw", raw: edit.body } } : {}),
  });

  const json = collection.toJSON();
  markItemEdited(json, requestId);
  return JSON.stringify(json);
}
