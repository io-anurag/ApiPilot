import type { Collection, Item } from "postman-collection";
import { InvalidRunOrderError, NoRequestsSelectedError } from "./errors";

/**
 * Validates `execution/start`'s `selectedRequestIds` and returns it as the run order (specs/026
 * FR-018, FR-019): the chosen requests run in the order listed, not the collection's own order.
 *
 * Returns `undefined` when the field is not an array, so the run covers every request in the
 * collection's own order, exactly as before the field existed. Invalid entries are refused rather
 * than dropped, because dropping one would run a different order from the one the user set.
 *
 * @throws InvalidRunOrderError for a non-string entry, a repeated id, or an id the collection does
 * not contain while at least one id matches.
 * @throws NoRequestsSelectedError when no id names one of the collection's requests (FR-018).
 */
export function resolveRunOrder(collection: Collection, selectedRequestIds: unknown): string[] | undefined {
  if (!Array.isArray(selectedRequestIds)) return undefined;

  const entries: unknown[] = selectedRequestIds;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") throw new InvalidRunOrderError("selectedRequestIds must contain only request ids.");
    if (seen.has(entry)) throw new InvalidRunOrderError(`Request '${entry}' appears more than once in the run order.`);
    seen.add(entry);
    ids.push(entry);
  }

  const requestIds = new Set<string>();
  collection.forEachItem((item: Item) => {
    requestIds.add(item.id);
  });
  const unknown = ids.filter((id) => !requestIds.has(id));
  if (unknown.length === ids.length) throw new NoRequestsSelectedError();
  if (unknown.length > 0) {
    throw new InvalidRunOrderError(`The collection has no request with id '${unknown[0]}'.`);
  }
  return ids;
}
