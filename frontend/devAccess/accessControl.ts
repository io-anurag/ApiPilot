/**
 * Pure access-control logic for the token-protected dev server (specs/049-lan-dev-access-token).
 * Nothing here logs, stores or returns a presented credential; the token exists only in the memory
 * of the plugin instance that created it (FR-003, FR-008).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE_NAME = "apipilot_dev_access";
export const TOKEN_QUERY_PARAM = "token";
/**
 * For clients that are not a browser (scripts, `curl`, CI): the token can be sent on every request
 * in this header instead of going through the cookie exchange. Node lowercases incoming header names.
 */
export const ACCESS_HEADER_NAME = "x-apipilot-token";

/** One message for every refusal, so a response never reveals why the credential failed (FR-007, FR-012). */
export const REFUSAL_MESSAGE =
  "Access token required. Open the address printed in the terminal where the dev server was started.";

/** 32 random bytes as base64url: 43 characters, 256 bits, above the 128-bit floor in FR-003. */
export function createAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Compares a presented value with the real token without the time depending on how many leading
 * characters match (FR-010). Both sides are hashed first so they are the same length, which
 * `timingSafeEqual` requires and which hides the real token's length.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

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

/** True when a `Cookie` header carries the access cookie with the real token. */
export function hasValidAccessCookie(cookieHeader: string | undefined, token: string): boolean {
  const presented = readAccessCookie(cookieHeader);
  return presented !== undefined && tokensMatch(presented, token);
}

type HeaderValue = string | string[] | undefined;

/** True when the access header carries the real token. An array (repeated header) never matches. */
export function hasValidAccessHeader(headerValue: HeaderValue, token: string): boolean {
  return typeof headerValue === "string" && tokensMatch(headerValue.trim(), token);
}

/** True when either the cookie or the access header carries the real token. Used where no token parameter applies (WebSocket upgrades). */
export function hasValidCredential(
  headers: { cookie?: string; [ACCESS_HEADER_NAME]?: HeaderValue },
  token: string,
): boolean {
  return (
    hasValidAccessCookie(headers.cookie, token) ||
    hasValidAccessHeader(headers[ACCESS_HEADER_NAME], token)
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
}

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "exchange"; location: string; cookie: string }
  | { kind: "refuse"; api: boolean };

/**
 * Decides what to do with one request.
 *
 * A `token` query parameter is honoured only on a non-API path with `GET` or `HEAD`: a match
 * becomes an `exchange` (redirect without the parameter, issuing the cookie), anything else is
 * refused even if a valid cookie is also present. On an API path the parameter means nothing to this
 * guard (the application's own requests may use such a name). Otherwise a valid cookie (a browser
 * that has exchanged the token) or a valid `X-ApiPilot-Token` header (a script) allows the request.
 */
export function decideAccess(request: AccessRequest, token: string): AccessDecision {
  const api = isApiRequest(request.url);
  const refuse: AccessDecision = { kind: "refuse", api };

  if (!api) {
    let parsed: URL;
    try {
      // The base is only a parser anchor for an origin-form request target; nothing connects to it.
      parsed = new URL(request.url ?? "/", "http://dev-server.invalid");
    } catch {
      return refuse;
    }
    if (parsed.searchParams.has(TOKEN_QUERY_PARAM)) {
      const method = (request.method ?? "GET").toUpperCase();
      const presented = parsed.searchParams.get(TOKEN_QUERY_PARAM) ?? "";
      if ((method === "GET" || method === "HEAD") && tokensMatch(presented, token)) {
        parsed.searchParams.delete(TOKEN_QUERY_PARAM);
        return {
          kind: "exchange",
          location: `${parsed.pathname}${parsed.search}`,
          cookie: buildAccessCookie(token),
        };
      }
      return refuse;
    }
  }

  if (hasValidAccessCookie(request.cookieHeader, token)) return { kind: "allow" };
  if (hasValidAccessHeader(request.tokenHeader, token)) return { kind: "allow" };
  return refuse;
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
