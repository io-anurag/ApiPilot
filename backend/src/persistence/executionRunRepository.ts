import type {
  Environment,
  ExecutionRun,
  ExecutionRunStatus,
  RawRequestCapture,
  RequestResult,
} from "@apipilot/shared-domain";
import { RunNotFoundError } from "../execution/errors";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for `executionRunStore.ts` (specs/025-local-persistence-layer contracts/
 * persistence-repositories.md). Session-scoped, mirroring the in-memory
 * `Map<sessionId, SessionRunState>` this replaces (research.md D4). `summary` is never a column
 * — it is always recomputed from `results` on read, exactly as `recomputeSummary` did before.
 */
export interface ExecutionRunRepository {
  listBySession(sessionId: string): ExecutionRun[];
  get(sessionId: string, runId: string): ExecutionRun | undefined;
  getInProgress(sessionId: string): ExecutionRun | undefined;
  create(sessionId: string, run: ExecutionRun): void;
  appendResult(sessionId: string, runId: string, result: RequestResult): ExecutionRun;
  settle(
    sessionId: string,
    runId: string,
    status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
    cancelReason?: "user-requested" | "backend-restart",
  ): ExecutionRun;
  requestCancel(sessionId: string, runId: string): ExecutionRun;
  deleteBySession(sessionId: string): void;
  markInterruptedRunsCancelled(): void;
}

interface ExecutionRunRow {
  id: string;
  session_id: string;
  workflow_id: string;
  environment_id: string;
  environment_snapshot: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  results: string;
  cancel_requested: number;
  cancel_reason: string | null;
  /**
   * FR-017a (2026-09-20 amendment): populated only for a `"local"`-tier run, so a non-local
   * run's row has both columns `NULL` regardless of what `RequestResult.rawCapture` the caller
   * ever passes in — see `decryptRawCaptures`/`appendResult` below. Encrypted with the same
   * `CredentialCipher` `Environment.variableValues` already uses; never stored inside `results`
   * itself, which stays exactly the shape it had before this amendment.
   */
  raw_captures_encrypted: Buffer | null;
  raw_captures_iv: Buffer | null;
}

function emptySummary(): ExecutionRun["summary"] {
  return { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 };
}

