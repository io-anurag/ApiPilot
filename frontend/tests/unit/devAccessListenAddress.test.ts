// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_HOST, resolveListenAddress } from "../../devAccess/listenAddress";

describe("resolveListenAddress (specs/049 FR-001, FR-002, FR-011)", () => {
  it.each([undefined, "", "   "])("treats %j as loopback and unprotected", (raw) => {
    expect(resolveListenAddress(raw)).toEqual({
      host: DEFAULT_DEV_HOST,
      loopback: true,
      wildcard: false,
      protected: false,
    });
  });

  it.each(["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]"])(
    "treats the loopback name %s as unprotected",
    (raw) => {
      const resolved = resolveListenAddress(raw);
      expect(resolved.loopback).toBe(true);
      expect(resolved.protected).toBe(false);
    },
  );

  it.each([
    ["0.0.0.0", "0.0.0.0", true],
    ["::", "::", true],
    ["[::]", "::", true],
    ["192.168.1.20", "192.168.1.20", false],
    ["2001:db8::20", "2001:db8::20", false],
    ["my-machine.local", "my-machine.local", false],
    ["  10.0.0.5  ", "10.0.0.5", false],
  ])("protects the non-loopback value %s", (raw, host, wildcard) => {
    expect(resolveListenAddress(raw)).toEqual({
      host,
      loopback: false,
      wildcard,
      protected: true,
    });
  });

  it("protects 127.0.0.2: doubt resolves toward protection", () => {
    expect(resolveListenAddress("127.0.0.2").protected).toBe(true);
  });

  it("never reports a non-loopback address as unprotected", () => {
    for (const raw of ["0.0.0.0", "::", "10.1.2.3", "host.example"]) {
      const resolved = resolveListenAddress(raw);
      expect(resolved.protected).toBe(!resolved.loopback);
      expect(resolved.protected).toBe(true);
    }
  });

  it.each([
    "not a host",
    "a b",
    "-bad.example",
    "bad-.example",
    "http://host",
    "host:5173",
    "host..example",
    `${"a".repeat(64)}.example`,
    "[",
    "999.999.999.999",
    "1.2.3",
    "10.0.0",
  ])("rejects %j, naming the setting", (raw) => {
    expect(() => resolveListenAddress(raw)).toThrow(/FRONTEND_DEV_HOST/);
  });
});

describe("loopback list", () => {
  it("matches the backend's localHostGuard, so the two cannot drift apart", () => {
    const backendSource = readFileSync(
      path.resolve(__dirname, "../../../backend/src/security/localHostGuard.ts"),
      "utf-8",
    );
    const declaration = /LOOPBACK_HOSTNAMES[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(backendSource);
    expect(declaration).not.toBeNull();
    const backendNames = [...(declaration?.[1] ?? "").matchAll(/"([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const frontendNames = ["localhost", "127.0.0.1", "::1"]
      .filter((name) => resolveListenAddress(name).loopback)
      .sort();
    expect(frontendNames).toEqual(backendNames);
    expect(backendNames).toHaveLength(3);
  });
});
