import type { NotAttemptedReason, PostmanRawItem, UploadedCollectionSet } from "@apipilot/shared-domain";
import type { Collection, Item } from "postman-collection";
import { createLogger } from "../logger";
import { parseUploadedCollection } from "./uploadedCollectionParsing";
import { mapUploadedResult } from "./mapUploadedResult";
import { runSingleItem } from "../execution/newmanRunner";
import { appendResult, isCancelRequested, settleRun } from "./uploadedCollectionExecutionStore";
import { findEditedItemIds } from "./editedItems";
import { updateUploadedCollectionVariables } from "./uploadedCollectionStore";

const logger = createLogger("externalCollections.runUploadedCollectionExecution");

export interface RunUploadedCollectionExecutionInput {
  runId: string;
  uploadedCollection: UploadedCollectionSet;
  /** When provided (a selective run — AP-028 follow-up), only these item ids actually dispatch;
   * everything else in the collection is skipped entirely rather than reported "not-attempted" —
   * a deselected request was never part of this run to begin with. */
  selectedItemIds?: Set<string>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `item.toJSON()`'s runtime shape matches `PostmanRawItem` (research.md D6) — verified against the installed `postman-collection` at design time; this is the one, isolated boundary cast (CLAUDE.md §44). */
function toRawItem(item: Item): PostmanRawItem {
  return item.toJSON() as unknown as PostmanRawItem;
}

/**
 * The item's ancestor folders, root first, as childless Postman folder definitions: only what a
 * folder contributes to its requests (auth, pre-request/test events, protocol profile behavior).
 * Running the item nested inside them is what makes Newman apply folder auth and folder scripts
 * as Postman does (specs/026 FR-008, fixed 2026-09-25); running the bare item skipped them.
 */
function folderChainOf(item: Item, collection: Collection): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  let parent = item.parent();
  while (parent && parent !== collection) {
    const json = parent.toJSON() as Record<string, unknown>;
    chain.unshift({
      name: json.name,
      id: json.id,
      ...(json.auth ? { auth: json.auth } : {}),
      ...(json.event ? { event: json.event } : {}),
      ...(json.protocolProfileBehavior ? { protocolProfileBehavior: json.protocolProfileBehavior } : {}),
    });
    parent = parent.parent();
  }
  return chain;
}

function appendNotAttempted(runId: string, items: Item[], reason: NotAttemptedReason): void {
  const nowIso = new Date().toISOString();
  for (const item of items) {
    appendResult(runId, {
      requestName: item.name,
      requestMethod: item.request.method,
      outcome: "not-attempted",
      notAttemptedReason: reason,
      startedAt: nowIso,
      durationMs: 0,
      testOutcomes: [],
      ...(item.id ? { itemId: item.id } : {}),
    });
  }
}

/**
 * Runs every request in an uploaded collection — or, when `input.selectedItemIds` narrows it to a
 * chosen subset (a Postman-Runner-style selective run), only those — strictly one at a time, in
 * the collection's own document order (FR-005) — walked via `postman-collection`'s own
 * `Collection.forEachItem()` (research.md D6), which visits every request item at any folder
 * nesting depth (the Edge Cases' "nested folders" case). Mirrors `execution/runExecution.ts`'s
 * structure: never throws, settles the run as `completed`/`cancelled` regardless of outcome
 * (constitution XIX).
 */
export async function runUploadedCollectionExecution(input: RunUploadedCollectionExecutionInput): Promise<void> {
  const { runId, uploadedCollection, selectedItemIds } = input;
  const orderedItems: Item[] = [];
  let attempted = 0;

  try {
    const collection = parseUploadedCollection(uploadedCollection.collection);
    collection.forEachItem((item: Item) => {
      if (selectedItemIds && !selectedItemIds.has(item.id)) return;
      orderedItems.push(item);
    });

    const collectionJson = collection.toJSON();
    const collectionAuth = collectionJson.auth;
    const collectionEvents = collectionJson.event;
    const declaredVariables = Object.keys(uploadedCollection.variableValues).map((key) => ({ key, value: "" }));
    let environmentRecord: Record<string, string> = { ...uploadedCollection.variableValues };
    const captureRawDetails = uploadedCollection.tier === "local";
    const editedItemIds = findEditedItemIds(uploadedCollection.collection);

    for (let index = 0; index < orderedItems.length; index += 1) {
      if (isCancelRequested(runId)) {
        appendNotAttempted(runId, orderedItems.slice(index), "cancelled");
        settleRun(runId, "cancelled", "user-requested");
        return;
      }
      if (index > 0 && uploadedCollection.requestDelayMs > 0) {
        await delay(uploadedCollection.requestDelayMs);
        if (isCancelRequested(runId)) {
          appendNotAttempted(runId, orderedItems.slice(index), "cancelled");
          settleRun(runId, "cancelled", "user-requested");
          return;
        }
      }

      const item = orderedItems[index];
      const startedAt = new Date().toISOString();
      const itemOutcome = await runSingleItem({
        item: toRawItem(item),
        collectionAuth,
        collectionEvents,
        folderChain: folderChainOf(item, collection),
        declaredVariables,
        environment: environmentRecord,
      });
      environmentRecord = itemOutcome.environment;
      // A workflow-chaining test script (e.g. `pm.environment.set(...)` capturing a prior step's
      // response) mutates the environment Newman actually resolves requests against. Without
      // writing that mutation back to storage, the collection's persisted `variableValues` — and
      // therefore the "resolved preview" every request view builds from (`collectionView.ts`) —
      // would keep showing whatever was last explicitly saved, silently diverging from the value a
      // later step (in this run or the next one) actually resolves and sends.
      updateUploadedCollectionVariables(uploadedCollection.id, environmentRecord);
      appendResult(
        runId,
        mapUploadedResult(
          item.name,
          item.request.method,
          itemOutcome.execution,
          startedAt,
          captureRawDetails,
          editedItemIds.has(item.id),
          item.id,
        ),
      );
      attempted = index + 1;
    }

    settleRun(runId, "completed");
  } catch (error) {
    logger.error("uploaded_collection_execution_run_error", {
      runId,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    });
    appendNotAttempted(runId, orderedItems.slice(attempted), "run-ended-before-reached");
    settleRun(runId, "completed");
  }
}
