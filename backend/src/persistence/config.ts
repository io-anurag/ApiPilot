import os from "node:os";
import path from "node:path";

/**
 * Local SQLite database file path (specs/025-local-persistence-layer research.md D2), mirroring
 * `backend/src/ai/modelConfig.ts`'s `AI_MODEL_CACHE_DIR` convention: an env-configurable path
 * with a safe default under the user's home directory, no external config library.
 */
const DEFAULT_DB_PATH = path.join(os.homedir(), ".apipilot", "apipilot.db");

/** Reads `APIPILOT_DB_PATH` from `env` (defaulting to `process.env`), falling back when unset. */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.APIPILOT_DB_PATH?.trim();
  return raw ? raw : DEFAULT_DB_PATH;
}

/**
 * Reads the optional `APIPILOT_KEY` override: the raw 32-byte AES key, encoded as 64 hex
 * characters or base64. Returns `undefined` when unset or blank (the key file is used instead).
 * A set-but-malformed value throws rather than silently falling back to the key file, so a
 * typo can never leave credentials encrypted under a key the operator did not intend.
 */
export function resolveEnvKey(env: NodeJS.ProcessEnv = process.env): Buffer | undefined {
  const raw = env.APIPILOT_KEY?.trim();
  if (!raw) {
    return undefined;
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APIPILOT_KEY must be a 32-byte key encoded as 64 hex characters or base64");
  }
  return key;
}

/**
 * The symmetric key file used to encrypt/decrypt credential-like environment values
 * (research.md D7) — a sibling of the DB file, not inside it, so a copied DB alone is
 * insufficient to decrypt credentials.
 */
export function resolveKeyPath(dbPath: string): string {
  return `${dbPath}.key`;
}