/** Identical to the pre-persistence `executionRunStore.ts`'s `recomputeSummary`. */
function recomputeSummary(startedAt: string, results: RequestResult[]): ExecutionRun["summary"] {
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

export class SqliteExecutionRunRepository implements ExecutionRunRepository {
  constructor(private readonly connection: SqliteConnection) {}

  /** Decrypts `row`'s raw-capture column, `[]` when absent (predates FR-017a, or non-"local"). */
  private decryptRawCaptures(row: ExecutionRunRow): Array<RawRequestCapture | null> {
    if (!row.raw_captures_encrypted || !row.raw_captures_iv) return [];
    const json = this.connection.cipher.decrypt(row.raw_captures_encrypted, row.raw_captures_iv);
    return JSON.parse(json) as Array<RawRequestCapture | null>;
  }

  private toRun(row: ExecutionRunRow): ExecutionRun {
    const results = JSON.parse(row.results) as RequestResult[];
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
      workflowId: row.workflow_id,
      environmentId: row.environment_id,
      environmentSnapshot: JSON.parse(row.environment_snapshot) as Pick<Environment, "name" | "tier" | "baseUrl">,
      status: row.status as ExecutionRunStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      summary: recomputeSummary(row.started_at, mergedResults),
      results: mergedResults,
      cancelRequested: row.cancel_requested === 1,
      cancelReason: (row.cancel_reason as "user-requested" | "backend-restart" | null) ?? undefined,
    };
  }

  listBySession(sessionId: string): ExecutionRun[] {
    // `started_at` alone is not a safe sort key: two runs created within the same millisecond
    // tie under `ORDER BY started_at DESC`, and SQLite does not then fall back to insertion
    // order (unlike the previous in-memory `[run, ...state.runs]` prepend, which always did).
    // `rowid` strictly increases with insertion order, so it is the reliable tiebreaker
    // (FR-019/FR-020: newest first, deterministically).
    const rows = this.connection.db
      .prepare("SELECT * FROM execution_runs WHERE session_id = ? ORDER BY started_at DESC, rowid DESC")
      .all(sessionId) as ExecutionRunRow[];
    return rows.map((row) => this.toRun(row));
  }

  private getRow(sessionId: string, runId: string): ExecutionRunRow | undefined {
    return this.connection.db
      .prepare("SELECT * FROM execution_runs WHERE session_id = ? AND id = ?")
      .get(sessionId, runId) as ExecutionRunRow | undefined;
  }

  get(sessionId: string, runId: string): ExecutionRun | undefined {
    const row = this.getRow(sessionId, runId);
    return row ? this.toRun(row) : undefined;
  }

  getInProgress(sessionId: string): ExecutionRun | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM execution_runs WHERE session_id = ? AND status = 'in-progress'")
      .get(sessionId) as ExecutionRunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  create(sessionId: string, run: ExecutionRun): void {
    // FR-017a: a "local"-tier run starts its raw-capture column as an encrypted `[]` so
    // `appendResult` below only ever has to append to it; every other tier starts (and stays)
    // `NULL` — it never becomes a byte this run's row can carry.
    const capturesEnabled = run.environmentSnapshot.tier === "local";
    const initialCaptures = capturesEnabled ? this.connection.cipher.encrypt(JSON.stringify([])) : undefined;
    this.connection.db
      .prepare(
        `INSERT INTO execution_runs
           (id, session_id, workflow_id, environment_id, environment_snapshot, status, started_at,
            completed_at, results, cancel_requested, cancel_reason, raw_captures_encrypted, raw_captures_iv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        sessionId,
        run.workflowId,
        run.environmentId,
        JSON.stringify(run.environmentSnapshot),
        run.status,
        run.startedAt,
        run.completedAt ?? null,
        // `run.results` is always `[]` at creation time (`createRun()`), so there is nothing to
        // strip a `rawCapture` out of yet.
        JSON.stringify(run.results),
        run.cancelRequested ? 1 : 0,
        run.cancelReason ?? null,
        initialCaptures?.ciphertext ?? null,
        initialCaptures?.iv ?? null,
      );
  }

  appendResult(sessionId: string, runId: string, result: RequestResult): ExecutionRun {
    const row = this.getRow(sessionId, runId);
    if (!row) throw new RunNotFoundError(runId);
    const { rawCapture, ...safeResult } = result;
    const results = [...(JSON.parse(row.results) as RequestResult[]), safeResult];

    const capturesEnabled =
      (JSON.parse(row.environment_snapshot) as Pick<Environment, "tier">).tier === "local";
    if (!capturesEnabled) {
      this.connection.db
        .prepare("UPDATE execution_runs SET results = ? WHERE session_id = ? AND id = ?")
        .run(JSON.stringify(results), sessionId, runId);
      return this.get(sessionId, runId)!;
    }

    const rawCaptures = [...this.decryptRawCaptures(row), rawCapture ?? null];
    const encrypted = this.connection.cipher.encrypt(JSON.stringify(rawCaptures));
    this.connection.db
      .prepare(
        "UPDATE execution_runs SET results = ?, raw_captures_encrypted = ?, raw_captures_iv = ? WHERE session_id = ? AND id = ?",
      )
      .run(JSON.stringify(results), encrypted.ciphertext, encrypted.iv, sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  settle(
    sessionId: string,
    runId: string,
    status: Extract<ExecutionRunStatus, "completed" | "cancelled">,
    cancelReason?: "user-requested" | "backend-restart",
  ): ExecutionRun {
    if (!this.get(sessionId, runId)) throw new RunNotFoundError(runId);
    this.connection.db
      .prepare(
        "UPDATE execution_runs SET status = ?, completed_at = ?, cancel_reason = ? WHERE session_id = ? AND id = ?",
      )
      .run(status, new Date().toISOString(), cancelReason ?? null, sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  requestCancel(sessionId: string, runId: string): ExecutionRun {
    if (!this.get(sessionId, runId)) throw new RunNotFoundError(runId);
    this.connection.db
      .prepare("UPDATE execution_runs SET cancel_requested = 1 WHERE session_id = ? AND id = ?")
      .run(sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM execution_runs WHERE session_id = ?").run(sessionId);
  }

  /** Called once at startup (FR-008, data-model.md) — settles every run a prior process left "in-progress". */
  markInterruptedRunsCancelled(): void {
    this.connection.db
      .prepare(
        `UPDATE execution_runs
         SET status = 'cancelled', cancel_reason = 'backend-restart', completed_at = ?
         WHERE status = 'in-progress'`,
      )
      .run(new Date().toISOString());
  }
}

let singleton: ExecutionRunRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getExecutionRunRepository(): ExecutionRunRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteExecutionRunRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
