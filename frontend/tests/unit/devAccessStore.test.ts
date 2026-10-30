// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AccessStore,
  MAX_TOKENS_PER_ADDRESS,
  MAX_TOKENS_TOTAL,
  createAccessToken,
} from "../../devAccess/accessStore";
import { isIntranetAddress, normalizeClientAddress } from "../../devAccess/clientAddress";

describe("createAccessToken", () => {
  it("is 43 base64url characters (256 bits) and differs every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createAccessToken()));
    expect(tokens.size).toBe(50);
    for (const value of tokens) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("AccessStore (specs/060 FR-003, FR-006, FR-008, FR-009)", () => {
  it("accepts a token only from the address it was issued to", () => {
    const store = new AccessStore();
    const token = store.issue("192.168.1.20");
    expect(token).toBeDefined();
    expect(store.verify(token ?? "", "192.168.1.20")).toBe(true);
    expect(store.verify(token ?? "", "192.168.1.21")).toBe(false);
  });

  it("gives each device its own token, each valid only for itself", () => {
    const store = new AccessStore();
    const a = store.issue("10.0.0.1") ?? "";
    const b = store.issue("10.0.0.2") ?? "";
    expect(a).not.toBe(b);
    expect(store.verify(a, "10.0.0.2")).toBe(false);
    expect(store.verify(b, "10.0.0.1")).toBe(false);
  });

  it("rejects unknown, empty and truncated tokens", () => {
    const store = new AccessStore();
    const token = store.issue("10.0.0.1") ?? "";
    expect(store.verify("", "10.0.0.1")).toBe(false);
    expect(store.verify(token.slice(1), "10.0.0.1")).toBe(false);
    expect(store.verify(createAccessToken(), "10.0.0.1")).toBe(false);
  });

  it("knows nothing of another store, as after a restart", () => {
    const token = new AccessStore().issue("10.0.0.1") ?? "";
    expect(new AccessStore().verify(token, "10.0.0.1")).toBe(false);
  });

  it("replaces the oldest token of an address once it holds the per-address limit", () => {
    const store = new AccessStore();
    const tokens = Array.from(
      { length: MAX_TOKENS_PER_ADDRESS + 1 },
      () => store.issue("10.0.0.1") ?? "",
    );
    expect(store.verify(tokens[0], "10.0.0.1")).toBe(false);
    for (const token of tokens.slice(1))
      expect(store.verify(token, "10.0.0.1")).toBe(true);
  });

  it("issues nothing more once the total limit is reached, and does not disturb existing tokens", () => {
    const store = new AccessStore();
    const first = store.issue("10.0.0.0") ?? "";
    for (let i = 1; i < MAX_TOKENS_TOTAL; i += 1) {
      store.issue(`10.${Math.floor(i / 250)}.${i % 250}.1`);
    }
    expect(store.issue("172.16.0.1")).toBeUndefined();
    expect(store.verify(first, "10.0.0.0")).toBe(true);
  });
});

describe("normalizeClientAddress", () => {
  it.each([
    ["192.168.1.20", "192.168.1.20"],
    ["::ffff:192.168.1.20", "192.168.1.20"],
    ["FE80::1%eth0", "fe80::1"],
    ["::1", "::1"],
    ["not-an-address", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeClientAddress(raw)).toBe(expected);
  });
});

describe("isIntranetAddress (specs/060 FR-004)", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.5",
    "169.254.1.1",
    "100.64.0.1",
    "::1",
    "fd12:3456::1",
    "fe80::1",
  ])("treats %s as private", (address) => {
    expect(isIntranetAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "192.169.0.1",
    "2001:db8::1",
    "2606:4700::1",
    "nonsense",
  ])("treats %s as not private", (address) => {
    expect(isIntranetAddress(address)).toBe(false);
  });
});
