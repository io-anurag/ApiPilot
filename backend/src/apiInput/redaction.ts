import type { CredentialKind, CredentialObservation } from "@apipilot/shared-domain";
import {
  credentialKindForField,
  credentialKindForHeader,
  formatRedactionPlaceholder,
  isSensitiveFieldName,
} from "../testDesign/sensitiveValueDetection";
import { ownEntries, toPlainRecord } from "./jsonSafe";

/**
 * Credential redaction for captured traffic and declared examples (specs/056 FR-047, research R18).
 *
 * It runs at extraction, before a value is retained anywhere, and writes `[redacted:<kind>]` in place
 * of a credential. Detection reuses the existing predicates in `testDesign/sensitiveValueDetection.ts`
 * (one definition of "this is a credential") and adds only what captured traffic carries that an
 * OpenAPI document does not: extra header and field names, a few high-confidence value shapes, URL
 * userinfo and cookies.
 */

export type RedactionLocation = CredentialObservation["location"];

/** Header names beyond the existing predicate that carry credentials in captured traffic. */
const EXTRA_HEADER_NAMES: ReadonlySet<string> = new Set([
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-amz-security-token",
]);

/** Exact (case-insensitive) field names that are credentials but do not match the generic name pattern. */
const EXACT_FIELD_KINDS: Readonly<Record<string, CredentialKind>> = {
  key: "apiKey",
  sig: "token",
  signature: "token",
  sid: "session",
  sessionid: "session",
  session: "session",
  jsessionid: "session",
  auth: "token",
  authorization: "token",
  jwt: "token",
  cookie: "cookie",
  cookies: "cookie",
  code: "token",
};

const JWT_VALUE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const BEARER_VALUE = /^Bearer\s+\S+$/i;
const BASIC_VALUE = /^Basic\s+[A-Za-z0-9+/=]+$/;
const AWS_ACCESS_KEY_VALUE = /^AKIA[A-Z0-9]{16}$/;

const MAX_REDACTION_DEPTH = 64;

/** Locale-independent ordering by code unit, so output never depends on the machine (FR-022). */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
const MAX_OBSERVATION_NAME_LENGTH = 100;

/** A value that is a credential by its shape alone (high confidence only), or undefined. */
export function classifyValue(value: string): CredentialKind | undefined {
  if (JWT_VALUE.test(value) || BEARER_VALUE.test(value)) return "token";
  if (BASIC_VALUE.test(value)) return "password";
  if (AWS_ACCESS_KEY_VALUE.test(value)) return "apiKey";
  return undefined;
}

/** A field or parameter that is a credential by its name alone, or undefined. */
export function classifyFieldName(name: string): CredentialKind | undefined {
  const exact = EXACT_FIELD_KINDS[name.toLowerCase()];
  if (exact !== undefined) return exact;
  if (isSensitiveFieldName(name)) return credentialKindForField(name, undefined);
  return undefined;
}

/** A header that carries a credential by name or by value, or undefined. */
export function classifyHeader(name: string, value: string): CredentialKind | undefined {
  const lower = name.toLowerCase();
  if (lower === "cookie" || lower === "set-cookie") return "cookie";
  if (lower === "authorization" || lower === "proxy-authorization") {
    return BASIC_VALUE.test(value) ? "password" : "token";
  }
  const existing = credentialKindForHeader(name, value);
  if (existing !== undefined) return existing;
  if (EXTRA_HEADER_NAMES.has(lower)) return "token";
  if (isSensitiveFieldName(lower)) return credentialKindForField(lower, value);
  return classifyValue(value);
}

/**
 * Records, per entry, which credentials were seen (location, name, kind) without any value. An entry
 * that carries the same credential twice counts once, so `observations` counts entries (FR-028).
 */
export class CredentialCollector {
  private readonly seen = new Map<string, { location: RedactionLocation; name: string; kind: CredentialKind }>();

  record(location: RedactionLocation, name: string, kind: CredentialKind): void {
    const safeName = name.slice(0, MAX_OBSERVATION_NAME_LENGTH);
    this.seen.set(`${location}\u0000${safeName}\u0000${kind}`, { location, name: safeName, kind });
  }

  /** The distinct credentials seen, in a stable order. */
  list(): { location: RedactionLocation; name: string; kind: CredentialKind }[] {
    return [...this.seen.values()].sort(
      (a, b) => compare(a.location, b.location) || compare(a.name, b.name) || compare(a.kind, b.kind),
    );
  }
}

/** The header value to keep: unchanged unless the header carries a credential. */
export function redactHeaderValue(name: string, value: string, collector: CredentialCollector): string {
  if (value === "") return value;
  const kind = classifyHeader(name, value);
  if (kind === undefined) return value;
  collector.record(name.toLowerCase() === "cookie" || name.toLowerCase() === "set-cookie" ? "cookie" : "header", name.toLowerCase(), kind);
  return formatRedactionPlaceholder(kind);
}

/**
 * The value to keep for a named query, form, cookie or JSON-body field. A credential-named field has
 * its whole value replaced (a nested object is replaced too, not walked); any other object or array
 * is walked; a string that is a credential by shape is replaced.
 */
export function redactNamedValue(
  location: Exclude<RedactionLocation, "header" | "url-userinfo">,
  name: string,
  value: unknown,
  collector: CredentialCollector,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  const byName = classifyFieldName(name);
  if (typeof value === "string") {
    if (value === "") return value;
    const kind = byName ?? classifyValue(value);
    if (kind === undefined) return value;
    collector.record(location, name, kind);
    return formatRedactionPlaceholder(kind);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (byName === undefined) return value;
    collector.record(location, name, byName);
    return formatRedactionPlaceholder(byName);
  }
  if (byName !== undefined) {
    collector.record(location, name, byName);
    return formatRedactionPlaceholder(byName);
  }
  return redactJsonValue(value, collector, location === "cookie" ? "body" : location, depth + 1);
}

/** Walks parsed JSON, replacing credential values and keeping the structure. Never throws on odd input. */
export function redactJsonValue(
  value: unknown,
  collector: CredentialCollector,
  location: Exclude<RedactionLocation, "header" | "url-userinfo" | "cookie"> = "body",
  depth = 0,
): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[too-deep]";
  if (Array.isArray(value)) return value.map((item) => redactArrayItem(item, collector, location, depth));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of ownEntries(value)) {
      out[key] = redactNamedValue(location, key, child, collector, depth);
    }
    return toPlainRecord(out);
  }
  if (typeof value === "string") {
    const kind = classifyValue(value);
    if (kind === undefined) return value;
    collector.record(location, "(value)", kind);
    return formatRedactionPlaceholder(kind);
  }
  return value;
}

function redactArrayItem(
  item: unknown,
  collector: CredentialCollector,
  location: Exclude<RedactionLocation, "header" | "url-userinfo" | "cookie">,
  depth: number,
): unknown {
  return redactJsonValue(item, collector, location, depth + 1);
}

/** Removes `user:password@` from a URL string. Never returns the userinfo. */
export function redactUrl(url: string): { url: string; userinfoRemoved: boolean } {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/s.exec(url);
  if (!match) return { url, userinfoRemoved: false };
  const [, scheme, authority, rest] = match;
  const at = authority.lastIndexOf("@");
  if (at < 0) return { url, userinfoRemoved: false };
  return { url: `${scheme}${authority.slice(at + 1)}${rest}`, userinfoRemoved: true };
}
