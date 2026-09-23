import type { RawHeader, RawRequestCapture } from "@apipilot/shared-domain";
import {
  isBearerTokenValue,
  isSensitiveFieldName,
  isSensitiveHeaderName,
} from "../testDesign/sensitiveValueDetection";

/**
 * Redaction for failure-analysis evidence (specs/030-ai-failure-analysis research D5, FR-011).
 * Raw captures are stored unredacted, so everything taken from one passes through here before it
 * reaches a prompt, storage, or the UI. Every replaced value is reported back, so model output can
 * be scanned for it afterwards. Detection reuses `sensitiveValueDetection.ts` — never a second
 * denylist.
 */

export const REDACTED = "[redacted]";

/** Values shorter than this are never scanned for in model output, to avoid mangling ordinary text. */
const MIN_SCANNED_VALUE_LENGTH = 3;

const BEARER_IN_TEXT = /\bBearer\s+[^\s"',;]+/gi;
/**
 * Scanned word by word rather than with one combined pattern: a leading `[\w-]*` before a keyword
 * alternation backtracks super-linearly, and this runs over response bodies from an arbitrary
 * target, so it must stay linear in the input length.
 */
const WORD = /[A-Za-z0-9_-]+/g;
const VALUE_AFTER_KEY = /"?\s*[=:]\s*("?)([^&\s"',;]+)/y;

export interface Redacted<T> {
  value: T;
  /** The original values that were replaced. */
  redacted: string[];
}

export function redactHeaders(headers: readonly RawHeader[]): Redacted<RawHeader[]> {
  const redacted: string[] = [];
  const value = headers.map((header) => {
    const sensitive =
      isSensitiveHeaderName(header.key) ||
      isSensitiveFieldName(header.key) ||
      isBearerTokenValue(header.value);
    if (!sensitive || header.value.length === 0) return { ...header };
    redacted.push(header.value);
    const bearer = /^Bearer\s+(\S+)/i.exec(header.value);
    if (bearer) redacted.push(bearer[1]);
    return { key: header.key, value: REDACTED };
  });
  return { value, redacted };
}

function safeDecode(component: string): string {
  try {
    return decodeURIComponent(component.replaceAll("+", " "));
  } catch {
    return component;
  }
}

/** Redacts user-info passwords and the values of query parameters with sensitive names. */
export function redactUrl(url: string): Redacted<string> {
  const redacted: string[] = [];
  let working = url;

  const userInfo = /^([a-z][a-z0-9+.-]*:\/\/)([^/@:]+):([^/@]+)@/i.exec(working);
  if (userInfo) {
    redacted.push(safeDecode(userInfo[3]));
    working = working.replace(userInfo[0], `${userInfo[1]}${userInfo[2]}:${REDACTED}@`);
  }

  const hashIndex = working.indexOf("#");
  const fragment = hashIndex >= 0 ? working.slice(hashIndex) : "";
  const withoutFragment = hashIndex >= 0 ? working.slice(0, hashIndex) : working;
  const queryIndex = withoutFragment.indexOf("?");
  if (queryIndex < 0) return { value: working, redacted };

  const base = withoutFragment.slice(0, queryIndex);
  const pairs = withoutFragment
    .slice(queryIndex + 1)
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      if (equals < 0) return pair;
      const key = pair.slice(0, equals);
      const rawValue = pair.slice(equals + 1);
      if (!isSensitiveFieldName(safeDecode(key)) || rawValue.length === 0) return pair;
      redacted.push(safeDecode(rawValue));
      return `${key}=${REDACTED}`;
    });
  return { value: `${base}?${pairs.join("&")}${fragment}`, redacted };
}

function collectLeaves(value: unknown, into: string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectLeaves(entry, into);
  } else if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) collectLeaves(entry, into);
  } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    if (text.length > 0) into.push(text);
  }
}

function redactJsonValue(value: unknown, redacted: string[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry, redacted));
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveFieldName(key) && entry !== null && entry !== undefined) {
        collectLeaves(entry, redacted);
        output[key] = REDACTED;
      } else {
        output[key] = redactJsonValue(entry, redacted);
      }
    }
    return output;
  }
  if (typeof value === "string" && isBearerTokenValue(value)) {
    redacted.push(value);
    return REDACTED;
  }
  return value;
}

function redactSensitivePairs(text: string, redacted: string[]): string {
  let output = "";
  let copiedUpTo = 0;
  for (const word of text.matchAll(WORD)) {
    if (!isSensitiveFieldName(word[0])) continue;
    const wordEnd = (word.index ?? 0) + word[0].length;
    if (wordEnd < copiedUpTo) continue;
    VALUE_AFTER_KEY.lastIndex = wordEnd;
    const pair = VALUE_AFTER_KEY.exec(text);
    if (!pair || pair[2] === REDACTED) continue;
    const valueStart = VALUE_AFTER_KEY.lastIndex - pair[2].length;
    redacted.push(pair[2]);
    output += text.slice(copiedUpTo, valueStart) + REDACTED;
    copiedUpTo = VALUE_AFTER_KEY.lastIndex;
  }
  return output + text.slice(copiedUpTo);
}

function redactText(text: string, redacted: string[]): string {
  const withoutBearer = text.replace(BEARER_IN_TEXT, (match) => {
    redacted.push(match.replace(/^Bearer\s+/i, ""));
    return `Bearer ${REDACTED}`;
  });
  return redactSensitivePairs(withoutBearer, redacted);
}

export interface RedactedExcerpt {
  text: string;
  truncated: boolean;
  redacted: string[];
}

/** Redacts a captured body, then truncates it to `limit` characters (truncation never exposes a value redaction would have hidden). */
export function redactBody(body: string, limit: number): RedactedExcerpt {
  const redacted: string[] = [];
  let text: string;
  try {
    text = JSON.stringify(redactJsonValue(JSON.parse(body) as unknown, redacted));
  } catch {
    text = redactText(body, redacted);
  }
  if (text.length <= limit) return { text, truncated: false, redacted };
  return { text: text.slice(0, limit), truncated: true, redacted };
}

/** Redacts free text such as a test-failure message. */
export function redactFreeText(text: string): Redacted<string> {
  const redacted: string[] = [];
  return { value: redactText(text, redacted), redacted };
}

/** Every value redaction would replace anywhere in a raw capture, independent of truncation. */
export function collectRedactedValues(capture: RawRequestCapture): string[] {
  const unlimited = Number.POSITIVE_INFINITY;
  return [
    ...redactUrl(capture.requestUrl).redacted,
    ...redactHeaders(capture.requestHeaders).redacted,
    ...redactHeaders(capture.responseHeaders).redacted,
    ...(capture.requestBody ? redactBody(capture.requestBody, unlimited).redacted : []),
    ...(capture.responseBody ? redactBody(capture.responseBody, unlimited).redacted : []),
  ];
}

/** Replaces every occurrence of a known sensitive value, and any bearer token, in model output. */
export function scanOutput(text: string, sensitiveValues: readonly string[]): string {
  const values = [...new Set(sensitiveValues)]
    .filter((value) => value.length >= MIN_SCANNED_VALUE_LENGTH && value !== REDACTED)
    .sort((a, b) => b.length - a.length);
  let output = text;
  for (const value of values) output = output.split(value).join(REDACTED);
  return redactText(output, []);
}

/** The values of collection/environment variables whose names mark them as credentials. */
export function sensitiveVariableValues(variables: Readonly<Record<string, string>> | undefined): string[] {
  if (!variables) return [];
  return Object.entries(variables)
    .filter(([name, value]) => isSensitiveFieldName(name) && value.length > 0)
    .map(([, value]) => value);
}
