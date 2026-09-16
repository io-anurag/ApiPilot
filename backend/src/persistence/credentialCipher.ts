import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Encrypts `Environment.variableValues` at rest (specs/025-local-persistence-layer research.md
 * D7) — the one field explicitly known to carry credential-like values (specs/017/018). Uses
 * Node's built-in `node:crypto` (AES-256-GCM) rather than a new dependency (constitution §5,
 * "smallest dependency that solves the actual requirement"). The symmetric key lives in a
 * separate sibling file, not inside the DB, so a copied DB file alone cannot be decrypted.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Reads the key file at `keyPath`, generating a new random key on first use if absent. */
function loadOrCreateKey(keyPath: string): Buffer {
  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export interface CredentialCipher {
  /** Encrypts `plaintext`, returning ciphertext (with the GCM auth tag appended) and its IV. */
  encrypt(plaintext: string): { ciphertext: Buffer; iv: Buffer };
  /** Decrypts `ciphertext` (as produced by `encrypt`) using `iv`. */
  decrypt(ciphertext: Buffer, iv: Buffer): string;
}

export function createCredentialCipher(keyPath: string): CredentialCipher {
  return cipherFromKey(loadOrCreateKey(keyPath));
}

/**
 * An in-memory-only key, never written to disk — used for `:memory:` test connections
 * (research.md D10) so a test run never creates a stray key file on disk (FR-011).
 */
export function createEphemeralCredentialCipher(): CredentialCipher {
  return cipherFromKey(randomBytes(KEY_BYTES));
}

function cipherFromKey(key: Buffer): CredentialCipher {
  return {
    encrypt(plaintext: string) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return { ciphertext: Buffer.concat([encrypted, authTag]), iv };
    },
    decrypt(ciphertext: Buffer, iv: Buffer) {
      const authTag = ciphertext.subarray(-16);
      const encrypted = ciphertext.subarray(0, -16);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
    },
  };
}
