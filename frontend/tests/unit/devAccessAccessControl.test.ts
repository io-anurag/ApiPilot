// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_HEADER_NAME,
  REFUSAL_MESSAGE,
  buildAccessCookie,
  createAccessToken,
  decideAccess,
  hasValidAccessCookie,
  hasValidCredential,
  isApiRequest,
  presentToBackend,
  readAccessCookie,
  refusalBody,
  tokensMatch,
} from "../../devAccess/accessControl";

const TOKEN = createAccessToken();
const cookie = `${ACCESS_COOKIE_NAME}=${TOKEN}`;

describe("access token", () => {
  it("is 43 base64url characters (256 bits) and differs every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createAccessToken()));
    expect(tokens.size).toBe(50);
    for (const value of tokens) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("matches only itself, including values of a different length", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokensMatch("", TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN.slice(0, -1)}${TOKEN.endsWith("A") ? "B" : "A"}`, TOKEN)).toBe(false);
  });
});

describe("access cookie", () => {
  it("is HttpOnly, SameSite=Strict, site-wide and a session cookie, without Secure", () => {
    const value = buildAccessCookie(TOKEN);
    expect(value).toBe(`${ACCESS_COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
    expect(value).not.toMatch(/Max-Age|Expires|Secure/i);
  });

  it("is found among other cookies and ignored when malformed", () => {
    expect(readAccessCookie(`a=1; ${cookie}; b=2`)).toBe(TOKEN);
    expect(readAccessCookie(undefined)).toBeUndefined();
    expect(readAccessCookie("")).toBeUndefined();
    expect(readAccessCookie("garbage; other=1")).toBeUndefined();
    expect(hasValidAccessCookie(cookie, TOKEN)).toBe(true);
    expect(hasValidAccessCookie(`${ACCESS_COOKIE_NAME}=wrong`, TOKEN)).toBe(false);
    expect(hasValidAccessCookie(undefined, TOKEN)).toBe(false);
  });
});

describe("isApiRequest", () => {
  it.each([
    ["/api/health", true],
    ["/api", true],
    ["/api?x=1", true],
    ["/", false],
    ["/src/main.tsx", false],
    ["//evil/api/x", false],
    [undefined, false],
  ])("%s -> %s", (url, expected) => {
    expect(isApiRequest(url)).toBe(expected);
  });
});

describe("decideAccess (specs/049 FR-005 to FR-007)", () => {
  const request = (url: string, options: { method?: string; cookieHeader?: string } = {}) =>
    decideAccess({ method: options.method ?? "GET", url, cookieHeader: options.cookieHeader }, TOKEN);

  it("allows a valid cookie on pages and on the API", () => {
    expect(request("/", { cookieHeader: cookie })).toEqual({ kind: "allow" });
    expect(request("/api/x", { method: "POST", cookieHeader: cookie })).toEqual({ kind: "allow" });
  });

  it("exchanges a valid token on GET and HEAD, removing it from the address and issuing the cookie", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(request(`/?token=${TOKEN}`, { method })).toEqual({
        kind: "exchange",
        location: "/",
        cookie: buildAccessCookie(TOKEN),
      });
    }
    expect(request(`/reports/1?a=2&token=${TOKEN}&b=3`)).toMatchObject({
      kind: "exchange",
      location: "/reports/1?a=2&b=3",
    });
  });

  it("never puts the token or another origin in the redirect target", () => {
    const decision = request(`//evil.example/path?token=${TOKEN}`);
    expect(decision.kind).toBe("exchange");
    if (decision.kind === "exchange") {
      expect(decision.location.startsWith("/")).toBe(true);
      expect(decision.location).not.toContain("evil.example");
      expect(decision.location).not.toContain(TOKEN);
    }
  });

  it("refuses a missing, wrong, truncated or stale credential", () => {
    expect(request("/")).toEqual({ kind: "refuse", api: false });
    expect(request("/?token=wrong")).toEqual({ kind: "refuse", api: false });
    expect(request(`/?token=${TOKEN.slice(1)}`)).toEqual({ kind: "refuse", api: false });
    expect(request("/", { cookieHeader: `${ACCESS_COOKIE_NAME}=${createAccessToken()}` })).toEqual({
      kind: "refuse",
      api: false,
    });
    expect(request("/api/x")).toEqual({ kind: "refuse", api: true });
  });

  it("refuses a wrong token parameter even when a valid cookie is also sent", () => {
    expect(request("/?token=wrong", { cookieHeader: cookie })).toEqual({ kind: "refuse", api: false });
  });

  it("refuses a token parameter on a method that cannot exchange it", () => {
    expect(request(`/?token=${TOKEN}`, { method: "POST" })).toEqual({ kind: "refuse", api: false });
    expect(request(`/?token=${TOKEN}`, { method: "DELETE", cookieHeader: cookie })).toEqual({
      kind: "refuse",
      api: false,
    });
  });

  it("ignores a token parameter on an API path: the cookie alone decides", () => {
    expect(request(`/api/x?token=${TOKEN}`)).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x?token=anything", { cookieHeader: cookie })).toEqual({ kind: "allow" });
  });
});

