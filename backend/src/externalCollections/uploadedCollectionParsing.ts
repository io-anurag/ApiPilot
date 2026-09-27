import type { Collection, Item } from "postman-collection";
import postmanCollection from "postman-collection";
import { InvalidCollectionError, InvalidEnvironmentError } from "./errors";

/**
 * `postman-collection` is CommonJS and re-exports itself via `module.exports = require(...)`
 * (`node_modules/postman-collection/index.js`), which Node's ESM/CJS interop cannot statically
 * analyze into named exports — `import { Collection } from "postman-collection"` throws "does
 * not provide an export named 'Collection'" at runtime despite type-checking cleanly against
 * `@types/postman-collection`. The default-import form above always works because it reads the
 * whole `module.exports` object at runtime instead of relying on static named-export detection.
 */
const CollectionCtor = (postmanCollection as unknown as { Collection: new (definition?: unknown) => Collection })
  .Collection;

/**
 * Constructs a `postman-collection` `Collection` from JSON, without the "at least one request"
 * check `parseUploadedCollection` applies at upload time — used to read back or mutate a
 * collection *already accepted* into storage (AP-028 specs/028-collection-editor-ui), which may
 * legitimately have been edited down to zero requests (spec.md Edge Cases: "the collection is
 * allowed to become empty"; deleting its only request must not make it unreadable). Reuses the
 * real standard implementation (constitution XXVIII) rather than a hand-rolled schema check.
 */
export function parseStoredCollection(raw: string): Collection {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new InvalidCollectionError("the file is not valid JSON.");
  }
  if (typeof parsedJson !== "object" || parsedJson === null) {
    throw new InvalidCollectionError("the file does not contain a Postman collection object.");
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- postman-collection's own constructor accepts any well-formed collection JSON.
    return new CollectionCtor(parsedJson as any);
  } catch (cause) {
    throw new InvalidCollectionError(cause instanceof Error ? cause.message : "the collection could not be parsed.");
  }
}

/**
 * Constructs a `postman-collection` `Collection` from the uploaded JSON and verifies it contains
 * at least one request item, directly or nested in folders (FR-002) — the upload-time acceptance
 * gate. Reuses the real standard implementation (constitution XXVIII) rather than a hand-rolled
 * schema check (research.md D1). Not used to read back an already-stored collection — see
 * `parseStoredCollection` above.
 */
export function parseUploadedCollection(raw: string): Collection {
  const collection = parseStoredCollection(raw);

  let requestItemCount = 0;
  collection.forEachItem(() => {
    requestItemCount += 1;
  });
  if (requestItemCount === 0) {
    throw new InvalidCollectionError("the collection contains no requests (directly or nested in folders).");
  }

  return collection;
}

/** One entry from the uploaded environment's `values` array, after FR-003's structural validation. */
export interface ParsedEnvironmentValue {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * Validates the uploaded environment's shape (FR-003, research.md D2): `values` must be an
 * array whose entries each have a string `key`, and a string `value` for any entry that is not
 * explicitly disabled (`enabled: false`) — a disabled entry's `value` is not required, mirroring
 * how such an entry contributes nothing to `variableValues` either way.
 */
export function parseUploadedEnvironment(raw: string): ParsedEnvironmentValue[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new InvalidEnvironmentError("the file is not valid JSON.");
  }
  if (typeof parsedJson !== "object" || parsedJson === null || !("values" in parsedJson)) {
    throw new InvalidEnvironmentError("the file does not have a 'values' array.");
  }
  const { values } = parsedJson as { values: unknown };
  if (!Array.isArray(values)) {
    throw new InvalidEnvironmentError("'values' must be an array.");
  }

  return values.map((entry, index): ParsedEnvironmentValue => {
    if (typeof entry !== "object" || entry === null) {
      throw new InvalidEnvironmentError(`entry ${index} is not an object.`);
    }
    const { key, value, enabled } = entry as { key?: unknown; value?: unknown; enabled?: unknown };
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidEnvironmentError(`entry ${index} is missing a string 'key'.`);
    }
    const isEnabled = enabled !== false;
    if (isEnabled && typeof value !== "string") {
      throw new InvalidEnvironmentError(`entry ${index} ('${key}') is missing a string 'value'.`);
    }
    return { key, value: typeof value === "string" ? value : "", enabled: isEnabled };
  });
}

const VARIABLE_TOKEN_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function collectVariableTokens(value: unknown, into: Set<string>): void {
  if (value === undefined || value === null) {
    return;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const match of text.matchAll(VARIABLE_TOKEN_PATTERN)) {
    into.add(match[1]);
  }
}

/** Every `{{variableName}}` token found in a single string, deduplicated, in first-seen order. */
export function findVariableTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(VARIABLE_TOKEN_PATTERN)) {
    tokens.add(match[1]);
  }
  return [...tokens];
}

/** `text` with every `{{variable}}` reference removed — whatever remains is literal text. */
export function removeVariableTokens(text: string): string {
  return text.replace(VARIABLE_TOKEN_PATTERN, "");
}

/**
 * Replaces every `{{variableName}}` token in `text` with its value from `variableValues`, when a
 * non-empty value is available — leaves a token with no value (or an empty-string value, treated
 * as not meaningfully supplied, mirroring `execution/variableCompleteness.ts`) intact rather than
 * substituting an empty string, so an unresolved variable stays visibly a placeholder (AP-028
 * FR-002) rather than silently disappearing.
 */
export function substituteVariables(text: string, variableValues: Record<string, string>): string {
  return text.replace(VARIABLE_TOKEN_PATTERN, (match, name: string) =>
    variableValues[name] ? variableValues[name] : match,
  );
}

/**
 * Every `{{variableName}}` token referenced by any request's URL, headers, or body, or its
 * effective `auth` (the item's own, or inherited from a parent folder/the collection — via
 * `Item.getAuth()`, the same lookup Newman's own authorizer uses to sign the request) — not its
 * pre-request/test scripts, which may contain unrelated `{{`-looking text (data-model.md FR-004).
 * Deduplicated, in first-seen order.
 */
export function extractReferencedVariables(collection: Collection): string[] {
  const tokens = new Set<string>();
  collection.forEachItem((item: Item) => {
    const requestJson = item.request.toJSON();
    collectVariableTokens(requestJson.url, tokens);
    collectVariableTokens(requestJson.header, tokens);
    collectVariableTokens(requestJson.body, tokens);
    collectVariableTokens(item.getAuth()?.toJSON(), tokens);
  });
  return [...tokens];
}
