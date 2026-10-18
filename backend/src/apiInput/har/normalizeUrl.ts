/**
 * Deterministic URL and path normalization (specs/056 research R10, contracts/har-import-rules.md).
 * `new URL` is used only to validate and read the host and port; it parses and never fetches. The
 * path is normalized by string operations, so no file system is touched and dot segments are removed
 * as text per RFC 3986 section 5.2.4.
 */

export interface PathNormalization {
  path: string;
  trailingSlashFolded: boolean;
  duplicateSlashesCollapsed: boolean;
  dotSegmentsRemoved: number;
}

export type ParsedUrl =
  | { ok: false; reason: "invalid-url" | "relative-url" }
  | {
      ok: true;
      scheme: string;
      /** Empty when the scheme has no authority (for example `data:`). */
      host: string;
      origin: string;
      normalization: PathNormalization;
      /** The raw query string after `?`, without the fragment, or an empty string. */
      search: string;
    };

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Decodes percent-escapes of unreserved characters and upper-cases the hex of every other escape. */
export function normalizePercentEncoding(segment: string): string {
  return segment.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}

/** True for a segment that is `.` or `..`, including the percent-encoded spellings. */
function dotKind(segment: string): "." | ".." | undefined {
  const lowered = segment.toLowerCase().replace(/%2e/g, ".");
  return lowered === "." ? "." : lowered === ".." ? ".." : undefined;
}

/** Normalizes a raw path (no query, no fragment): dots, slashes, percent-encoding, trailing slash. */
export function normalizePath(rawPath: string): PathNormalization {
  const input = rawPath === "" ? "/" : rawPath;
  const segments = input.split("/");
  // The first element is the empty string before the leading slash (or the first segment if the path has none).
  let dotSegmentsRemoved = 0;
  const stack: string[] = [];
  for (const segment of segments.slice(input.startsWith("/") ? 1 : 0)) {
    const dot = dotKind(segment);
    if (dot === ".") {
      dotSegmentsRemoved += 1;
    } else if (dot === "..") {
      dotSegmentsRemoved += 1;
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(segment);
    }
  }
  // An empty last segment is a trailing slash; an empty segment anywhere before it is a duplicate slash.
  const lastIsEmpty = stack.length > 0 && stack[stack.length - 1] === "";
  const beforeLast = lastIsEmpty ? stack.slice(0, -1) : stack;
  const nonEmpty = stack.filter((segment) => segment !== "");
  const duplicateSlashesCollapsed = beforeLast.some((segment) => segment === "");
  const trailingSlashFolded = lastIsEmpty && nonEmpty.length > 0;
  const path = nonEmpty.length === 0 ? "/" : `/${nonEmpty.map(normalizePercentEncoding).join("/")}`;
  return { path, trailingSlashFolded, duplicateSlashesCollapsed, dotSegmentsRemoved };
}

/**
 * Parses an entry URL. Userinfo is expected to have been removed already (`redactUrl`), but a leftover
 * is ignored rather than kept. A URL with no scheme is relative; a URL `new URL` rejects is invalid.
 */
export function parseEntryUrl(url: string): ParsedUrl {
  const schemeMatch = SCHEME.exec(url);
  if (!schemeMatch) return { ok: false, reason: "relative-url" };
  const scheme = schemeMatch[1].toLowerCase();
  const empty: PathNormalization = { path: "", trailingSlashFolded: false, duplicateSlashesCollapsed: false, dotSegmentsRemoved: 0 };

  const authorityMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/s.exec(url);
  if (!authorityMatch) {
    // `data:`, `mailto:` and similar have no authority: valid, but never an HTTP exchange.
    try {
      new URL(url);
    } catch {
      return { ok: false, reason: "invalid-url" };
    }
    return { ok: true, scheme, host: "", origin: "", normalization: empty, search: "" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "") return { ok: false, reason: "invalid-url" };
  const origin = `${scheme}://${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  return {
    ok: true,
    scheme,
    host: hostname,
    origin,
    normalization: normalizePath(authorityMatch[2]),
    search: authorityMatch[3] ?? "",
  };
}
