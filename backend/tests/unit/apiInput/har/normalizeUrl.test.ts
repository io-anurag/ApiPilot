import { describe, expect, it } from "vitest";
import { normalizePath, normalizePercentEncoding, parseEntryUrl } from "../../../../src/apiInput/har/normalizeUrl";

describe("normalizePath (contracts/har-import-rules.md, Normalization)", () => {
  it.each([
    ["/users/42", "/users/42"],
    ["", "/"],
    ["/", "/"],
    ["/users/42/", "/users/42"],
    ["/a//b///c", "/a/b/c"],
    ["/a/./b", "/a/b"],
    ["/a/b/../c", "/a/c"],
    ["/a/b/..", "/a"],
    ["/../a", "/a"],
    ["/a/%2e%2E/b", "/b"],
    ["/Users/Ada", "/Users/Ada"],
    ["/caf%C3%A9", "/caf%C3%A9"],
    ["/%7euser/%41", "/~user/A"],
    ["/a%2fb", "/a%2Fb"],
    ["/a%2Fb", "/a%2Fb"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizePath(input).path).toBe(expected);
  });

  it("keeps an encoded slash distinct from a path separator", () => {
    expect(normalizePath("/files/a%2Fb").path).not.toBe(normalizePath("/files/a/b").path);
  });

  it("preserves the case of segments", () => {
    expect(normalizePath("/V1/Orders").path).toBe("/V1/Orders");
  });

  it("counts what it folded", () => {
    expect(normalizePath("/a/b/")).toMatchObject({ trailingSlashFolded: true, duplicateSlashesCollapsed: false, dotSegmentsRemoved: 0 });
    expect(normalizePath("/a//b")).toMatchObject({ trailingSlashFolded: false, duplicateSlashesCollapsed: true });
    expect(normalizePath("/a/./b/../c")).toMatchObject({ dotSegmentsRemoved: 2 });
    expect(normalizePath("/")).toMatchObject({ trailingSlashFolded: false, duplicateSlashesCollapsed: false });
  });

  it("leaves a malformed percent escape as it is", () => {
    expect(normalizePercentEncoding("a%zzb%4")).toBe("a%zzb%4");
  });
});

describe("parseEntryUrl", () => {
  it("lower-cases scheme and host and drops default ports", () => {
    const parsed = parseEntryUrl("HTTPS://API.Example.TEST:443/v1/x?y=1#frag");
    expect(parsed).toMatchObject({ ok: true, scheme: "https", host: "api.example.test", origin: "https://api.example.test", search: "y=1" });
    expect(parseEntryUrl("http://example.test:80/")).toMatchObject({ origin: "http://example.test" });
  });

  it("keeps a non-default port in the origin", () => {
    expect(parseEntryUrl("https://example.test:8443/a")).toMatchObject({ origin: "https://example.test:8443", host: "example.test" });
  });

  it("drops the fragment and keeps only the query string as search", () => {
    const parsed = parseEntryUrl("https://a.test/p?x=1&y=2#top");
    expect(parsed.ok && parsed.search).toBe("x=1&y=2");
    expect(parsed.ok && parsed.normalization.path).toBe("/p");
  });

  it("treats a URL with no scheme as relative", () => {
    expect(parseEntryUrl("/relative/path")).toEqual({ ok: false, reason: "relative-url" });
    expect(parseEntryUrl("example.test/path")).toEqual({ ok: false, reason: "relative-url" });
    expect(parseEntryUrl("../x")).toEqual({ ok: false, reason: "relative-url" });
  });

  it("treats a URL that does not parse as invalid", () => {
    expect(parseEntryUrl("http://")).toEqual({ ok: false, reason: "invalid-url" });
    expect(parseEntryUrl("https://exa mple.test/x")).toEqual({ ok: false, reason: "invalid-url" });
  });

  it("accepts a scheme with no authority and reports it without a host", () => {
    expect(parseEntryUrl("data:text/plain,hello")).toMatchObject({ ok: true, scheme: "data", host: "", origin: "" });
  });

  it("recognizes websocket schemes with a host", () => {
    expect(parseEntryUrl("wss://api.example.test/socket")).toMatchObject({ ok: true, scheme: "wss", host: "api.example.test" });
  });

  it("never fetches: parsing an unreachable host is purely textual", () => {
    expect(parseEntryUrl("http://does-not-exist.invalid/x")).toMatchObject({ ok: true, host: "does-not-exist.invalid" });
  });
});
