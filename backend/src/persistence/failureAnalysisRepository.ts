import type { FailureAnalysis } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-031 failure analyses (specs/030-ai-failure-analysis research D9). One
 * row per `(session, run, result position)`; the whole `FailureAnalysis` is encrypted at rest,
 * because it is derived from raw captures that are themselves stored encrypted.
 */
export interface FailureAnalysisRepository {
  upsert(sessionId: string, analysis: FailureAnalysis): void;
  get(sessionId: string, runId: string, resultIndex: number): FailureAnalysis | undefined;
  listByRun(sessionId: string, runId: string): FailureAnalysis[];
  deleteBySession(sessionId: string): void;
}

interface FailureAnalysisRow {
  analysis_encrypted: Buffer;
  analysis_iv: Buffer;
}

export class SqliteFailureAnalysisRepository implements FailureAnalysisRepository {
  constructor(private readonly connection: SqliteConnection) {}

  private decrypt(row: FailureAnalysisRow): FailureAnalysis {
    const json = this.connection.cipher.decrypt(row.analysis_encrypted, row.analysis_iv);
    return JSON.parse(json) as FailureAnalysis;
  }

  upsert(sessionId: string, analysis: FailureAnalysis): void {
    const encrypted = this.connection.cipher.encrypt(JSON.stringify(analysis));
    this.connection.db
      .prepare(
        `INSERT INTO failure_analyses
           (session_id, run_id, result_index, generated_at, analysis_encrypted, analysis_iv)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, run_id, result_index) DO UPDATE SET
           generated_at = excluded.generated_at,
           analysis_encrypted = excluded.analysis_encrypted,
           analysis_iv = excluded.analysis_iv`,
      )
      .run(
        sessionId,
        analysis.runId,
        analysis.resultIndex,
        analysis.provenance.generatedAt,
        encrypted.ciphertext,
        encrypted.iv,
      );
  }

  get(sessionId: string, runId: string, resultIndex: number): FailureAnalysis | undefined {
    const row = this.connection.db
      .prepare(
        `SELECT analysis_encrypted, analysis_iv FROM failure_analyses
         WHERE session_id = ? AND run_id = ? AND result_index = ?`,
      )
      .get(sessionId, runId, resultIndex) as FailureAnalysisRow | undefined;
    return row ? this.decrypt(row) : undefined;
  }

  listByRun(sessionId: string, runId: string): FailureAnalysis[] {
    const rows = this.connection.db
      .prepare(
        `SELECT analysis_encrypted, analysis_iv FROM failure_analyses
         WHERE session_id = ? AND run_id = ? ORDER BY result_index ASC`,
      )
      .all(sessionId, runId) as FailureAnalysisRow[];
    return rows.map((row) => this.decrypt(row));
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM failure_analyses WHERE session_id = ?").run(sessionId);
  }
}

let singleton: SqliteFailureAnalysisRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getFailureAnalysisRepository(): FailureAnalysisRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteFailureAnalysisRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
