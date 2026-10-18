import { describe, expect, it } from "vitest";
import { isAnalyticsHost, ANALYTICS_HOSTS } from "../../../../src/apiInput/har/analyticsHosts";
import { classifyEntry } from "../../../../src/apiInput/har/classifyEntry";
import { computeOriginScope, isRelatedOrigin, siteKey } from "../../../../src/apiInput/har/originScope";
import type { ExtractedEntry } from "../../../../src/apiInput/har/types";

function entry(overrides: Partial<ExtractedEntry> = {}): ExtractedEntry {
  return {
    index: 0,
    method: "GET",
    scheme: "https",
    host: "api.shop.test",
    origin: "https://api.shop.test",
    path: "/v1/orders",
    query: [],
    requestHeaders: {},
    requestBody: { kind: "absent" },
    status: 200,
    responseContentType: "application/json",
    responseBody: { kind: "absent" },
    credentials: [],
    userinfoRemoved: false,
    apiLike: true,
    hasPreflightHeader: false,
    streaming: false,
    normalization: { trailingSlashFolded: false, duplicateSlashesCollapsed: false, dotSegmentsRemoved: 0 },
    ...overrides,
  };
}

const reasonOf = (e: ExtractedEntry) => {
  const result = classifyEntry(e);
  return result.outcome === "exclude" ? result.reason : "import";
};

describe("classifyEntry: ordered exclusion rules (FR-019)", () => {
  it("imports an ordinary API call", () => {
    expect(reasonOf(entry())).toBe("import");
    expect(reasonOf(entry({ method: "POST", status: 201 }))).toBe("import");
    expect(reasonOf(entry({ status: 404 }))).toBe("import");
  });

  it.each([
    ["a websocket scheme", { scheme: "wss" }, "non-http-scheme"],
    ["a data URL", { scheme: "data", host: "", path: "" }, "non-http-scheme"],
    ["a CORS preflight", { method: "OPTIONS", hasPreflightHeader: true }, "cors-preflight"],
    ["a websocket exchange", { streaming: true }, "streaming"],
    ["server-sent events", { responseContentType: "text/event-stream" }, "streaming"],
    ["a failed request", { status: 0 }, "failed-request"],
    ["a 304", { status: 304 }, "not-modified"],
    ["a 301", { status: 301 }, "redirect"],
    ["a 302", { status: 302 }, "redirect"],
    ["a 307", { status: 307 }, "redirect"],
    ["a 308", { status: 308 }, "redirect"],
    ["an analytics host", { host: "www.google-analytics.com" }, "analytics-telemetry"],
    ["a tracking pixel on an analytics host", { host: "px.ads.linkedin.com", responseContentType: "image/gif" }, "analytics-telemetry"],
    ["an image", { responseContentType: "image/png" }, "static-asset"],
    ["a font", { responseContentType: "font/woff2" }, "static-asset"],
    ["a stylesheet", { responseContentType: "text/css" }, "static-asset"],
    ["javascript", { responseContentType: "application/javascript" }, "static-asset"],
    ["a script by extension", { path: "/static/app.min.js", responseContentType: undefined }, "static-asset"],
    ["a source map by extension", { path: "/a.js.map", responseContentType: undefined }, "static-asset"],
    ["an HTML page", { responseContentType: "text/html" }, "html-document"],
  ] as const)("excludes %s", (_label, overrides, reason) => {
    expect(reasonOf(entry(overrides as Partial<ExtractedEntry>))).toBe(reason);
  });

  it("keeps a plain OPTIONS request (no preflight header)", () => {
    expect(reasonOf(entry({ method: "OPTIONS" }))).toBe("import");
  });

  it("only treats a static look as an asset for GET and HEAD", () => {
    expect(reasonOf(entry({ method: "POST", responseContentType: "image/png" }))).toBe("import");
    expect(reasonOf(entry({ method: "HEAD", responseContentType: "image/png" }))).toBe("static-asset");
  });

  it("applies the rules in order: the first match decides", () => {
    // A preflight to an analytics host is a preflight; a redirect from an analytics host is a redirect.
    expect(reasonOf(entry({ method: "OPTIONS", hasPreflightHeader: true, host: "www.google-analytics.com" }))).toBe("cors-preflight");
    expect(reasonOf(entry({ status: 302, host: "www.google-analytics.com" }))).toBe("redirect");
    expect(reasonOf(entry({ scheme: "ws", status: 0 }))).toBe("non-http-scheme");
    // Analytics wins over static, and static over html.
    expect(reasonOf(entry({ host: "api.segment.io", responseContentType: "text/css" }))).toBe("analytics-telemetry");
  });
});

