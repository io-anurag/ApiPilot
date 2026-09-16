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
  /**
   * The names of every variable the run's collection/environment declares (values left empty
   * here; real values are supplied separately through `environment` below, and Newman resolves
   * environment scope over collection scope) — research.md D1.
   */
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

/**
 * Newman's module graph is large enough to add noticeable latency to backend startup if pulled in
 * through this module's top-level (static) imports, so it is loaded through a dynamic `import()`
 * instead. The import is kicked off here, once, as soon as this module loads — not deferred until
 * the first `runSingleItem()` call — so it resolves in the background while the process finishes
 * starting up rather than adding load time to the first actual execution request.
 */
const newmanModule = import("newman");

/** Runs one Postman request item in isolation and reports its outcome plus updated environment state. */
export async function runSingleItem(
  input: NewmanItemRunInput,
): Promise<NewmanItemRunOutput> {
  const { default: newman } = await newmanModule;
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
