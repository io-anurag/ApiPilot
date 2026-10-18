import type { ExclusionReason } from "@apipilot/shared-domain";
import { isAnalyticsHost } from "./analyticsHosts";
import type { ExtractedEntry } from "./types";

/**
 * Ordered exclusion rules 2 to 10 of contracts/har-import-rules.md (rule 1, malformed, is decided by
 * extraction; rules 11 and 12, third-party origin and a lost cross-origin collision, need the whole
 * capture and are applied by `originScope` and `buildHarModel`). The first rule that matches decides,
 * so every entry gets exactly one reason (FR-019, FR-020).
 */

export type Classification =
  | { outcome: "import" }
  | { outcome: "exclude"; reason: ExclusionReason };

const STATIC_EXTENSIONS: ReadonlySet<string> = new Set([
  "js", "mjs", "css", "map", "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "woff", "woff2", "ttf", "otf", "eot",
]);

function pathExtension(path: string): string | undefined {
  const last = path.split("/").at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : undefined;
}

function isStaticMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return (
    mime.startsWith("image/") ||
    mime.startsWith("font/") ||
    mime === "text/css" ||
    mime.endsWith("/javascript") ||
    mime === "application/x-javascript"
  );
}

export function classifyEntry(entry: ExtractedEntry): Classification {
  // 2. Not an HTTP(S) exchange.
  if (entry.scheme !== "http" && entry.scheme !== "https") return { outcome: "exclude", reason: "non-http-scheme" };
  // 3. CORS preflight.
  if (entry.method === "OPTIONS" && entry.hasPreflightHeader) return { outcome: "exclude", reason: "cors-preflight" };
  // 4. WebSocket and server-sent events.
  if (entry.streaming || entry.responseContentType === "text/event-stream") return { outcome: "exclude", reason: "streaming" };
  // 5. No response at all.
  if (entry.status === 0) return { outcome: "exclude", reason: "failed-request" };
  // 6 and 7. Redirects and cache revalidation are never recorded as observed statuses.
  if (entry.status === 304) return { outcome: "exclude", reason: "not-modified" };
  if (entry.status >= 300 && entry.status <= 399) return { outcome: "exclude", reason: "redirect" };
  // 8. Analytics and telemetry destinations (before static assets, so a tracking pixel is reported as analytics).
  if (isAnalyticsHost(entry.host)) return { outcome: "exclude", reason: "analytics-telemetry" };
  // 9 and 10. Static assets and page navigations.
  const safeMethod = entry.method === "GET" || entry.method === "HEAD";
  const extension = pathExtension(entry.path);
  if (safeMethod && (isStaticMime(entry.responseContentType) || (extension !== undefined && STATIC_EXTENSIONS.has(extension)))) {
    return { outcome: "exclude", reason: "static-asset" };
  }
  if (entry.responseContentType === "text/html") return { outcome: "exclude", reason: "html-document" };
  return { outcome: "import" };
}
