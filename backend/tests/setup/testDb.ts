import { beforeEach, afterEach } from "vitest";
import { SqliteConnection, setSharedConnectionForTest } from "../../src/persistence/connection";

/**
 * Gives every test a fresh, isolated `:memory:` SQLite connection (specs/025-local-persistence-
 * layer research.md D10), mirroring `sessionTestContext.ts`'s "ambient setup so existing tests
 * keep working unmodified" approach. No test ever opens or reads the real `APIPILOT_DB_PATH`
 * file (FR-011) — a fresh in-memory database exists only for the duration of one test.
 */
let current: SqliteConnection | undefined;

beforeEach(() => {
  current = new SqliteConnection(":memory:");
  setSharedConnectionForTest(current);
});

afterEach(() => {
  current?.close();
  current = undefined;
});
