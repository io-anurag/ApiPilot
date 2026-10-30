// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_HEADER_NAME,
  ENROLL_PATH,
  REFUSAL_MESSAGE,
  buildAccessCookie,
  decideAccess,
  hasValidAccessCookie,
  hasValidCredential,
  isApiRequest,
  isSameOrigin,
  presentToBackend,
  readAccessCookie,
  refusalBody,
} from "../../devAccess/accessControl";

const TOKEN = "T".repeat(43);
const cookie = `${ACCESS_COOKIE_NAME}=${TOKEN}`;
const check = (presented: string) => presented === TOKEN;

describe("access cookie", () => {
  it("is HttpOnly, SameSite=Strict, site-wide and a session cookie, without Secure", () => {
    const value = buildAccessCookie(TOKEN);
    expect(value).toBe(
      `${ACCESS_COOKIE_NAME}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
    );
    expect(value).not.toMatch(/Max-Age|Expires|Secure/i);
  });

  it("is found among other cookies and ignored when malformed", () => {
    expect(readAccessCookie(`a=1; ${cookie}; b=2`)).toBe(TOKEN);
    expect(readAccessCookie(undefined)).toBeUndefined();
    expect(readAccessCookie("")).toBeUndefined();
    expect(readAccessCookie("garbage; other=1")).toBeUndefined();
    expect(hasValidAccessCookie(cookie, check)).toBe(true);
    expect(hasValidAccessCookie(`${ACCESS_COOKIE_NAME}=wrong`, check)).toBe(false);
    expect(hasValidAccessCookie(undefined, check)).toBe(false);
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

describe("decideAccess (specs/060 FR-006, FR-007)", () => {
  const request = (
    url: string,
    options: { method?: string; cookieHeader?: string } = {},
  ) =>
    decideAccess(
      { method: options.method ?? "GET", url, cookieHeader: options.cookieHeader },
      check,
    );

  it("allows a valid cookie on pages and on the API", () => {
    expect(request("/", { cookieHeader: cookie })).toEqual({ kind: "allow" });
    expect(request("/api/x", { method: "POST", cookieHeader: cookie })).toEqual({
      kind: "allow",
    });
  });

  it("refuses a missing, wrong or stale credential", () => {
    expect(request("/")).toEqual({ kind: "refuse", api: false });
    expect(request("/", { cookieHeader: `${ACCESS_COOKIE_NAME}=wrong` })).toEqual({
      kind: "refuse",
      api: false,
    });
    expect(request("/api/x")).toEqual({ kind: "refuse", api: true });
  });

  it("gives a browser page load without a credential a token automatically, on a page or an API address", () => {
    const html = "text/html,application/xhtml+xml,*/*;q=0.8";
    const navigate = (
      url: string,
      extra: Partial<Parameters<typeof decideAccess>[0]> = {},
    ) =>
      decideAccess(
        { method: "GET", url, cookieHeader: undefined, accept: html, ...extra },
        check,
      );
    expect(navigate("/")).toEqual({ kind: "enroll-browser" });
    expect(navigate("/api/health")).toEqual({ kind: "enroll-browser" });
    expect(navigate("/", { secFetchDest: "document", secFetchSite: "none" })).toEqual({
      kind: "enroll-browser",
    });
  });

  it("does not enrol subresources, cross-site loads, other methods or non-browser clients", () => {
    const html = "text/html";
    const attempt = (extra: Partial<Parameters<typeof decideAccess>[0]>) =>
      decideAccess(
        { method: "GET", url: "/", cookieHeader: undefined, accept: html, ...extra },
        check,
      );
    expect(attempt({ secFetchDest: "script" }).kind).toBe("refuse");
    expect(attempt({ secFetchDest: "iframe" }).kind).toBe("refuse");
    expect(attempt({ secFetchSite: "cross-site" }).kind).toBe("refuse");
    expect(attempt({ method: "POST" }).kind).toBe("refuse");
    expect(attempt({ accept: "*/*" }).kind).toBe("refuse");
    expect(attempt({ accept: "application/json" }).kind).toBe("refuse");
    expect(attempt({ accept: undefined }).kind).toBe("refuse");
  });

  it("has no query-parameter credential", () => {
    expect(request(`/?token=${TOKEN}`)).toEqual({ kind: "refuse", api: false });
    expect(request(`/api/x?token=${TOKEN}`)).toEqual({ kind: "refuse", api: true });
  });

  it("routes only a POST to the enrolment path to enrolment, whatever the credential", () => {
    expect(request(ENROLL_PATH, { method: "POST" })).toEqual({ kind: "enroll" });
    expect(
      request(`${ENROLL_PATH}?x=1`, { method: "post", cookieHeader: cookie }),
    ).toEqual({ kind: "enroll" });
    expect(request(ENROLL_PATH, { method: "GET" })).toEqual({
      kind: "refuse",
      api: false,
    });
    expect(request(`${ENROLL_PATH}/more`, { method: "POST" })).toEqual({
      kind: "refuse",
      api: false,
    });
  });
});

describe("the access header, for clients that are not a browser", () => {
  const request = (
    url: string,
    tokenHeader: string | string[] | undefined,
    method = "GET",
  ) => decideAccess({ method, url, cookieHeader: undefined, tokenHeader }, check);

  it("allows a request that carries a valid token, on pages and on the API, with any method", () => {
    expect(request("/api/x", TOKEN, "POST")).toEqual({ kind: "allow" });
    expect(request("/api/x", `  ${TOKEN}  `, "DELETE")).toEqual({ kind: "allow" });
    expect(request("/", TOKEN)).toEqual({ kind: "allow" });
  });

  it("refuses a wrong, empty or repeated header", () => {
    expect(request("/api/x", "wrong")).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", "")).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", [TOKEN, TOKEN])).toEqual({ kind: "refuse", api: true });
    expect(request("/api/x", undefined)).toEqual({ kind: "refuse", api: true });
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
    expect(hasValidCredential({ [ACCESS_HEADER_NAME]: TOKEN }, check)).toBe(true);
    expect(hasValidCredential({ cookie }, check)).toBe(true);
    expect(
      hasValidCredential({ [ACCESS_HEADER_NAME]: "wrong", cookie: "x=1" }, check),
    ).toBe(false);
    expect(hasValidCredential({}, check)).toBe(false);
  });
});

describe("enrolment request checks (specs/060 FR-004, FR-005)", () => {
  it("accepts a request with no Origin or with the dev server's own Origin", () => {
    expect(isSameOrigin(undefined, "192.168.1.20:5173")).toBe(true);
    expect(isSameOrigin("http://192.168.1.20:5173", "192.168.1.20:5173")).toBe(true);
  });

  it("rejects another origin, a malformed one and an opaque one", () => {
    expect(isSameOrigin("http://evil.example", "192.168.1.20:5173")).toBe(false);
    expect(isSameOrigin("http://192.168.1.20:9999", "192.168.1.20:5173")).toBe(false);
    expect(isSameOrigin("null", "192.168.1.20:5173")).toBe(false);
    expect(isSameOrigin("http://192.168.1.20:5173", undefined)).toBe(false);
  });
});

describe("refusalBody (specs/060 FR-007)", () => {
  it("is JSON for the API and plain text elsewhere", () => {
    const api = refusalBody(true);
    expect(api.contentType).toBe("application/json");
    expect(JSON.parse(api.body)).toEqual({
      error: "unauthorized",
      message: REFUSAL_MESSAGE,
    });
    const page = refusalBody(false);
    expect(page.contentType).toBe("text/plain; charset=utf-8");
    expect(page.body).toBe(REFUSAL_MESSAGE);
  });

  it("is identical for every refusal reason", () => {
    const bodies = [
      decideAccess({ method: "GET", url: "/", cookieHeader: undefined }, check),
      decideAccess(
        { method: "GET", url: "/?token=wrong", cookieHeader: undefined },
        check,
      ),
      decideAccess(
        { method: "GET", url: "/", cookieHeader: `${ACCESS_COOKIE_NAME}=stale` },
        check,
      ),
    ].map((decision) =>
      decision.kind === "refuse" ? refusalBody(decision.api).body : "not refused",
    );
    expect(new Set(bodies).size).toBe(1);
  });
});

describe("presentToBackend (specs/049 FR-009, kept by specs/060 FR-010)", () => {
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
    const headers: Record<string, string | string[] | undefined> = {
      cookie: ["a=1", cookie],
    };
    presentToBackend(headers, backend);
    expect(headers.cookie).toBe("a=1");
  });
});
