import { randomUUID } from "node:crypto";
import type { EvidenceRecord } from "@apipilot/shared-domain";
import { onExpire } from "../session/sessionRegistry";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, **session-scoped** backing for Security Lab evidence (specs/057 research R13 and R14, FR-051).
 * Session data: the redacted evidence behind a result is removed with the session by the existing
 * `onExpire` listener, while the result's bounded observed summary (retained work) stays. Records are
 * redacted before they reach this repository and are still encrypted at rest with the credential cipher,
 * as defence in depth for response excerpts that can hold personal data. Ids are random, so nothing about a
 * record's position or content is guessable from its row.
 */
export interface SecurityEvidenceRepository {
  add(sessionId: string, ownerId: string, runId: string, resultId: string, position: number, record: EvidenceRecord): void;
  /** In the order sent. */
  list(sessionId: string, resultId: string): EvidenceRecord[];
  has(sessionId: string, resultId: string): boolean;
  /** Which of `resultIds` still have evidence in this session. */
  availableResultIds(sessionId: string, resultIds: string[]): Set<string>;
  deleteBySession(sessionId: string): void;
  /** For "delete everything": an owner's evidence in any session. */
  deleteByOwner(ownerId: string): number;
  deleteByRuns(runIds: string[]): number;
}

interface EvidenceRow {
  evidence_encrypted: Buffer;
  evidence_iv: Buffer;
}

export class SqliteSecurityEvidenceRepository implements SecurityEvidenceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  add(sessionId: string, ownerId: string, runId: string, resultId: string, position: number, record: EvidenceRecord): void {
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(record));
    this.connection.db
      .prepare(
        `INSERT INTO security_evidence (id, session_id, owner_id, run_id, result_id, position, evidence_encrypted, evidence_iv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), sessionId, ownerId, runId, resultId, position, ciphertext, iv);
  }

  list(sessionId: string, resultId: string): EvidenceRecord[] {
    const rows = this.connection.db
      .prepare("SELECT evidence_encrypted, evidence_iv FROM security_evidence WHERE session_id = ? AND result_id = ? ORDER BY position ASC")
      .all(sessionId, resultId) as EvidenceRow[];
    return rows.map((row) => JSON.parse(this.connection.cipher.decrypt(row.evidence_encrypted, row.evidence_iv)) as EvidenceRecord);
  }

  has(sessionId: string, resultId: string): boolean {
    return (
      this.connection.db
        .prepare("SELECT 1 AS present FROM security_evidence WHERE session_id = ? AND result_id = ? LIMIT 1")
        .get(sessionId, resultId) !== undefined
    );
  }

  availableResultIds(sessionId: string, resultIds: string[]): Set<string> {
    const available = new Set<string>();
    if (resultIds.length === 0) return available;
    // Chunked so a long list never exceeds SQLite's bound-parameter limit.
    for (let start = 0; start < resultIds.length; start += 500) {
      const chunk = resultIds.slice(start, start + 500);
      const rows = this.connection.db
        .prepare(
          `SELECT DISTINCT result_id FROM security_evidence WHERE session_id = ? AND result_id IN (${chunk.map(() => "?").join(", ")})`,
        )
        .all(sessionId, ...chunk) as Array<{ result_id: string }>;
      for (const row of rows) available.add(row.result_id);
    }
    return available;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM security_evidence WHERE session_id = ?").run(sessionId);
  }

  deleteByOwner(ownerId: string): number {
    return this.connection.db.prepare("DELETE FROM security_evidence WHERE owner_id = ?").run(ownerId).changes;
  }

  deleteByRuns(runIds: string[]): number {
    let removed = 0;
    for (let start = 0; start < runIds.length; start += 500) {
      const chunk = runIds.slice(start, start + 500);
      removed += this.connection.db
        .prepare(`DELETE FROM security_evidence WHERE run_id IN (${chunk.map(() => "?").join(", ")})`)
        .run(...chunk).changes;
    }
    return removed;
  }
}

let singleton: SecurityEvidenceRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test) instance, rebuilt whenever the shared connection changes. */
export function getSecurityEvidenceRepository(): SecurityEvidenceRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityEvidenceRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}

// Session data goes with the session (FR-051): only the evidence goes, never the retained result summaries.
onExpire((sessionId) => {
  getSecurityEvidenceRepository().deleteBySession(sessionId);
});
