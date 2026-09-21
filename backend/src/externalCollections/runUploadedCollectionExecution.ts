import type { NotAttemptedReason, PostmanRawItem, UploadedCollectionSet } from "@apipilot/shared-domain";
import type { Item } from "postman-collection";
import { createLogger } from "../logger";
import { parseUploadedCollection } from "./uploadedCollectionParsing";
import { mapUploadedResult } from "./mapUploadedResult";
import { runSingleItem } from "../execution/newmanRunner";
import { appendResult, isCancelRequested, settleRun } from "./uploadedCollectionExecutionStore";
import { findEditedItemIds } from "./editedItems";

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

    const collectionAuth = collection.toJSON().auth;
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
        declaredVariables,
        environment: environmentRecord,
      });
      environmentRecord = itemOutcome.environment;
      appendResult(
        runId,
        mapUploadedResult(
          item.name,
          item.request.method,
          itemOutcome.execution,
          startedAt,
          captureRawDetails,
          editedItemIds.has(item.id),
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
