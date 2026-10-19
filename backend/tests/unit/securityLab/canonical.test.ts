import { describe, expect, it } from "vitest";
import { canonicalJson, hash16, hash64 } from "../../../src/securityLab/canonical";

describe("canonical JSON and hashes", () => {
  it("is independent of key order, at any depth", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "z" } };
    const b = { a: { c: "z", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hash16(a)).toBe(hash16(b));
    expect(hash64(a)).toBe(hash64(b));
  });

  it("drops undefined members but keeps null, so absence and null differ only where the content does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }));
  });

  it("keeps array order significant", () => {
    expect(hash16([1, 2])).not.toBe(hash16([2, 1]));
  });

  it("returns fixed-length lowercase hex", () => {
    expect(hash16({ any: "thing" })).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64({ any: "thing" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when content changes by one character", () => {
    expect(hash64({ a: "x" })).not.toBe(hash64({ a: "y" }));
  });
});
