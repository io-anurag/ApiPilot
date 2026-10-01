import type {
  K6ExitMeaning,
  PerformanceRunCancelReason,
  PerformanceRunEnvironment,
  PerformanceRunFailureCategory,
  PerformanceRunStatus,
  UserScriptResult,
  UserScriptRun,
  UserScriptRunProgress,
  UserScriptRunSnapshot,
  UserScriptRunSummary,
} from "@apipilot/shared-domain";
import { PerformanceRunNotFoundError } from "../performance/errors";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-034 user-script runs (specs/034-run-user-k6-script research R9),
 * mirroring `performanceRunRepository.ts`. Every method takes the session id explicitly, because
 * the background run calls it outside the request's AsyncLocalStorage context. The snapshot,
 * result and k6's error message come from the user's script and are encrypted.
 */
export interface UserScriptRunSettlement {
  status: Exclude<PerformanceRunStatus, "in-progress">;
  cancelReason?: PerformanceRunCancelReason;
  failure?: { category: PerformanceRunFailureCategory; k6Message?: string };
  exitCode: number | null;
  exitMeaning: K6ExitMeaning | null;
}

export interface UserScriptRunRepository {
  listBySession(sessionId: string, scriptId?: string): UserScriptRunSummary[];
  get(sessionId: string, runId: string): UserScriptRun | undefined;
  getInProgress(sessionId: string): UserScriptRunSummary | undefined;
  create(sessionId: string, run: UserScriptRun): void;
  checkpoint(sessionId: string, runId: string, update: { progress?: UserScriptRunProgress; result?: UserScriptResult }): void;
  settle(sessionId: string, runId: string, settlement: UserScriptRunSettlement, endedAt: string, result?: UserScriptResult): UserScriptRun;
  requestCancel(sessionId: string, runId: string): UserScriptRun;
  isCancelRequested(sessionId: string, runId: string): boolean;
  deleteBySession(sessionId: string): void;
  /** Returns how many runs were marked (FR-023: never started again). */
  markInterruptedRunsCancelled(): number;
}

interface UserScriptRunRow {
  id: string;
  session_id: string;
  script_id: string;
  status: string;
  cancel_reason: string | null;
  failure_category: string | null;
  cancel_requested: number;
  environment_snapshot: string;
  snapshot_encrypted: Buffer;
  snapshot_iv: Buffer;
  k6_version: string;
  k6_exit_code: number | null;
  exit_meaning: string | null;
  planned_duration_ms: number | null;
  started_at: string;
  ended_at: string | null;
  progress: string | null;
  result_encrypted: Buffer | null;
  result_iv: Buffer | null;
  failure_message_encrypted: Buffer | null;
  failure_message_iv: Buffer | null;
}

export class SqliteUserScriptRunRepository implements UserScriptRunRepository {
  constructor(private readonly connection: SqliteConnection) {}

  private decryptJson<T>(ciphertext: Buffer, iv: Buffer): T {
    return JSON.parse(this.connection.cipher.decrypt(ciphertext, iv)) as T;
  }

  private toSummary(row: UserScriptRunRow): UserScriptRunSummary {
    const summary: UserScriptRunSummary = {
      id: row.id,
      source: "user-script",
      status: row.status as PerformanceRunStatus,
      environment: JSON.parse(row.environment_snapshot) as PerformanceRunEnvironment,
      snapshot: this.decryptJson<UserScriptRunSnapshot>(row.snapshot_encrypted, row.snapshot_iv),
      k6Version: row.k6_version,
      k6ExitCode: row.k6_exit_code,
      exitMeaning: (row.exit_meaning as K6ExitMeaning | null) ?? null,
      plannedDurationMs: row.planned_duration_ms,
      startedAt: row.started_at,
      cancelRequested: row.cancel_requested === 1,
    };
    if (row.cancel_reason) summary.cancelReason = row.cancel_reason as PerformanceRunCancelReason;
    if (row.failure_category) summary.failure = { category: row.failure_category as PerformanceRunFailureCategory };
    if (row.ended_at) summary.endedAt = row.ended_at;
    return summary;
  }

  private toRun(row: UserScriptRunRow): UserScriptRun {
    const { failure, ...summary } = this.toSummary(row);
    const run: UserScriptRun = { ...summary };
    if (failure) {
      run.failure = { ...failure };
      if (row.failure_message_encrypted && row.failure_message_iv) {
        run.failure.k6Message = this.connection.cipher.decrypt(row.failure_message_encrypted, row.failure_message_iv);
      }
    }
    if (row.progress) run.progress = JSON.parse(row.progress) as UserScriptRunProgress;
    if (row.result_encrypted && row.result_iv) run.result = this.decryptJson<UserScriptResult>(row.result_encrypted, row.result_iv);
    return run;
  }

