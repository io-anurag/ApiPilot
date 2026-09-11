import newman from "newman";
import type {
  PostmanAuth,
  PostmanCollectionVariable,
  PostmanRequestItem,
} from "@apipilot/shared-domain";
import type { NewmanExecutionResult } from "./mapNewmanResult";

/**
 * Thin wrapper around Newman's Node API: runs exactly one Postman request item (with its already-
 * embedded assertion/extraction scripts) and reports what happened, plus the resulting
 * environment-variable state to carry into the next item (research.md D2).
 */

/**
 * The connection/response timeout for a single request (FR-011 — separate from, and unrelated
 * to, the user-configurable inter-request pacing delay). Not user-configurable.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface NewmanItemRunInput {
  item: PostmanRequestItem;
  /** The collection-level shared auth, if `generateCollection()` hoisted one for this run. */
  collectionAuth: PostmanAuth | undefined;
  /** The collection's declared variables, with real static values already baked in (research.md D1). */
  declaredVariables: PostmanCollectionVariable[];
  /**
   * Accumulated environment values from prior items in this run (workflow handoffs,
   * research.md D2 addendum) — `{}` for the first item.
   */
  environment: Record<string, string>;
}

export interface NewmanItemRunOutput {
  execution: NewmanExecutionResult;
  /** This item's resulting environment values; feed forward as the next item's `environment`. */
  environment: Record<string, string>;
}

/** Runs one Postman request item in isolation and reports its outcome plus updated environment state. */
export function runSingleItem(input: NewmanItemRunInput): Promise<NewmanItemRunOutput> {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        collection: {
          info: { name: "apipilot-execution-item" },
          ...(input.collectionAuth ? { auth: input.collectionAuth } : {}),
          variable: input.declaredVariables,
          item: [input.item],
        },
        environment: {
          values: Object.entries(input.environment).map(([key, value]) => ({
            key,
            value,
            enabled: true,
          })),
        },
        timeoutRequest: REQUEST_TIMEOUT_MS,
        reporters: [],
      },
      (err, summary) => {
        if (err) {
          reject(err);
          return;
        }
        const execution = (summary.run.executions[0] ?? {}) as unknown as NewmanExecutionResult;
        resolve({
          execution,
          environment: summary.environment.toObject(false, true) as Record<string, string>,
        });
      },
    );
  });
}
