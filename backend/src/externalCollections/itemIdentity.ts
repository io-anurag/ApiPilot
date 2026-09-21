import type { Collection } from "postman-collection";

/**
 * `postman-collection`'s own `Item`/`ItemGroup` constructors set `_postman_propertyRequiresId:
 * true` (`item.js`/`item-group.js`) — every request and folder is assigned a stable, random `id`
 * at construction time if the source JSON did not already carry one, and that `id` is a plain
 * enumerable property, so it is included in `.toJSON()` output like any other field
 * (`property-base.js`'s `toJSON()` reduces over `this`'s own properties).
 *
 * Backfilling a stable identity for every request and folder (research.md D2, D9) therefore
 * requires no hand-rolled recursion: parsing the collection through the SDK already assigns the
 * ids in memory. `ensureStableIds` makes that assignment durable by re-serializing the *already
 * parsed* collection back to a JSON string — the persisted string then carries every id
 * permanently, and a later parse of that same string reuses them rather than generating new ones
 * (the constructor's `id = ... || src.id || ...` check prefers an id already present).
 */
export function ensureStableIds(collection: Collection): string {
  return JSON.stringify(collection.toJSON());
}
