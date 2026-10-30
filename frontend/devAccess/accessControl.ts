/**
 * Pure access-control logic for the per-device-token dev server (specs/060-per-device-dev-access,
 * which supersedes the shared token of specs/049-lan-dev-access-token). Whether a token is valid
 * for a client is decided by the `TokenCheck` the caller supplies; nothing here stores or logs a
 * presented credential.
 */

export const ACCESS_COOKIE_NAME = "apipilot_dev_access";
/** Where a device asks for its own token. Only `POST` is special; everything else follows the normal rules. */
export const ENROLL_PATH = "/__apipilot/access";
/**
 * For clients that are not a browser (scripts, `curl`, CI): the token can be sent on every request
 * in this header instead of the cookie. Node lowercases incoming header names.
 */
export const ACCESS_HEADER_NAME = "x-apipilot-token";

/** One message for every refusal, so a response never reveals why the credential failed (FR-007). */
export const REFUSAL_MESSAGE =
  "Access denied. Browsers on a private network get a token automatically when they open a page; scripts request one with POST /__apipilot/access.";

/** Whether a presented token is valid for the client making the request. */
export type TokenCheck = (token: string) => boolean;

/** Not readable by page scripts (HttpOnly), not sent cross-site (SameSite=Strict), a session cookie. No `Secure`: the connection is plain HTTP. */
export function buildAccessCookie(token: string): string {
  return `${ACCESS_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/** The value of the access cookie in a `Cookie` header, or undefined. */
export function readAccessCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === ACCESS_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

/** True when a `Cookie` header carries the access cookie with a valid token. */
export function hasValidAccessCookie(
  cookieHeader: string | undefined,
  check: TokenCheck,
): boolean {
  const presented = readAccessCookie(cookieHeader);
  return presented !== undefined && check(presented);
}

type HeaderValue = string | string[] | undefined;

/** True when the access header carries a valid token. An array (repeated header) never matches. */
export function hasValidAccessHeader(
  headerValue: HeaderValue,
  check: TokenCheck,
): boolean {
  return typeof headerValue === "string" && check(headerValue.trim());
}

/** True when either the cookie or the access header carries a valid token. Used for WebSocket upgrades. */
export function hasValidCredential(
  headers: { cookie?: string; [ACCESS_HEADER_NAME]?: HeaderValue },
  check: TokenCheck,
): boolean {
  return (
    hasValidAccessCookie(headers.cookie, check) ||
    hasValidAccessHeader(headers[ACCESS_HEADER_NAME], check)
  );
}

/** The same test Vite's proxy applies to its `/api` context, so the guard and the proxy agree on what is an API request. */
export function isApiRequest(url: string | undefined): boolean {
  return (url ?? "").startsWith("/api");
}

export interface AccessRequest {
  method: string | undefined;
  url: string | undefined;
  cookieHeader: string | undefined;
  /** The value of the `X-ApiPilot-Token` header, if any. */
  tokenHeader?: HeaderValue;
  accept?: string;
  secFetchDest?: string;
  secFetchSite?: string;
}

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "enroll" }
  | { kind: "enroll-browser" }
  | { kind: "refuse"; api: boolean };

/** A top-level page load a user started (typed address, link, bookmark), not a script or a cross-site subresource. */
function isBrowserNavigation(request: AccessRequest): boolean {
  return (
    (request.method ?? "").toUpperCase() === "GET" &&
    (request.accept ?? "").includes("text/html") &&
    (request.secFetchDest === undefined || request.secFetchDest === "document") &&
    (request.secFetchSite === undefined || request.secFetchSite !== "cross-site")
  );
}

/**
 * Decides what to do with one request. A `POST` to the enrolment path (scripts asking for a token)
 * is handled by the caller. A request with a valid cookie or `X-ApiPilot-Token` header is allowed.
 * A browser page load without one gets a token issued automatically (`enroll-browser`). Anything
 * else is refused. There is no query-parameter credential.
 */
export function decideAccess(request: AccessRequest, check: TokenCheck): AccessDecision {
  const path = (request.url ?? "").split("?")[0];
  if ((request.method ?? "").toUpperCase() === "POST" && path === ENROLL_PATH) {
    return { kind: "enroll" };
  }
  if (hasValidAccessCookie(request.cookieHeader, check)) return { kind: "allow" };
  if (hasValidAccessHeader(request.tokenHeader, check)) return { kind: "allow" };
  if (isBrowserNavigation(request)) return { kind: "enroll-browser" };
  return { kind: "refuse", api: isApiRequest(request.url) };
}

/** True when the request's `Origin`, if it has one, is the dev server's own origin. A cross-site page cannot enrol a visitor's browser. */
export function isSameOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (origin === undefined) return true;
  if (host === undefined) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** The refusal body for the response form the decision selected. */
export function refusalBody(api: boolean): { contentType: string; body: string } {
  return api
    ? {
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized", message: REFUSAL_MESSAGE }),
      }
    : { contentType: "text/plain; charset=utf-8", body: REFUSAL_MESSAGE };
}

type HeaderBag = Record<string, HeaderValue>;

function cookieName(pair: string): string {
  const separator = pair.indexOf("=");
  return (separator < 0 ? pair : pair.slice(0, separator)).trim();
}

/**
 * Presents an accepted API request to the backend as a same-machine request. The backend rejects any
 * non-loopback `Origin`, and a browser on another device sends its network address as `Origin` on
 * state-changing requests; the dev server has just proven the caller holds the token, so the
 * backend's own check stays untouched and is simply satisfied. The access cookie and the access
 * header are removed so the secret never reaches the backend. Mutates `headers` (the incoming request's own header object,
 * from which the proxy builds the outgoing request). `Origin` is rewritten only when present.
 */
export function presentToBackend(headers: HeaderBag, backendOrigin: string): void {
  if (headers.origin !== undefined) headers.origin = backendOrigin;
  delete headers[ACCESS_HEADER_NAME];

  const cookie = headers.cookie;
  if (cookie === undefined) return;
  const remaining = (Array.isArray(cookie) ? cookie.join("; ") : cookie)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && cookieName(part) !== ACCESS_COOKIE_NAME);
  if (remaining.length === 0) delete headers.cookie;
  else headers.cookie = remaining.join("; ");
}