describe("analytics hosts", () => {
  it("matches the host and its subdomains only", () => {
    expect(isAnalyticsHost("google-analytics.com")).toBe(true);
    expect(isAnalyticsHost("www.google-analytics.com")).toBe(true);
    expect(isAnalyticsHost("a.b.hotjar.io")).toBe(true);
    expect(isAnalyticsHost("notgoogle-analytics.com")).toBe(false);
    expect(isAnalyticsHost("google-analytics.com.example.test")).toBe(false);
  });

  it("is a frozen, alphabetized list", () => {
    expect(Object.isFrozen(ANALYTICS_HOSTS)).toBe(true);
    expect([...ANALYTICS_HOSTS]).toEqual([...ANALYTICS_HOSTS].sort());
  });
});

describe("originScope (research R12)", () => {
  it.each([
    ["api.shop.test", "shop.test"],
    ["shop.test", "shop.test"],
    ["a.b.c.shop.test", "shop.test"],
    ["shop.co.uk", "shop.co.uk"],
    ["api.shop.co.uk", "shop.co.uk"],
    ["other.co.uk", "other.co.uk"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "::1"],
    ["API.Shop.TEST", "shop.test"],
  ])("site key of %s is %s", (host, key) => {
    expect(siteKey(host)).toBe(key);
  });

  it("anchors on the page origin and on the busiest API origin", () => {
    const candidates = [
      entry({ origin: "https://api.shop.test", host: "api.shop.test" }),
      entry({ origin: "https://api.shop.test", host: "api.shop.test" }),
      entry({ origin: "https://auth.shop.test", host: "auth.shop.test" }),
      entry({ origin: "https://api.other.test", host: "api.other.test" }),
    ];
    const scope = computeOriginScope(candidates, ["https://shop.test/"]);
    expect(scope.primaryOrigin).toBe("https://api.shop.test");
    expect(isRelatedOrigin("auth.shop.test", scope)).toBe(true);
    expect(isRelatedOrigin("api.other.test", scope)).toBe(false);
  });

  it("breaks a tie for the primary origin by the smaller origin", () => {
    const scope = computeOriginScope(
      [entry({ origin: "https://b.test", host: "b.test" }), entry({ origin: "https://a.test", host: "a.test" })],
      [],
    );
    expect(scope.primaryOrigin).toBe("https://a.test");
  });

  it("falls back to the origin with the most entries when nothing is API-like", () => {
    const plain = (origin: string, host: string) => entry({ origin, host, apiLike: false });
    const scope = computeOriginScope([plain("https://a.test", "a.test"), plain("https://b.test", "b.test"), plain("https://b.test", "b.test")], []);
    expect(scope.primaryOrigin).toBe("https://b.test");
  });

  it("ignores page titles that are not URLs", () => {
    const scope = computeOriginScope([entry()], ["Home page", "ftp://files.test/x"]);
    expect([...scope.anchors]).toEqual(["shop.test"]);
  });

  it("has no primary origin and no anchors for no candidates", () => {
    const scope = computeOriginScope([], []);
    expect(scope.primaryOrigin).toBeUndefined();
    expect(scope.anchors.size).toBe(0);
  });
});
