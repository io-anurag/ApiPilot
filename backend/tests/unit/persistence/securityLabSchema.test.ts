import { describe, expect, it } from "vitest";
import { SqliteConnection } from "../../../src/persistence/connection";

/** specs/057 research R13: nine tables, six owner-keyed (retained work) and three session-keyed. */

const OWNER_TABLES = [
  "security_scenarios",
  "security_scenario_versions",
  "security_runs",
  "security_run_results",
  "security_findings",
  "security_settings",
];
const SESSION_TABLES = ["security_profiles", "security_evidence", "security_credentials"];

function columnsOf(connection: SqliteConnection, table: string): string[] {
  return (connection.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

describe("Security Lab schema", () => {
  const connection = new SqliteConnection(":memory:");

  it("creates every table", () => {
    const names = (connection.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    for (const table of [...OWNER_TABLES, ...SESSION_TABLES]) expect(names).toContain(table);
  });

  it("keys retained work by owner and never by session alone", () => {
    for (const table of OWNER_TABLES) expect(columnsOf(connection, table)).toContain("owner_id");
    expect(columnsOf(connection, "security_scenarios")).not.toContain("session_id");
    expect(columnsOf(connection, "security_findings")).not.toContain("session_id");
  });

  it("keys session data by session, and keeps evidence encrypted with its own iv", () => {
    for (const table of SESSION_TABLES) expect(columnsOf(connection, table)).toContain("session_id");
    expect(columnsOf(connection, "security_evidence")).toEqual(
      expect.arrayContaining(["evidence_encrypted", "evidence_iv", "result_id", "run_id", "owner_id"]),
    );
  });

  it("holds no credential, profile or raw-evidence column in the retained tables", () => {
    const forbidden = /(token|secret|password|credential|evidence_encrypted|body|profile(?!_summary)|identity|identities|test_data)/i;
    for (const table of OWNER_TABLES) {
      for (const column of columnsOf(connection, table)) {
        expect(column, `${table}.${column}`).not.toMatch(forbidden);
      }
    }
  });

  it("lets two owners hold the same content-derived scenario id", () => {
    const insert = connection.db.prepare(
      `INSERT INTO security_scenarios (owner_id, id, assessment_key, assessment_label, current_version, review_state,
         execution_status, origin, operation_key, category_id, severity, destructive, title, created_at, updated_at)
       VALUES (?, 'ss-1', 'a', 'A', 1, 'draft', 'not_run', 'rule', 'GET /x', 'authentication', 'high', 0, 't', 'now', 'now')`,
    );
    insert.run("owner-1");
    insert.run("owner-2");
    expect(() => insert.run("owner-1")).toThrow();
  });

  it("allows at most one finding per owner, scenario and version", () => {
    const insert = connection.db.prepare(
      `INSERT INTO security_findings (owner_id, id, assessment_key, scenario_id, scenario_version, operation_key, category_id,
         severity, status, unreviewed_occurrence, occurrence_count, first_failed_at, latest_failed_at, document)
       VALUES ('o', ?, 'a', 'ss-1', 1, 'GET /x', 'authentication', 'high', 'open', 0, 1, 'now', 'now', '{}')`,
    );
    insert.run("sf-1");
    expect(() => insert.run("sf-2")).toThrow(/UNIQUE/);
  });

  it("is idempotent when the schema is initialised again on the same file", () => {
    expect(() => new SqliteConnection(":memory:")).not.toThrow();
  });
});
