import type { ExtractedEntry } from "./types";

/**
 * First-party origin scope (specs/056 FR-019, research R12). An origin is related when its site key
 * equals the site key of an anchor: the origin of a page the capture was taken on, or the primary API
 * origin (the origin with the most API-like entries). Every other origin is unrelated third-party.
 * The rule is deterministic and approximate by design: it can exclude a real API on an unrelated
 * domain, which is why every exclusion is reported with its reason.
 */

/** Second-level labels that make a three-label site key (`example.co.uk`). */
const MULTI_PART_SUFFIX_LABELS: ReadonlySet<string> = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The last two host labels, or the last three when the second-level label is a known suffix label. */
export function siteKey(host: string): string {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (IPV4.test(lower) || lower.includes(":") || !lower.includes(".")) return lower;
  const labels = lower.split(".");
  if (labels.length <= 2) return lower;
  const take = MULTI_PART_SUFFIX_LABELS.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export interface OriginScope {
  /** The origin with the most API-like entries (or, with none, the most entries); undefined when there are no candidates. */
  primaryOrigin: string | undefined;
  anchors: ReadonlySet<string>;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `candidates` are the entries that reach rule 11 (not malformed, not excluded by rules 2 to 9), so
 * analytics and static traffic cannot influence the anchors. `pageUrls` are the `log.pages[].title`
 * values; only those that parse as a URL with a host count.
 */
export function computeOriginScope(candidates: readonly ExtractedEntry[], pageUrls: readonly string[]): OriginScope {
  const apiLikeByOrigin = new Map<string, number>();
  const totalByOrigin = new Map<string, number>();
  for (const entry of candidates) {
    totalByOrigin.set(entry.origin, (totalByOrigin.get(entry.origin) ?? 0) + 1);
    if (entry.apiLike) apiLikeByOrigin.set(entry.origin, (apiLikeByOrigin.get(entry.origin) ?? 0) + 1);
  }
  const pick = (counts: Map<string, number>): string | undefined =>
    [...counts.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]?.[0];
  const primaryOrigin = pick(apiLikeByOrigin) ?? pick(totalByOrigin);

  const anchors = new Set<string>();
  for (const title of pageUrls) {
    try {
      const url = new URL(title);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) anchors.add(siteKey(url.hostname));
    } catch {
      // A page title that is not a URL is ordinary text: it names no origin.
    }
  }
  if (primaryOrigin) {
    const host = candidates.find((entry) => entry.origin === primaryOrigin)?.host;
    if (host) anchors.add(siteKey(host));
  }
  return { primaryOrigin, anchors };
}

export function isRelatedOrigin(host: string, scope: OriginScope): boolean {
  return scope.anchors.has(siteKey(host));
}
