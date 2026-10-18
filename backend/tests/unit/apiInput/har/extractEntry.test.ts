import { describe, expect, it } from "vitest";
import { extractEntry } from "../../../../src/apiInput/har/extractEntry";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";
import { harEntry, jsonEntry } from "../../../fixtures/apiInput/harBuilders";

const limits = DEFAULT_INPUT_LIMITS;
interface MutableEntry {
  [key: string]: unknown;
  request: Record<string, unknown>;
  response: { content: Record<string, unknown> };
}
const extract = (raw: unknown) => extractEntry(raw, 7, limits);
const entryOf = (raw: unknown) => {
  const result = extract(raw);
  if (result.kind !== "entry") throw new Error(`expected an entry, got ${result.reason}`);
  return result.entry;
};

describe("extractEntry: malformed entries (FR-011)", () => {
  it.each([
    ["a string", "not an object", "not-an-object"],
    ["null", null, "not-an-object"],
    ["an array", [], "not-an-object"],
    ["no request", { response: { status: 200 } }, "missing-url"],
    ["no url", { request: { method: "GET" }, response: { status: 200 } }, "missing-url"],
    ["a blank url", { request: { method: "GET", url: "  " }, response: { status: 200 } }, "missing-url"],
    ["a numeric url", { request: { method: "GET", url: 5 }, response: { status: 200 } }, "missing-url"],
    ["no method", { request: { url: "https://a.test/x" }, response: { status: 200 } }, "missing-method"],
    ["no response", { request: { method: "GET", url: "https://a.test/x" } }, "missing-response-status"],
    ["no status", { request: { method: "GET", url: "https://a.test/x" }, response: {} }, "missing-response-status"],
    ["a non-integer status", { request: { method: "GET", url: "https://a.test/x" }, response: { status: "200" } }, "missing-response-status"],
    ["a relative url", { request: { method: "GET", url: "/relative" }, response: { status: 200 } }, "relative-url"],
    ["an unparseable url", { request: { method: "GET", url: "http://" }, response: { status: 200 } }, "invalid-url"],
  ])("reports %s as %s", (_label, raw, reason) => {
    expect(extract(raw)).toEqual({ kind: "malformed", reason });
  });
});

describe("extractEntry: allow-list (FR-010)", () => {
  it("extracts method, URL parts, query, headers, bodies, status, content types and time", () => {
    const entry = entryOf(
      jsonEntry("post", "https://API.Shop.test:443/v1/orders/?page=2", 201, { id: "o1" }, { sku: "W-1" }, {
        requestHeaders: { "X-Request-Id": "r-1", "Content-Type": "application/json" },
        startedAt: "2026-01-02T03:04:05.000Z",
      }),
    );
    expect(entry).toMatchObject({
      index: 7,
      method: "POST",
      scheme: "https",
      host: "api.shop.test",
      origin: "https://api.shop.test",
      path: "/v1/orders",
      query: [{ name: "page", value: "2" }],
      status: 201,
      requestContentType: "application/json",
      responseContentType: "application/json",
      startedAt: Date.parse("2026-01-02T03:04:05.000Z"),
      requestBody: { kind: "available", format: "json", value: { sku: "W-1" } },
      responseBody: { kind: "available", format: "json", value: { id: "o1" } },
    });
    expect(entry.requestHeaders["x-request-id"]).toBe("r-1");
    expect(entry.normalization.trailingSlashFolded).toBe(true);
  });

  it("copies nothing that is not named: unknown and tool-extension fields never appear", () => {
    const raw = harEntry({ url: "https://a.test/x" }) as MutableEntry;
    raw._secretExtension = "SEEDED-SECRET-EXTENSION";
    raw.request._customField = "SEEDED-SECRET-CUSTOM";
    raw.request.comment = "SEEDED-SECRET-COMMENT";
    raw.response.content.comment = "SEEDED-SECRET-COMMENT2";
    const serialized = JSON.stringify(entryOf(raw));
    expect(serialized).not.toContain("SEEDED-SECRET");
  });

  it("reads the query from the URL when the capture has no queryString list", () => {
    const raw = harEntry({ url: "https://a.test/x?a=1&b=two" }) as MutableEntry;
    delete raw.request.queryString;
    expect(entryOf(raw).query).toEqual([{ name: "a", value: "1" }, { name: "b", value: "two" }]);
  });

  it("marks API-like entries by response type, JSON request body or resource type", () => {
    expect(entryOf(harEntry({ url: "https://a.test/x", responseMimeType: "application/json", responseText: "{}" })).apiLike).toBe(true);
    expect(entryOf(harEntry({ url: "https://a.test/x", responseMimeType: "application/hal+json", responseText: "{}" })).apiLike).toBe(true);
    expect(entryOf(harEntry({ url: "https://a.test/x", responseMimeType: "application/xml", responseText: "<a/>" })).apiLike).toBe(true);
    expect(entryOf(harEntry({ url: "https://a.test/x", resourceType: "xhr" })).apiLike).toBe(true);
    expect(entryOf(harEntry({ url: "https://a.test/x", responseMimeType: "text/plain", responseText: "x" })).apiLike).toBe(false);
  });

  it("detects preflight and websocket markers", () => {
    expect(entryOf(harEntry({ method: "OPTIONS", url: "https://a.test/x", requestHeaders: { "Access-Control-Request-Method": "POST" } })).hasPreflightHeader).toBe(true);
    expect(entryOf(harEntry({ url: "wss://a.test/s", webSocket: true })).streaming).toBe(true);
  });
});