describe("the access header, for clients that are not a browser", () => {
  const request = (url: string, tokenHeader: string | string[] | undefined, method = "GET") =>
    decideAccess({ method, url, cookieHeader: undefined, tokenHeader }, TOKEN);

  it("allows a request that carries the token, on pages and on the API, with any method", () => {
    expect(request("/api/x", TOKEN, "POST")).toEqual({ kind: "allow" });
    expect(request("/api/x", `  ${TOKEN}  `, "DELETE")).toEqual({ kind: "allow" });
    expect(request("/", TOKEN)).toEqual({ kind: "allow" });
  });

  it("refuses a wrong, truncated, empty or repeated header", () => {
    expect(request("/api/x", "wrong")).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", TOKEN.slice(1))).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", "")).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", [TOKEN, TOKEN])).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", undefined)).toEqual({ kind: "refuse", api: true });
  });

  it("is not a way around the token-parameter rules on a page", () => {
    // A wrong ?token= is refused even when the header is right, exactly as with a valid cookie.
    expect(
      decideAccess({ method: "GET", url: "/?token=wrong", cookieHeader: undefined, tokenHeader: TOKEN }, TOKEN),
    ).toEqual({ kind: "refuse", api: false });
  });

  it("is removed before the request reaches the backend", () => {
    const headers: Record<string, string | string[] | undefined> = {
      [ACCESS_HEADER_NAME]: TOKEN,
      accept: "*/*",
    };
    presentToBackend(headers, "http://127.0.0.1:4000");
    expect(headers).toEqual({ accept: "*/*" });
  });

  it("counts as a credential for a WebSocket upgrade alongside the cookie", () => {
    expect(hasValidCredential({ [ACCESS_HEADER_NAME]: TOKEN }, TOKEN)).toBe(true);
    expect(hasValidCredential({ cookie }, TOKEN)).toBe(true);
    expect(hasValidCredential({ [ACCESS_HEADER_NAME]: "wrong", cookie: "x=1" }, TOKEN)).toBe(false);
    expect(hasValidCredential({}, TOKEN)).toBe(false);
  });
});

describe("refusalBody (specs/049 FR-007)", () => {
  it("is JSON for the API and plain text elsewhere, with one message", () => {
    const api = refusalBody(true);
    expect(api.contentType).toBe("application/json");
    expect(JSON.parse(api.body)).toEqual({ error: "unauthorized", message: REFUSAL_MESSAGE });
    const page = refusalBody(false);
    expect(page.contentType).toBe("text/plain; charset=utf-8");
    expect(page.body).toBe(REFUSAL_MESSAGE);
  });

  it("is identical for every refusal reason", () => {
    const bodies = [
      decideAccess({ method: "GET", url: "/", cookieHeader: undefined }, TOKEN),
      decideAccess({ method: "GET", url: "/?token=wrong", cookieHeader: undefined }, TOKEN),
      decideAccess({ method: "GET", url: "/", cookieHeader: `${ACCESS_COOKIE_NAME}=stale` }, TOKEN),
    ].map((decision) => (decision.kind === "refuse" ? refusalBody(decision.api).body : "not refused"));
    expect(new Set(bodies).size).toBe(1);
  });

  it("does not contain the token", () => {
    expect(refusalBody(true).body).not.toContain(TOKEN);
    expect(refusalBody(false).body).not.toContain(TOKEN);
  });
});

describe("presentToBackend (specs/049 FR-009)", () => {
  const backend = "http://127.0.0.1:4000";

  it("rewrites a network Origin to the backend's loopback origin", () => {
    const headers: Record<string, string | string[] | undefined> = {
      origin: "http://192.168.1.50:5173",
    };
    presentToBackend(headers, backend);
    expect(headers.origin).toBe(backend);
  });

  it("leaves an absent Origin absent", () => {
    const headers: Record<string, string | string[] | undefined> = { accept: "*/*" };
    presentToBackend(headers, backend);
    expect("origin" in headers).toBe(false);
  });

  it("removes the access cookie, keeping other cookies", () => {
    const headers: Record<string, string | string[] | undefined> = {
      cookie: `a=1; ${cookie}; b=2`,
    };
    presentToBackend(headers, backend);
    expect(headers.cookie).toBe("a=1; b=2");
    expect(String(headers.cookie)).not.toContain(TOKEN);
  });

  it("deletes the Cookie header when the access cookie was the only one", () => {
    const headers: Record<string, string | string[] | undefined> = { cookie };
    presentToBackend(headers, backend);
    expect("cookie" in headers).toBe(false);
  });

  it("leaves a request without cookies alone", () => {
    const headers: Record<string, string | string[] | undefined> = {};
    presentToBackend(headers, backend);
    expect(headers).toEqual({});
  });

  it("handles a cookie header split into several values", () => {
    const headers: Record<string, string | string[] | undefined> = { cookie: ["a=1", cookie] };
    presentToBackend(headers, backend);
    expect(headers.cookie).toBe("a=1");
  });
});
