import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveDbPath, resolveKeyPath } from "./config";
import { createCredentialCipher, createEphemeralCredentialCipher, type CredentialCipher } from "./credentialCipher";
import { PersistenceInitializationError } from "./errors";

/**
 * Owns the single `better-sqlite3` handle for the process (or for one test), plus the
 * credential cipher tied to the same file location (specs/025-local-persistence-layer
 * research.md D1/D7/D8). Every repository (`environmentRepository.ts`,
 * `executionRunRepository.ts`, `aiDiagnosticsRepository.ts`) is built on top of this — nothing
 * outside this module imports `better-sqlite3` directly (constitution XXVIII).
 */
export class SqliteConnection {
  readonly db: Database.Database;
  readonly cipher: CredentialCipher;

  constructor(dbPath: string) {
    // `better-sqlite3` does not validate the file format until the first statement actually
    // runs against it — `new Database(dbPath)` on a corrupted file succeeds, and
    // `initializeSchema()`'s `db.exec(...)` is what actually throws "file is not a database".
    // Both must be inside this try/catch, or a corrupted file escapes as a raw, unhandled
    // exception instead of the clean, diagnosable `PersistenceInitializationError` FR-007
    // requires.
    let opened: Database.Database | undefined;
    try {
      // A fresh install has no `~/.apipilot/` (or a custom `APIPILOT_DB_PATH`'s parent
      // directory) yet — `better-sqlite3` does not create missing directories itself, only the
      // final file, so first-run startup would otherwise fail with "directory does not exist"
      // (FR-005: initialization must be automatic, not require the operator to pre-create it).
      if (dbPath !== ":memory:") {
        mkdirSync(path.dirname(dbPath), { recursive: true });
      }
      opened = new Database(dbPath);
      this.db = opened;
      // A `:memory:` connection (every automated test, research.md D10) never touches disk for
      // its credential key either — an ephemeral in-process key is generated instead of a file
      // named literally ":memory:.key" in the working directory.
      this.cipher =
        dbPath === ":memory:" ? createEphemeralCredentialCipher() : createCredentialCipher(resolveKeyPath(dbPath));
      this.initializeSchema();
    } catch (cause) {
      // Release the file handle before surfacing the failure — otherwise a corrupted file stays
      // locked by this process even though startup is about to abort (Windows in particular
      // holds an exclusive lock until the handle is closed).
      opened?.close();
      throw new PersistenceInitializationError(dbPath, cause);
    }
  }

  /**
   * Idempotent — safe to call on every open (research.md D8). No migration framework: this is
   * a v1 schema, so `CREATE TABLE IF NOT EXISTS` is the smallest correct mechanism
   * (constitution XXVII). `PRAGMA user_version` reserves a documented starting point for a
   * future schema change to react to, without building that mechanism now.
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        tier TEXT NOT NULL,
        base_url TEXT NOT NULL,
        variable_values_encrypted BLOB NOT NULL,
        variable_values_iv BLOB NOT NULL,
        request_delay_ms INTEGER NOT NULL,
        UNIQUE (session_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_environments_session ON environments(session_id);

      CREATE TABLE IF NOT EXISTS execution_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        environment_snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        results TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL,
        cancel_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_execution_runs_session ON execution_runs(session_id);

      CREATE TABLE IF NOT EXISTS ai_readiness_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state TEXT NOT NULL,
        reason TEXT,
        model_id TEXT,
        accelerator_requested INTEGER NOT NULL,
        accelerator_active INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
    // FR-017a (2026-09-20 amendment): added after the v1 schema above shipped, so an existing
    // on-disk DB needs these two columns added explicitly — `CREATE TABLE IF NOT EXISTS` alone
    // is a no-op against a table that already exists. Nullable: a row predating this amendment,
    // or one from a non-"local" run, simply has no raw-capture data.
    this.ensureColumn("execution_runs", "raw_captures_encrypted", "BLOB");
    this.ensureColumn("execution_runs", "raw_captures_iv", "BLOB");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_at TEXT NOT NULL,
        workload_set_id TEXT NOT NULL,
        candidates TEXT NOT NULL,
        selected_model_id TEXT NOT NULL,
        selection_rationale TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }

  /** Idempotent single-column migration helper (see the FR-017a comment above its call site). */
  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  close(): void {
    this.db.close();
  }
}

let shared: SqliteConnection | undefined;

/**
 * The process-wide connection, opened lazily on first use and resolved from
 * `APIPILOT_DB_PATH`/its default (config.ts). `backend/src/server.ts` calls this once, early,
 * specifically to surface `PersistenceInitializationError` before the HTTP listener starts
 * (FR-005/FR-007/FR-010, SC-004).
 */
export function getSharedConnection(): SqliteConnection {
  if (!shared) {
    shared = new SqliteConnection(resolveDbPath());
  }
  return shared;
}

/**
 * Test-only: replaces the shared connection with a caller-provided one (a fresh `:memory:`
 * connection in practice — see `tests/setup/testDb.ts`) so tests never touch a real on-disk
 * database (FR-011, research.md D10).
 */
export function setSharedConnectionForTest(connection: SqliteConnection): void {
  shared = connection;
}
