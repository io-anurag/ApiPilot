import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteConnection } from "../../../src/persistence/connection";
import { PersistenceInitializationError } from "../../../src/persistence/errors";

/**
 * Windows can briefly keep a just-closed SQLite file handle locked (AV scanning, delayed
 * handle release); retrying a couple of times avoids flaking on cleanup rather than on the
 * behavior actually under test.
 */
function rmSyncRetrying(target: string): void {
  const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(sleepBuffer, 0, 0, 50); // brief synchronous pause before retrying
    }
  }
}

describe("SqliteConnection", () => {
  it("throws PersistenceInitializationError for a corrupted/non-database file, leaving it untouched (FR-007)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "apipilot.db");
    writeFileSync(dbPath, "not a sqlite file");
    try {
      expect(() => new SqliteConnection(dbPath)).toThrow(PersistenceInitializationError);
      expect(readFileSync(dbPath, "utf-8")).toBe("not a sqlite file");
    } finally {
      rmSyncRetrying(dir);
    }
  });

  it("initializes an empty schema on first open of a fresh file", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "apipilot.db");
    try {
      const connection = new SqliteConnection(dbPath);
      const tables = connection.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      // "sqlite_sequence" is SQLite's own bookkeeping table for AUTOINCREMENT columns, not one
      // this schema defines.
      expect(tables.map((t) => t.name).sort()).toEqual([
        "ai_readiness_history",
        "benchmark_runs",
        "environments",
        "execution_runs",
        "sqlite_sequence",
        "uploaded_collection_runs",
        "uploaded_collections",
      ]);
      connection.close();
    } finally {
      rmSyncRetrying(dir);
    }
  });

  it("creates missing parent directories on first run, matching a fresh install with no ~/.apipilot yet (FR-005)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "nested", "does", "not", "exist", "apipilot.db");
    try {
      const connection = new SqliteConnection(dbPath);
      expect(readFileSync(dbPath).length).toBeGreaterThan(0);
      connection.close();
    } finally {
      rmSyncRetrying(dir);
    }
  });
});
