import { getInProgressRun } from "./uploadedCollectionExecutionStore";
import { CollectionLockedError } from "./errors";

/**
 * AP-028 (research.md D11): every mutating collection-editor endpoint — variable update, request
 * field edit, add, delete, rename, reorder — calls this once before applying any change (FR-017).
 * Centralized here rather than duplicated per route so FR-017 actually holds for every mutation
 * kind, not just the ones a route handler remembers to guard.
 */
export function assertCollectionNotRunning(uploadedCollectionSetId: string): void {
  const inProgress = getInProgressRun();
  if (inProgress && inProgress.uploadedCollectionSetId === uploadedCollectionSetId) {
    throw new CollectionLockedError(uploadedCollectionSetId);
  }
}
