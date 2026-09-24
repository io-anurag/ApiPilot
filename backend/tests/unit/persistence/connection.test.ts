import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        "failure_analyses",
        "sqlite_sequence",
        "uploaded_collection_runs",
        "uploaded_collections",
      ]);
      connection.close();
    } finally {
      rmSyncRetrying(dir);
    }
  });

  it("adds the failure_analyses table to a database created before it existed, idempotently (AP-031)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
    const dbPath = path.join(dir, "apipilot.db");
    try {
      const first = new SqliteConnection(dbPath);
      first.db.exec("DROP TABLE failure_analyses");
      first.close();

      const reopened = new SqliteConnection(dbPath);
      reopened.close();
      const again = new SqliteConnection(dbPath);
      const tables = again.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'failure_analyses'")
        .all();
      expect(tables).toHaveLength(1);
      again.close();
    } finally {
      rmSyncRetrying(dir);
    }
  });

  describe("legacy failure analyses (specs/030-ai-failure-analysis research D19)", () => {
    afterEach(() => vi.restoreAllMocks());

    function captureLogs(): string[] {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      return lines;
    }

    const insertRow = (connection: SqliteConnection, resultIndex: number, version?: number) =>
      connection.db
        .prepare(
          version === undefined
            ? `INSERT INTO failure_analyses (session_id, run_id, result_index, generated_at, analysis_encrypted, analysis_iv)
               VALUES ('s1', 'r1', ?, '2026-09-23T00:00:00.000Z', x'00', x'00')`
            : `INSERT INTO failure_analyses (session_id, run_id, result_index, generated_at, analysis_encrypted, analysis_iv, analysis_version)
               VALUES ('s1', 'r1', ?, '2026-09-24T00:00:00.000Z', x'00', x'00', ${version})`,
        )
        .run(resultIndex);

    it("adds analysis_version and removes rows written by the AI-decided version, logging the count once", () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "apipilot-test-"));
      const dbPath = path.join(dir, "apipilot.db");
      try {
        // Recreate the table as it was before the amendment, with two legacy rows.
        const first = new SqliteConnection(dbPath);
        first.db.exec(`DROP TABLE failure_analyses;
          CREATE TABLE failure_analyses (session_id TEXT NOT NULL, run_id TEXT NOT NULL, result_index INTEGER NOT NULL,
            generated_at TEXT NOT NULL, analysis_encrypted BLOB NOT NULL, analysis_iv BLOB NOT NULL,
            PRIMARY KEY (session_id, run_id, result_index));`);
        insertRow(first, 0);
        insertRow(first, 1);
        first.close();

        const lines = captureLogs();
        const migrated = new SqliteConnection(dbPath);
        const columns = migrated.db.prepare("PRAGMA table_info(failure_analyses)").all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("analysis_version");
        expect(migrated.db.prepare("SELECT COUNT(*) AS n FROM failure_analyses").get()).toEqual({ n: 0 });
        const removals = lines.filter((line) => line.includes("failure_analyses_legacy_removed"));
        expect(removals).toHaveLength(1);
        expect(JSON.parse(removals[0]).count).toBe(2);

        insertRow(migrated, 2, 2);
        migrated.close();

        const again = new SqliteConnection(dbPath);
        expect(again.db.prepare("SELECT COUNT(*) AS n FROM failure_analyses").get()).toEqual({ n: 1 });
        expect(lines.filter((line) => line.includes("failure_analyses_legacy_removed"))).toHaveLength(1);
        again.close();
      } finally {
        rmSyncRetrying(dir);
      }
    });
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
