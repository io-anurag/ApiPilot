import { Collection, type Item } from "postman-collection";
import { InvalidCollectionError, InvalidEnvironmentError } from "./errors";

/**
 * Constructs a `postman-collection` `Collection` from the uploaded JSON and verifies it contains
 * at least one request item, directly or nested in folders (FR-002). Reuses the real standard
 * implementation (constitution XXVIII) rather than a hand-rolled schema check (research.md D1).
 */
export function parseUploadedCollection(raw: string): Collection {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new InvalidCollectionError("the file is not valid JSON.");
  }
  if (typeof parsedJson !== "object" || parsedJson === null) {
    throw new InvalidCollectionError("the file does not contain a Postman collection object.");
  }

  let collection: Collection;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- postman-collection's own constructor accepts any well-formed collection JSON; validity is judged by whether it yields any request items below, not by this constructor call alone.
    collection = new Collection(parsedJson as any);
  } catch (cause) {
    throw new InvalidCollectionError(cause instanceof Error ? cause.message : "the collection could not be parsed.");
  }

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

/**
 * Every `{{variableName}}` token referenced by any request's URL, headers, or body — not its
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
  });
  return [...tokens];
}

/**
 * Every referenced variable (FR-004) the given `variableValues` does not supply a non-empty
 * value for. Deliberately **not** `execution/variableCompleteness.ts`'s `missingVariableValues()`
 * — that function hardcodes excluding `"baseUrl"` because the generated-collection flow supplies
 * it via `Environment.baseUrl`, a separate field `UploadedCollectionSet` has no equivalent of; an
 * uploaded collection's own `{{baseUrl}}` reference is validated like any other variable here.
 */
export function missingUploadedVariableValues(
  referencedVariables: string[],
  variableValues: Record<string, string>,
): string[] {
  return referencedVariables.filter((name) => !variableValues[name]);
}
