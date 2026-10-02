import type { FindingOwner } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { sha256Hex } from "../plan/identifiers";
import { COLLECTION_REFERENCE } from "./readCollectionRequests";

/**
 * AP-036 (specs/036-collection-performance-test research R11, R12, FR-014 to FR-016): the base URL,
 * literal hosts, credential headers, the names literal credentials are given, and form bodies. Pure;
 * no value is read here, only the collection's text.
 */
export const BASE_URL = "baseUrl";
export const LITERAL_PREFIX = "apipilot_literal_";

/** The `{{name}}` a URL starts with, or `null`. */
export function leadingVariable(url: string): string | null {
  return /^\{\{([^{}]+)\}\}/.exec(url)?.[1] ?? null;
}

/** A URL's literal `host[:port]`, or `null` when it starts with a variable. */
export function literalHost(url: string): string | null {
  if (url.startsWith("{{")) return null;
  return /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1] ?? null;
}

/**
 * R12: the leading `{{name}}` of the most selected requests' URLs; a tie goes to the first in
 * code-unit order. `null` when no URL starts with a variable.
 */
export function baseUrlVariableOf(urls: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const name = leadingVariable(url);
    if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of [...counts].sort(([a], [b]) => compareCodeUnits(a, b))) {
    if (best === null || count > counts.get(best)!) best = name;
  }
  return best;
}

/** R11: the leading base-URL variable written as `{{baseUrl}}`, the one name the runtime leaves unencoded. */
export function withBaseUrl(url: string, baseUrlVariable: string | null): string {
  if (baseUrlVariable === null || leadingVariable(url) !== baseUrlVariable) return url;
  return `{{${BASE_URL}}}${url.slice(baseUrlVariable.length + 4)}`;
}

const NAMED_CREDENTIAL_HEADERS: Readonly<Record<string, string>> = {
  authorization: "Authorization",
  "proxy-authorization": "Proxy-Authorization",
  cookie: "Cookie",
};
const CREDENTIAL_WORDS = ["key", "token", "secret", "password", "auth", "session"] as const;

/**
 * FR-014 (spec Clarifications 2026-10-02): `Authorization`, `Proxy-Authorization`, `Cookie`, and any
 * header whose name contains `key`, `token`, `secret`, `password`, `auth` or `session`, ignoring
 * case. Returns the rule that matched, for the review, or `null`.
 */
export function credentialHeaderRule(name: string): string | null {
  const lower = name.toLowerCase();
  if (NAMED_CREDENTIAL_HEADERS[lower]) return NAMED_CREDENTIAL_HEADERS[lower];
  const word = CREDENTIAL_WORDS.find((candidate) => lower.includes(candidate));
  return word ? `contains "${word}"` : null;
}

function ownerPart(owner: FindingOwner | null): string {
  if (!owner || owner.kind === "collection") return "collection";
  return owner.kind === "folder" ? `folder_${sha256Hex(owner.folderId).slice(0, 8)}` : `request_${sha256Hex(owner.itemId).slice(0, 8)}`;
}

/** R12: the environment name a literal auth field takes, which the plan lists instead of the literal. */
export function literalAuthName(owner: FindingOwner | null, field: string): string {
  return `${LITERAL_PREFIX}${ownerPart(owner)}_${field}`;
}

/** R12: the environment name a credential header's literal takes. */
export function literalHeaderName(itemId: string, header: string): string {
  return `${LITERAL_PREFIX}${ownerPart({ kind: "request", itemId })}_header_${header.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

/** True when `text` is a non-empty literal: it holds no `{{name}}` reference. */
export function isLiteral(text: string): boolean {
  return text.length > 0 && !/\{\{[^{}]+\}\}/.test(text);
}

/** R11: a `urlencoded` body as `key=value&...`, literal text encoded now and references at run time. */
export function renderFormBody(pairs: readonly { key: string; value: string }[]): string {
  const encode = (text: string) => {
    let out = "";
    let last = 0;
    for (const match of text.matchAll(COLLECTION_REFERENCE)) {
      out += encodeURIComponent(text.slice(last, match.index)) + `{{${match[1]}}}`;
      last = match.index + match[0].length;
    }
    return out + encodeURIComponent(text.slice(last));
  };
  return pairs.map((pair) => `${encode(pair.key)}=${encode(pair.value)}`).join("&");
}

/** The names referenced in a URL after its host or leading variable, for the `url-encoding` note (R11). */
export function urlPathReferences(url: string): string[] {
  const leading = leadingVariable(url);
  const rest = leading !== null ? url.slice(leading.length + 4) : url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  return [...rest.matchAll(COLLECTION_REFERENCE)].map((match) => match[1]);
}
