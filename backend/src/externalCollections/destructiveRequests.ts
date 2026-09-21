import type { Collection, Item } from "postman-collection";
import type { DestructiveOperation } from "../execution/destructiveOperations";
import { DESTRUCTIVE_METHODS } from "../execution/destructiveOperations";

/**
 * Every request in `collection` whose method is destructive (FR-013), found by
 * `Collection.forEachItem()` at any folder nesting depth — a Postman request always specifies
 * its own method directly, so no `ApiModel` is needed to classify it (research.md D3).
 *
 * Reuses the exact same `DestructiveOperation` shape (`operationPath`/`operationMethod`) the
 * `ApiModel`-based path already returns, so `ExecutionConfirmationRequirement`'s response
 * envelope is genuinely identical for both gates (contracts/external-collections-api.md) — here,
 * `operationPath` carries the request's own name (there is no OpenAPI path to report instead).
 */
/**
 * @param selectedItemIds When provided (a selective run — AP-028 follow-up), only items in this
 * set are considered; an item excluded from the run can't warrant a destructive-request warning
 * for a run it isn't part of.
 */
export function findDestructiveRequests(collection: Collection, selectedItemIds?: Set<string>): DestructiveOperation[] {
  const found: DestructiveOperation[] = [];
  collection.forEachItem((item: Item) => {
    if (selectedItemIds && !selectedItemIds.has(item.id)) return;
    const method = item.request.method.toUpperCase();
    if (DESTRUCTIVE_METHODS.has(method)) {
      found.push({ operationPath: item.name, operationMethod: method });
    }
  });
  return found;
}
