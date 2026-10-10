import type { RecentRequest } from "@apipilot/shared-domain";
import { LIVE_RECENT_REQUEST_LIMIT } from "@apipilot/shared-domain";

/**
 * The latest completed requests for the live dashboard (AP-045 research R5, R6, R12): a fixed-size
 * newest-first ring, not a log. An entry holds only a step name, method, path template, status and
 * duration; there is no field in which a header, cookie, token, query string or body could be kept.
 */
export interface RecentRing {
  push(entry: RecentRequest): void;
  /** Newest first. */
  list(): RecentRequest[];
}

export function createRecentRing(capacity: number = LIVE_RECENT_REQUEST_LIMIT): RecentRing {
  const entries: RecentRequest[] = [];
  return {
    push(entry) {
      entries.unshift({
        second: entry.second,
        chain: entry.chain,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        failed: entry.failed,
        durationMs: entry.durationMs,
      });
      if (entries.length > capacity) entries.length = capacity;
    },
    list: () => entries.map((entry) => ({ ...entry })),
  };
}

/**
 * The path part of a URL or URL template, with the scheme, user info, host, query and fragment
 * removed. A leading `{{variable}}` (the base URL reference) is dropped, and other `{{references}}`
 * stay as written, never resolved.
 */
export function pathOfTemplate(template: string): string {
  let rest = template.trim();
  rest = rest.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#{]*/, "");
  rest = rest.replace(/^\{\{[^}]*\}\}/, "");
  rest = rest.split(/[?#]/)[0] ?? "";
  if (rest === "") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** An absolute URL's display path: no scheme, user info, query or fragment. A non-URL is returned without query or fragment. */
export function pathOfUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    try {
      pathname = decodeURI(pathname);
    } catch {
      // keep the encoded path
    }
    return pathname === "" ? "/" : pathname;
  } catch {
    return pathOfTemplate(url);
  }
}
