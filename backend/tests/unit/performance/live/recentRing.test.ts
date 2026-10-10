import { describe, expect, it } from "vitest";
import { createRecentRing, pathOfTemplate, pathOfUrl } from "../../../../src/performance/live/recentRing";

const entry = (n: number) => ({ second: n, chain: "Orders", method: "GET", path: `/orders/${n}`, status: 200, failed: false, durationMs: n });

describe("recentRing", () => {
  it("lists newest first and keeps only its capacity", () => {
    const ring = createRecentRing(3);
    for (let n = 1; n <= 5; n += 1) ring.push(entry(n));
    expect(ring.list().map((e) => e.second)).toEqual([5, 4, 3]);
  });

  it("holds only the allowed fields even when given more", () => {
    const ring = createRecentRing(2);
    ring.push({ ...entry(1), headers: { Authorization: "Bearer x" }, body: "secret" } as never);
    expect(Object.keys(ring.list()[0]!).sort()).toEqual(["chain", "durationMs", "failed", "method", "path", "second", "status"]);
  });

  it("returns copies, so a caller cannot change the ring", () => {
    const ring = createRecentRing(2);
    ring.push(entry(1));
    ring.list()[0]!.path = "/changed";
    expect(ring.list()[0]!.path).toBe("/orders/1");
  });
});

describe("path helpers", () => {
  it("keeps references unresolved and drops the base URL reference, query and fragment", () => {
    expect(pathOfTemplate("{{baseUrl}}/orders/{{id}}?token={{t}}#x")).toBe("/orders/{{id}}");
    expect(pathOfTemplate("https://user:pw@host.example/a/b?k=v")).toBe("/a/b");
    expect(pathOfTemplate("")).toBe("/");
  });

  it("drops user info, query and fragment from an absolute URL", () => {
    expect(pathOfUrl("https://user:pw@host.example/orders/1?token=abc#f")).toBe("/orders/1");
  });
});
