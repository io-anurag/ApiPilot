import type {
  PostmanCollectionVariable,
  PostmanRawItem,
  PostmanRequestItem,
} from "@apipilot/shared-domain";
import type { EventDefinition, ItemDefinition, ItemGroupDefinition } from "postman-collection";
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
  /**
   * `PostmanRawItem` (research.md D6, specs/026-external-collection-execution) is accepted
   * alongside the generator-only `PostmanRequestItem`: an uploaded collection's own item may
   * carry a `"prerequest"` event, a non-`"raw"` body mode, or an auth scheme `PostmanRequestItem`
   * cannot represent. This is a type-only widening — `newman.run()` already accepts either shape
   * as plain JSON, so the dispatch logic below is unchanged.
   */
  item: PostmanRequestItem | PostmanRawItem;
  /**
   * The collection-level shared auth, if `generateCollection()` hoisted one for this run, or —
   * for an uploaded collection (specs/026-external-collection-execution) — whatever `auth` object
   * `postman-collection` itself parsed off the uploaded collection's `info`/top level, so an item
   * that relies on inheriting collection-level auth (a common authored pattern this codebase's
   * own `PostmanAuth` union does not need to model) still authenticates correctly. Untyped
   * (`unknown`) rather than widened to a second closed union, since this is passed straight
   * through to `newman.run()` as plain JSON either way (research.md D6) — `PostmanAuth` remains
   * the typed vocabulary for what ApiPilot's own generator hoists.
   */
  collectionAuth: unknown;
  /**
   * The names of every variable the run's collection/environment declares (values left empty
   * here; real values are supplied separately through `environment` below, and Newman resolves
   * environment scope over collection scope) — research.md D1.
   */
  declaredVariables: PostmanCollectionVariable[];
  /**
   * Accumulated environment values from prior items in this run (workflow handoffs,
   * research.md D2 addendum) — `{}` for the first item. Values are whatever the scripts set
   * (a number, an object, ...), passed on unchanged so the next item's scripts see the same value.
   */
  environment: Record<string, unknown>;
  /**
   * The item's ancestor folders, root first, each as its own Postman folder definition without
   * children (`name`, `id`, `auth`, `event`). The item runs nested inside them, so Newman applies
   * folder auth and folder scripts exactly as Postman does (specs/026 FR-008, fixed 2026-09-25).
   * Omitted for ApiPilot's own generated items, which carry everything on the item itself.
   */
  folderChain?: ReadonlyArray<Record<string, unknown>>;
  /** The collection's own `event` array (collection-level pre-request/test scripts), passed as is. */
  collectionEvents?: EventDefinition[];
}

export interface NewmanItemRunOutput {
  execution: NewmanExecutionResult;
  /** This item's resulting environment values; feed forward as the next item's `environment`.
   * Not all strings: a script can set any value (`toStoredVariableValues` before storing them). */
  environment: Record<string, unknown>;
}

/**
 * Newman's module graph is large enough to add noticeable latency to backend startup if pulled in
 * through this module's top-level (static) imports, so it is loaded through a dynamic `import()`
 * instead. The import is kicked off here, once, as soon as this module loads — not deferred until
 * the first `runSingleItem()` call — so it resolves in the background while the process finishes
 * starting up rather than adding load time to the first actual execution request.
 */
const newmanModule = import("newman");

/**
 * Wraps `item` in its folder chain (root first), innermost folder closest to the item. The result
 * is plain Postman JSON that Newman parses itself, hence the one boundary cast to its definition
 * types (CLAUDE.md §44).
 */
function nestInFolders(
  item: PostmanRequestItem | PostmanRawItem,
  folderChain: ReadonlyArray<Record<string, unknown>>,
): ItemDefinition | ItemGroupDefinition {
  return folderChain.reduceRight<unknown>((child, folder) => ({ ...folder, item: [child] }), item) as
    | ItemDefinition
    | ItemGroupDefinition;
}

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
          ...(input.collectionEvents ? { event: input.collectionEvents } : {}),
          variable: input.declaredVariables,
          item: [nestInFolders(input.item, input.folderChain ?? [])],
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
          environment: summary.environment.toObject(false, true),
        });
      },
    );
  });
}
