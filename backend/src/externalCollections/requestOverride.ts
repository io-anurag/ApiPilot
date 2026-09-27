import type { Collection, Item, ItemGroup } from "postman-collection";
import type { RequestAuthEdit } from "@apipilot/shared-domain";
import { RequestNotFoundError } from "./errors";
import { serializeWithEditMarkers } from "./editedItems";
import { applyRequestAuthEdit } from "./requestAuthEdit";

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
  /** The request's "test" event script (FR-007 extension). See `applyTestScript()` below for its
   * omitted-vs-empty semantics — the same "omitting leaves it untouched" rule `body` already uses. */
  testScript?: string;
  /** The request's own auth (FR-002c, 2026-09-25). Omitting it leaves the request's own auth untouched. */
  auth?: RequestAuthEdit;
}

/**
 * Replaces every existing "test" event on `item` with a single new one carrying `script`'s lines,
 * or removes all "test" events entirely when `script` is empty/whitespace-only (a user clearing
 * the Tests field is expressing "this request has no tests", not "leave it alone" — unlike `body`,
 * a script textarea has no separate absent/empty distinction for the caller to preserve). Omitting
 * `script` from the edit altogether (`undefined`) leaves whatever test event(s) the item already
 * had untouched, mirroring `body`'s own omission rule.
 */
function applyTestScript(item: Item, script: string | undefined): void {
  if (script === undefined) return;
  item.events.remove((event: { listen?: string }) => event.listen === "test", undefined);
  const trimmed = script.trim();
  if (trimmed.length === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Event's own typings model `script` as a live `Script` instance, but its constructor (and PropertyList.add) accepts the same plain `{type, exec}` definition object the SDK's own README documents, matching the `as any` precedent already used for `PropertyList.add()` calls in collectionStructure.ts.
  item.events.add({ listen: "test", script: { type: "text/javascript", exec: script.split(/\r\n|\r|\n/) } } as any);
}

/**
 * Applies a direct field edit (FR-007) to an existing request via `postman-collection`'s own
 * `Request.update()` (research.md D10) — locates the item anywhere in the tree by its stable id
 * (research.md D2), updates its method/URL/headers/body/test-script/auth in place, and marks it edited
 * (`editedItems.ts`, research.md D4/D6). Returns the final JSON string ready to persist. Throws
 * `RequestNotFoundError` if `requestId` doesn't resolve (FR-012's discard-on-mismatch case is the
 * caller's responsibility — this function simply refuses a stale id rather than guessing).
 *
 * Note: omitting `edit.body` leaves the request's existing body untouched rather than clearing it
 * — `Request.update()` only ever merges a *defined* `body` (never treats "absent" as "clear this
 * field"). Clearing a body entirely isn't exposed by this endpoint; only setting/replacing one is.
 */
export function applyRequestOverride(
  collection: Collection,
  requestId: string,
  edit: RequestEditInput,
  /** `findEditedItemIds()` of the stored body `collection` was parsed from — carried over, since
   * parsing drops every existing marker (`serializeWithEditMarkers`). */
  previouslyEditedIds: ReadonlySet<string>,
): string {
  const item = findItem(collection, requestId);
  if (!item) throw new RequestNotFoundError(requestId);

  item.request.update({
    method: edit.method,
    url: edit.url,
    header: edit.headers,
    ...(edit.body !== undefined ? { body: { mode: "raw", raw: edit.body } } : {}),
  });
  applyTestScript(item, edit.testScript);
  if (edit.auth) applyRequestAuthEdit(item, edit.auth);

  return serializeWithEditMarkers(collection, [...previouslyEditedIds, requestId]);
}
