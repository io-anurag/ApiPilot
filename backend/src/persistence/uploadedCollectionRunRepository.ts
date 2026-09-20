import type {
  EnvironmentTier,
  ExecutionRunStatus,
  RawRequestCapture,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { RunNotFoundError } from "../externalCollections/errors";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for `uploadedCollectionExecutionStore.ts`, mirroring
 * `executionRunRepository.ts` exactly (research.md D7) — including its FR-017a raw-capture
 * encrypted-column handling for `tier === "local"` — but against the separate
 * `uploaded_collection_runs` table rather than `execution_runs`, since the two run kinds are
 * never merged into one table (research.md D7).
 */
export interface UploadedCollectionRunRepository {
  listBySession(sessionId: string): UploadedCollectionExecutionRun[];
  get(sessionId: string, runId: string): UploadedCollectionExecutionRun | undefined;
  getInProgress(sessionId: string): UploadedCollectionExecutionRun | undefined;
  create(sessionId: string, run: UploadedCollectionExecutionRun): void;
  appendResult(sessionId: string, runId: string, result: UploadedRequestResult): UploadedCollectionExecutionRun;
  settle(
    sessionId: string,
    runId: string,
    status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
    cancelReason?: "user-requested" | "backend-restart",
  ): UploadedCollectionExecutionRun;
  requestCancel(sessionId: string, runId: string): UploadedCollectionExecutionRun;
  deleteBySession(sessionId: string): void;
  markInterruptedRunsCancelled(): void;
}

interface UploadedCollectionRunRow {
  id: string;
  session_id: string;
  uploaded_collection_set_id: string;
  uploaded_collection_snapshot: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  results: string;
  raw_captures_encrypted: Buffer | null;
  raw_captures_iv: Buffer | null;
  cancel_requested: number;
  cancel_reason: string | null;
}

function emptySummary(): UploadedCollectionExecutionRun["summary"] {
  return { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 };
}

function recomputeSummary(
  startedAt: string,
  results: UploadedRequestResult[],
): UploadedCollectionExecutionRun["summary"] {
  const startedAtMs = new Date(startedAt).getTime();
  let latestMs = startedAtMs;
  const summary = emptySummary();
  summary.total = results.length;
  for (const result of results) {
    if (result.outcome === "passed") summary.passed += 1;
    else if (result.outcome === "failed") summary.failed += 1;
    else summary.notAttempted += 1;
    const settledAtMs = new Date(result.startedAt).getTime() + result.durationMs;
    if (settledAtMs > latestMs) latestMs = settledAtMs;
  }
  summary.durationMs = Math.max(0, latestMs - startedAtMs);
  return summary;
}

export class SqliteUploadedCollectionRunRepository implements UploadedCollectionRunRepository {
  constructor(private readonly connection: SqliteConnection) {}

  private decryptRawCaptures(row: UploadedCollectionRunRow): Array<RawRequestCapture | null> {
    if (!row.raw_captures_encrypted || !row.raw_captures_iv) return [];
    const json = this.connection.cipher.decrypt(row.raw_captures_encrypted, row.raw_captures_iv);
    return JSON.parse(json) as Array<RawRequestCapture | null>;
  }

  private toRun(row: UploadedCollectionRunRow): UploadedCollectionExecutionRun {
    const results = JSON.parse(row.results) as UploadedRequestResult[];
    const rawCaptures = this.decryptRawCaptures(row);
    const mergedResults =
      rawCaptures.length === 0
        ? results
        : results.map((result, index) => {
            const rawCapture = rawCaptures[index];
            return rawCapture ? { ...result, rawCapture } : result;
          });
    return {
      id: row.id,
      source: "uploaded",
      uploadedCollectionSetId: row.uploaded_collection_set_id,
      uploadedCollectionSnapshot: JSON.parse(row.uploaded_collection_snapshot) as {
        name: string;
        tier: EnvironmentTier;
      },
      status: row.status as ExecutionRunStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      summary: recomputeSummary(row.started_at, mergedResults),
      results: mergedResults,
      cancelRequested: row.cancel_requested === 1,
      cancelReason: (row.cancel_reason as "user-requested" | "backend-restart" | null) ?? undefined,
    };
  }

  listBySession(sessionId: string): UploadedCollectionExecutionRun[] {
    const rows = this.connection.db
      .prepare("SELECT * FROM uploaded_collection_runs WHERE session_id = ? ORDER BY started_at DESC, rowid DESC")
      .all(sessionId) as UploadedCollectionRunRow[];
    return rows.map((row) => this.toRun(row));
  }

  private getRow(sessionId: string, runId: string): UploadedCollectionRunRow | undefined {
    return this.connection.db
      .prepare("SELECT * FROM uploaded_collection_runs WHERE session_id = ? AND id = ?")
      .get(sessionId, runId) as UploadedCollectionRunRow | undefined;
  }

  get(sessionId: string, runId: string): UploadedCollectionExecutionRun | undefined {
    const row = this.getRow(sessionId, runId);
    return row ? this.toRun(row) : undefined;
  }

  getInProgress(sessionId: string): UploadedCollectionExecutionRun | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM uploaded_collection_runs WHERE session_id = ? AND status = 'in-progress'")
      .get(sessionId) as UploadedCollectionRunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  create(sessionId: string, run: UploadedCollectionExecutionRun): void {
    const capturesEnabled = run.uploadedCollectionSnapshot.tier === "local";
    const initialCaptures = capturesEnabled ? this.connection.cipher.encrypt(JSON.stringify([])) : undefined;
    this.connection.db
      .prepare(
        `INSERT INTO uploaded_collection_runs
           (id, session_id, uploaded_collection_set_id, uploaded_collection_snapshot, status, started_at,
            completed_at, results, cancel_requested, cancel_reason, raw_captures_encrypted, raw_captures_iv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        sessionId,
        run.uploadedCollectionSetId,
        JSON.stringify(run.uploadedCollectionSnapshot),
        run.status,
        run.startedAt,
        run.completedAt ?? null,
        JSON.stringify(run.results),
        run.cancelRequested ? 1 : 0,
        run.cancelReason ?? null,
        initialCaptures?.ciphertext ?? null,
        initialCaptures?.iv ?? null,
      );
  }

  appendResult(sessionId: string, runId: string, result: UploadedRequestResult): UploadedCollectionExecutionRun {
    const row = this.getRow(sessionId, runId);
    if (!row) throw new RunNotFoundError(runId);
    const { rawCapture, ...safeResult } = result;
    const results = [...(JSON.parse(row.results) as UploadedRequestResult[]), safeResult];

    const capturesEnabled =
      (JSON.parse(row.uploaded_collection_snapshot) as { tier: EnvironmentTier }).tier === "local";
    if (!capturesEnabled) {
      this.connection.db
        .prepare("UPDATE uploaded_collection_runs SET results = ? WHERE session_id = ? AND id = ?")
        .run(JSON.stringify(results), sessionId, runId);
      return this.get(sessionId, runId)!;
    }

    const rawCaptures = [...this.decryptRawCaptures(row), rawCapture ?? null];
    const encrypted = this.connection.cipher.encrypt(JSON.stringify(rawCaptures));
    this.connection.db
      .prepare(
        "UPDATE uploaded_collection_runs SET results = ?, raw_captures_encrypted = ?, raw_captures_iv = ? WHERE session_id = ? AND id = ?",
      )
      .run(JSON.stringify(results), encrypted.ciphertext, encrypted.iv, sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  settle(
    sessionId: string,
    runId: string,
    status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
    cancelReason?: "user-requested" | "backend-restart",
  ): UploadedCollectionExecutionRun {
    if (!this.get(sessionId, runId)) throw new RunNotFoundError(runId);
    this.connection.db
      .prepare(
        "UPDATE uploaded_collection_runs SET status = ?, completed_at = ?, cancel_reason = ? WHERE session_id = ? AND id = ?",
      )
      .run(status, new Date().toISOString(), cancelReason ?? null, sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  requestCancel(sessionId: string, runId: string): UploadedCollectionExecutionRun {
    if (!this.get(sessionId, runId)) throw new RunNotFoundError(runId);
    this.connection.db
      .prepare("UPDATE uploaded_collection_runs SET cancel_requested = 1 WHERE session_id = ? AND id = ?")
      .run(sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM uploaded_collection_runs WHERE session_id = ?").run(sessionId);
  }

  markInterruptedRunsCancelled(): void {
    this.connection.db
      .prepare(
        `UPDATE uploaded_collection_runs
         SET status = 'cancelled', cancel_reason = 'backend-restart', completed_at = ?
         WHERE status = 'in-progress'`,
      )
      .run(new Date().toISOString());
  }
}

let singleton: UploadedCollectionRunRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getUploadedCollectionRunRepository(): UploadedCollectionRunRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteUploadedCollectionRunRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
