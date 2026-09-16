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
 * The symmetric key file used to encrypt/decrypt credential-like environment values
 * (research.md D7) — a sibling of the DB file, not inside it, so a copied DB alone is
 * insufficient to decrypt credentials.
 */
export function resolveKeyPath(dbPath: string): string {
  return `${dbPath}.key`;
}