describe("extractEntry: redaction at the source (FR-047)", () => {
  const SECRET = "SEEDED-SECRET-EXTRACT";

  it("leaves no raw credential value anywhere in the extracted entry", () => {
    const raw = harEntry({
      method: "POST",
      url: `https://user:${SECRET}-USERINFO@a.test/v1/x?api_key=${SECRET}-Q&token=${SECRET}-T&page=1`,
      requestHeaders: {
        Authorization: `Bearer ${SECRET}-A`,
        Cookie: `sid=${SECRET}-C`,
        "X-API-Key": `${SECRET}-K`,
        "X-Request-Id": "keep-me",
      },
      requestBody: { mimeType: "application/json", text: JSON.stringify({ password: `${SECRET}-P`, user: "ada", nested: { clientSecret: `${SECRET}-S` } }) },
      responseText: JSON.stringify({ access_token: `${SECRET}-R`, id: "x1" }),
      responseHeaders: { "Set-Cookie": `session=${SECRET}-SC` },
    });
    const entry = entryOf(raw);
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(entry.query).toEqual([
      { name: "api_key", value: "[redacted:apiKey]" },
      { name: "token", value: "[redacted:token]" },
      { name: "page", value: "1" },
    ]);
    expect(entry.requestHeaders).toMatchObject({
      authorization: "[redacted:token]",
      cookie: "[redacted:cookie]",
      "x-api-key": "[redacted:apiKey]",
      "x-request-id": "keep-me",
    });
    expect(entry.requestBody).toMatchObject({ value: { password: "[redacted:password]", user: "ada", nested: { clientSecret: "[redacted:token]" } } });
    expect(entry.responseBody).toMatchObject({ value: { access_token: "[redacted:token]", id: "x1" } });
    expect(entry.userinfoRemoved).toBe(true);
    const kinds = entry.credentials.map((c) => `${c.location}:${c.name}:${c.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(["url-userinfo:userinfo:password", "query:api_key:apiKey", "header:authorization:token", "cookie:cookie:cookie", "body:password:password"]));
    expect(JSON.stringify(entry.credentials)).not.toContain(SECRET);
  });

  it("redacts form and multipart field values and keeps their names", () => {
    const entry = entryOf(
      harEntry({
        method: "POST",
        url: "https://a.test/form",
        requestBody: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "sku", value: "W-1" }, { name: "client_secret", value: `${SECRET}-F` }] },
      }),
    );
    expect(entry.requestBody).toEqual({ kind: "available", format: "form", value: { sku: "W-1", client_secret: "[redacted:token]" } });
    const multipart = entryOf(
      harEntry({
        method: "POST",
        url: "https://a.test/up",
        requestBody: { mimeType: "multipart/form-data; boundary=x", params: [{ name: "caption", value: "c" }, { name: "api_token", value: `${SECRET}-M` }, { name: "f", fileName: "a.png", contentType: "image/png" }] },
      }),
    );
    expect(JSON.stringify(multipart)).not.toContain(SECRET);
    expect(multipart.requestBody).toMatchObject({ kind: "unavailable", reason: "multipart-file", formFields: { caption: "c", api_token: "[redacted:token]" } });
  });

  it("replaces a path segment that is a credential by shape", () => {
    const entry = entryOf(harEntry({ url: `https://a.test/files/eyJhbGciOiJub25lIn0.${SECRET}.sig` }));
    expect(entry.path).toBe("/files/[redacted:token]");
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(entry.credentials.some((c) => c.location === "path")).toBe(true);
  });
});
