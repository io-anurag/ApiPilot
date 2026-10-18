import { createHash } from "node:crypto";
import { MAX_LEAF_VALUES_PER_BODY } from "../limits";
import { classifyFieldName, classifyHeader, classifyValue } from "../redaction";
import { ownEntries } from "../jsonSafe";

/**
 * Value evidence for dependency detection (specs/056 FR-038, research R19). It is harvested inside
 * `extractEntry`, before redaction, so a credential used in one request and returned by another can
 * still be linked. What leaves this module is a one-way digest and, only when the value is plainly not
 * sensitive, a short sample: the value itself is never kept for a credential, an email address or a
 * credential-named field.
 */

export interface ValueRecord {
  /** First 16 hex characters of sha256 of the value's text. */
  digest: string;
  /** Dotted field path (response or request body), query parameter name, lower-case header name, or the path segment index. */
  field: string;
  /** A string of at least 8 characters, or an integer of at least 4 digits, not on the stoplist. */
  distinctive: boolean;
  /** At most 32 characters, and only when `withheld` is false. */
  sample?: string;
  withheld: boolean;
}

export type ConsumerValueRecord = ValueRecord & { location: "path" | "query" | "header" | "body" };

const STOPLIST: ReadonlySet<string> = new Set([
  "application/json", "application/xml", "application/octet-stream", "text/plain", "text/html",
  "multipart/form-data", "application/x-www-form-urlencoded", "undefined",
]);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_SAMPLE_LENGTH = 32;
const MAX_DISTINCTIVE_VALUES = 100;

export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** A string of at least 8 characters (or a text of at least 4 digits), or an integer of at least 4 digits; never a boolean or null. */
export function isDistinctive(value: unknown): value is string | number {
  if (typeof value === "string") return (value.length >= 8 || /^\d{4,}$/.test(value)) && !STOPLIST.has(value.toLowerCase());
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) >= 1000;
  return false;
}

function recordOf(field: string, value: string | number, nameIsCredential: boolean): ValueRecord {
  const text = String(value);
  const withheld = nameIsCredential || classifyValue(text) !== undefined || EMAIL.test(text);
  return {
    digest: digestOf(text),
    field,
    distinctive: true,
    withheld,
    ...(withheld ? {} : { sample: text.slice(0, MAX_SAMPLE_LENGTH) }),
  };
}

/** The distinctive scalar leaves of a parsed body, as records. Arrays are not walked (the existing dependency analysis does not walk them either). */
export function harvestBodyValues(body: unknown): ValueRecord[] {
  const records: ValueRecord[] = [];
  let visited = 0;
  const walk = (value: unknown, path: string, depth: number): void => {
    if (visited >= MAX_LEAF_VALUES_PER_BODY || records.length >= MAX_DISTINCTIVE_VALUES || depth > 32) return;
    visited += 1;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of ownEntries(value)) walk(child, path === "" ? key : `${path}.${key}`, depth + 1);
      return;
    }
    if (path !== "" && isDistinctive(value)) records.push(recordOf(path, value, classifyFieldName(path.split(".").at(-1) ?? path) !== undefined));
  };
  walk(body, "", 0);
  return records;
}

export function harvestQueryValues(query: readonly { name: string; value: string }[]): ConsumerValueRecord[] {
  return query
    .filter((param) => isDistinctive(param.value))
    .slice(0, MAX_DISTINCTIVE_VALUES)
    .map((param) => ({ ...recordOf(param.name, param.value, classifyFieldName(param.name) !== undefined), location: "query" as const }));
}

/** Header values; the scheme of `Authorization: Bearer <token>` is stripped so the token itself can be matched. */
export function harvestHeaderValues(headers: Readonly<Record<string, string>>, isNoise: (lowerName: string) => boolean): ConsumerValueRecord[] {
  const records: ConsumerValueRecord[] = [];
  for (const [name, raw] of Object.entries(headers)) {
    if (records.length >= MAX_DISTINCTIVE_VALUES) break;
    if (isNoise(name) || name === "cookie") continue;
    const value = raw.replace(/^(?:Bearer|Token)\s+/i, "");
    if (!isDistinctive(value)) continue;
    records.push({ ...recordOf(name, value, classifyHeader(name, raw) !== undefined), location: "header" });
  }
  return records;
}

/** Path segments by their index in the normalized path; the detector maps an index to a parameter name. */
export function harvestPathValues(path: string): ConsumerValueRecord[] {
  return path
    .split("/")
    .slice(1)
    .flatMap((segment, index) => (isDistinctive(segment) ? [{ ...recordOf(String(index), segment, false), location: "path" as const }] : []));
}
