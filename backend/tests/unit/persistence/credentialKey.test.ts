import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEnvKey } from "../../../src/persistence/config";
import { createCredentialCipher } from "../../../src/persistence/credentialCipher";

const HEX_KEY = "ab".repeat(32);
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("resolveEnvKey", () => {
  it("returns undefined when unset or blank", () => {
    expect(resolveEnvKey({})).toBeUndefined();
    expect(resolveEnvKey({ APIPILOT_KEY: "  " })).toBeUndefined();
  });

  it("accepts 64 hex characters and 32-byte base64", () => {
    expect(resolveEnvKey({ APIPILOT_KEY: HEX_KEY })).toEqual(Buffer.alloc(32, 0xab));
    expect(resolveEnvKey({ APIPILOT_KEY: Buffer.alloc(32, 7).toString("base64") })).toEqual(Buffer.alloc(32, 7));
  });

  it("rejects a malformed key instead of falling back to the key file", () => {
    expect(() => resolveEnvKey({ APIPILOT_KEY: "too-short" })).toThrow(/APIPILOT_KEY/);
  });
});

describe("createCredentialCipher with an env key", () => {
  it("encrypts under the env key and creates no key file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-key-"));
    dirs.push(dir);
    const keyPath = path.join(dir, "db.key");
    const key = resolveEnvKey({ APIPILOT_KEY: HEX_KEY });

    const { ciphertext, iv } = createCredentialCipher(keyPath, key).encrypt("secret");

    expect(existsSync(keyPath)).toBe(false);
    expect(createCredentialCipher(keyPath, key).decrypt(ciphertext, iv)).toBe("secret");
  });

  it("does not decrypt data encrypted under a different key", () => {
    const keyPath = path.join(os.tmpdir(), "unused.key");
    const a = createCredentialCipher(keyPath, Buffer.alloc(32, 1)).encrypt("secret");
    expect(() => createCredentialCipher(keyPath, Buffer.alloc(32, 2)).decrypt(a.ciphertext, a.iv)).toThrow();
  });
});
