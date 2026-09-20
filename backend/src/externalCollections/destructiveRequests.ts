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
export function findDestructiveRequests(collection: Collection): DestructiveOperation[] {
  const found: DestructiveOperation[] = [];
  collection.forEachItem((item: Item) => {
    const method = item.request.method.toUpperCase();
    if (DESTRUCTIVE_METHODS.has(method)) {
      found.push({ operationPath: item.name, operationMethod: method });
    }
  });
  return found;
}