  private getRow(sessionId: string, runId: string): UserScriptRunRow | undefined {
    return this.connection.db.prepare("SELECT * FROM user_script_runs WHERE session_id = ? AND id = ?").get(sessionId, runId) as
      | UserScriptRunRow
      | undefined;
  }

  private require(sessionId: string, runId: string): UserScriptRunRow {
    const row = this.getRow(sessionId, runId);
    if (!row) throw new PerformanceRunNotFoundError(runId);
    return row;
  }

  listBySession(sessionId: string, scriptId?: string): UserScriptRunSummary[] {
    const rows = (
      scriptId === undefined
        ? this.connection.db.prepare("SELECT * FROM user_script_runs WHERE session_id = ? ORDER BY started_at DESC, rowid DESC").all(sessionId)
        : this.connection.db
            .prepare("SELECT * FROM user_script_runs WHERE session_id = ? AND script_id = ? ORDER BY started_at DESC, rowid DESC")
            .all(sessionId, scriptId)
    ) as UserScriptRunRow[];
    return rows.map((row) => this.toSummary(row));
  }

  get(sessionId: string, runId: string): UserScriptRun | undefined {
    const row = this.getRow(sessionId, runId);
    return row ? this.toRun(row) : undefined;
  }

  getInProgress(sessionId: string): UserScriptRunSummary | undefined {
    const row = this.connection.db.prepare("SELECT * FROM user_script_runs WHERE session_id = ? AND status = 'in-progress'").get(sessionId) as
      | UserScriptRunRow
      | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  create(sessionId: string, run: UserScriptRun): void {
    const snapshot = this.connection.cipher.encrypt(JSON.stringify(run.snapshot));
    this.connection.db
      .prepare(
        `INSERT INTO user_script_runs
           (id, session_id, script_id, status, cancel_reason, failure_category, cancel_requested, environment_snapshot,
            snapshot_encrypted, snapshot_iv, k6_version, k6_exit_code, exit_meaning, planned_duration_ms, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        sessionId,
        run.snapshot.scriptId,
        run.status,
        run.cancelReason ?? null,
        run.failure?.category ?? null,
        run.cancelRequested ? 1 : 0,
        JSON.stringify(run.environment),
        snapshot.ciphertext,
        snapshot.iv,
        run.k6Version,
        run.k6ExitCode,
        run.exitMeaning,
        run.plannedDurationMs,
        run.startedAt,
      );
  }

  checkpoint(sessionId: string, runId: string, update: { progress?: UserScriptRunProgress; result?: UserScriptResult }): void {
    this.require(sessionId, runId);
    if (update.progress) {
      this.connection.db.prepare("UPDATE user_script_runs SET progress = ? WHERE session_id = ? AND id = ?").run(JSON.stringify(update.progress), sessionId, runId);
    }
    if (update.result) {
      const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(update.result));
      this.connection.db.prepare("UPDATE user_script_runs SET result_encrypted = ?, result_iv = ? WHERE session_id = ? AND id = ?").run(ciphertext, iv, sessionId, runId);
    }
  }

  settle(sessionId: string, runId: string, settlement: UserScriptRunSettlement, endedAt: string, result?: UserScriptResult): UserScriptRun {
    this.require(sessionId, runId);
    const message = settlement.failure?.k6Message ? this.connection.cipher.encrypt(settlement.failure.k6Message) : null;
    this.connection.db
      .prepare(
        `UPDATE user_script_runs
         SET status = ?, cancel_reason = ?, failure_category = ?, failure_message_encrypted = ?, failure_message_iv = ?,
             k6_exit_code = ?, exit_meaning = ?, ended_at = ?
         WHERE session_id = ? AND id = ?`,
      )
      .run(
        settlement.status,
        settlement.cancelReason ?? null,
        settlement.failure?.category ?? null,
        message?.ciphertext ?? null,
        message?.iv ?? null,
        settlement.exitCode,
        settlement.exitMeaning,
        endedAt,
        sessionId,
        runId,
      );
    if (result) this.checkpoint(sessionId, runId, { result });
    return this.get(sessionId, runId)!;
  }

  requestCancel(sessionId: string, runId: string): UserScriptRun {
    this.require(sessionId, runId);
    this.connection.db.prepare("UPDATE user_script_runs SET cancel_requested = 1 WHERE session_id = ? AND id = ?").run(sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  isCancelRequested(sessionId: string, runId: string): boolean {
    return this.require(sessionId, runId).cancel_requested === 1;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM user_script_runs WHERE session_id = ?").run(sessionId);
  }

  markInterruptedRunsCancelled(): number {
    return this.connection.db
      .prepare(
        `UPDATE user_script_runs
         SET status = 'cancelled', cancel_reason = 'backend-restart', ended_at = ?
         WHERE status = 'in-progress'`,
      )
      .run(new Date().toISOString()).changes;
  }
}

let singleton: UserScriptRunRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getUserScriptRunRepository(): UserScriptRunRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteUserScriptRunRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
