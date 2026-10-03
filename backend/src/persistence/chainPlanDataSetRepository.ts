import type { DataSetColumn, DataSetInfo, DataSetMode } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-037 data sets (specs/037-request-chain-performance FR-041 to FR-046,
 * research R14). Session-scoped: every method takes the session id explicitly. The uploaded file's
 * bytes are encrypted with the connection's credential cipher, the same protection as environment
 * values (FR-044), stored as base64 inside the ciphertext so they round-trip exactly. Only the
 * name, mode, column names and secret marks, counts, size and SHA-256 are plain.
 */
export interface NewDataSet extends DataSetInfo {
  planId: string;
  content: Buffer;
  at: string;
}

export interface ChainPlanDataSetRepository {
  /** The plan's data sets in script order (position). */
  list(sessionId: string, planId: string): DataSetInfo[];
  count(sessionId: string, planId: string): number;
  /** The decrypted file, only for parsing at run time, preview and copies. Never logged. */
  content(sessionId: string, planId: string, dataSetId: string): Buffer | undefined;
  create(sessionId: string, dataSet: NewDataSet): void;
  updateMeta(sessionId: string, planId: string, dataSetId: string, meta: { name: string; mode: DataSetMode; columns: DataSetColumn[] }, at: string): void;
  replaceContent(sessionId: string, planId: string, dataSetId: string, file: { columns: DataSetColumn[]; rowCount: number; sizeBytes: number; sha256: string; content: Buffer }, at: string): void;
  delete(sessionId: string, planId: string, dataSetId: string): void;
  /** Copies one data set to another plan of the session with a new id; returns whether it existed. */
  copy(sessionId: string, fromPlanId: string, dataSetId: string, toPlanId: string, newId: string, at: string): boolean;
}

interface DataSetRow {
  id: string;
  plan_id: string;
  position: number;
  name: string;
  mode: string;
  columns: string;
  row_count: number;
  size_bytes: number;
  sha256: string;
  content_encrypted: Buffer;
  content_iv: Buffer;
}

const INFO_COLUMNS = "id, plan_id, position, name, mode, columns, row_count, size_bytes, sha256";

function toInfo(row: Omit<DataSetRow, "content_encrypted" | "content_iv">): DataSetInfo {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode === "row-per-virtual-user" ? "row-per-virtual-user" : "row-per-iteration",
    columns: JSON.parse(row.columns) as DataSetColumn[],
    rowCount: row.row_count,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
  };
}

export class SqliteChainPlanDataSetRepository implements ChainPlanDataSetRepository {
  constructor(private readonly connection: SqliteConnection) {}

  list(sessionId: string, planId: string): DataSetInfo[] {
    const rows = this.connection.db
      .prepare(`SELECT ${INFO_COLUMNS} FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ? ORDER BY position ASC, id ASC`)
      .all(sessionId, planId) as DataSetRow[];
    return rows.map(toInfo);
  }

  count(sessionId: string, planId: string): number {
    return (this.connection.db.prepare("SELECT COUNT(*) AS n FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ?").get(sessionId, planId) as { n: number }).n;
  }

  content(sessionId: string, planId: string, dataSetId: string): Buffer | undefined {
    const row = this.connection.db
      .prepare("SELECT content_encrypted, content_iv FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ? AND id = ?")
      .get(sessionId, planId, dataSetId) as Pick<DataSetRow, "content_encrypted" | "content_iv"> | undefined;
    return row ? Buffer.from(this.connection.cipher.decrypt(row.content_encrypted, row.content_iv), "base64") : undefined;
  }

  create(sessionId: string, dataSet: NewDataSet): void {
    const { ciphertext, iv } = this.connection.cipher.encrypt(dataSet.content.toString("base64"));
    const next = (this.connection.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ?").get(sessionId, dataSet.planId) as { n: number }).n;
    this.connection.db
      .prepare(
        `INSERT INTO chain_plan_data_sets
           (id, plan_id, session_id, position, name, mode, columns, row_count, size_bytes, sha256, content_encrypted, content_iv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(dataSet.id, dataSet.planId, sessionId, next, dataSet.name, dataSet.mode, JSON.stringify(dataSet.columns), dataSet.rowCount, dataSet.sizeBytes, dataSet.sha256, ciphertext, iv, dataSet.at, dataSet.at);
  }

  updateMeta(sessionId: string, planId: string, dataSetId: string, meta: { name: string; mode: DataSetMode; columns: DataSetColumn[] }, at: string): void {
    this.connection.db
      .prepare("UPDATE chain_plan_data_sets SET name = ?, mode = ?, columns = ?, updated_at = ? WHERE session_id = ? AND plan_id = ? AND id = ?")
      .run(meta.name, meta.mode, JSON.stringify(meta.columns), at, sessionId, planId, dataSetId);
  }

  replaceContent(sessionId: string, planId: string, dataSetId: string, file: { columns: DataSetColumn[]; rowCount: number; sizeBytes: number; sha256: string; content: Buffer }, at: string): void {
    const { ciphertext, iv } = this.connection.cipher.encrypt(file.content.toString("base64"));
    this.connection.db
      .prepare(
        `UPDATE chain_plan_data_sets SET columns = ?, row_count = ?, size_bytes = ?, sha256 = ?, content_encrypted = ?, content_iv = ?, updated_at = ?
         WHERE session_id = ? AND plan_id = ? AND id = ?`,
      )
      .run(JSON.stringify(file.columns), file.rowCount, file.sizeBytes, file.sha256, ciphertext, iv, at, sessionId, planId, dataSetId);
  }

  delete(sessionId: string, planId: string, dataSetId: string): void {
    this.connection.db.prepare("DELETE FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ? AND id = ?").run(sessionId, planId, dataSetId);
  }

  copy(sessionId: string, fromPlanId: string, dataSetId: string, toPlanId: string, newId: string, at: string): boolean {
    const row = this.connection.db.prepare("SELECT * FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ? AND id = ?").get(sessionId, fromPlanId, dataSetId) as DataSetRow | undefined;
    if (!row) return false;
    const content = this.content(sessionId, fromPlanId, dataSetId)!;
    this.create(sessionId, { ...toInfo(row), id: newId, planId: toPlanId, content, at });
    return true;
  }
}

let singleton: ChainPlanDataSetRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getChainPlanDataSetRepository(): ChainPlanDataSetRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteChainPlanDataSetRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
