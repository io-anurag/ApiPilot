import type {
  PerformancePlan,
  PerformanceResult,
  PerformanceRun,
  PerformanceRunCancelReason,
  PerformanceRunEnvironment,
  PerformanceRunFailureCategory,
  PerformanceRunStatus,
  PerformanceRunSummary,
  RunProgress,
} from "@apipilot/shared-domain";
import { PerformanceRunNotFoundError } from "../performance/errors";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-029 performance runs (specs/031-k6-performance-testing research D20),
 * mirroring `executionRunRepository.ts`: session-scoped, every method takes the session id
 * explicitly. The background runner calls it directly with a session id captured before the
 * HTTP response, because child-process callbacks are not guaranteed to keep the request's
 * AsyncLocalStorage context (tasks T067).
 */
export type PerformanceRunSettlement =
  | { status: "completed" }
  | { status: "cancelled"; cancelReason: PerformanceRunCancelReason }
  | { status: "failed"; failure: { category: PerformanceRunFailureCategory } };

export interface PerformanceRunRepository {
  listBySession(sessionId: string): PerformanceRunSummary[];
  get(sessionId: string, runId: string): PerformanceRun | undefined;
  getInProgress(sessionId: string): PerformanceRun | undefined;
  create(sessionId: string, run: PerformanceRun): void;
  checkpoint(sessionId: string, runId: string, update: { progress?: RunProgress; result?: PerformanceResult }): void;
  settle(
    sessionId: string,
    runId: string,
    settlement: PerformanceRunSettlement,
    endedAt: string,
    result?: PerformanceResult,
  ): PerformanceRun;
  requestCancel(sessionId: string, runId: string): PerformanceRun;
  isCancelRequested(sessionId: string, runId: string): boolean;
  deleteBySession(sessionId: string): void;
  /** Returns how many runs were marked. */
  markInterruptedRunsCancelled(): number;
}

interface PerformanceRunRow {
  id: string;
  session_id: string;
  status: string;
  cancel_reason: string | null;
  failure_category: string | null;
  cancel_requested: number;
  environment_snapshot: string;
  plan_snapshot: string;
  script_sha256: string;
  k6_version: string;
  planned_duration_ms: number;
  started_at: string;
  ended_at: string | null;
  progress: string | null;
  result: string | null;
}

const SUMMARY_COLUMNS =
  "id, session_id, status, cancel_reason, failure_category, cancel_requested, environment_snapshot, script_sha256, k6_version, planned_duration_ms, started_at, ended_at";

function toSummary(row: Omit<PerformanceRunRow, "plan_snapshot" | "progress" | "result">): PerformanceRunSummary {
  const summary: PerformanceRunSummary = {
    id: row.id,
    status: row.status as PerformanceRunStatus,
    environment: JSON.parse(row.environment_snapshot) as PerformanceRunEnvironment,
    scriptSha256: row.script_sha256,
    k6Version: row.k6_version,
    plannedDurationMs: row.planned_duration_ms,
    startedAt: row.started_at,
    cancelRequested: row.cancel_requested === 1,
  };
  if (row.cancel_reason) summary.cancelReason = row.cancel_reason as PerformanceRunCancelReason;
  if (row.failure_category) summary.failure = { category: row.failure_category as PerformanceRunFailureCategory };
  if (row.ended_at) summary.endedAt = row.ended_at;
  return summary;
}

function toRun(row: PerformanceRunRow): PerformanceRun {
  const run: PerformanceRun = { ...toSummary(row), planSnapshot: JSON.parse(row.plan_snapshot) as PerformancePlan };
  if (row.progress) run.progress = JSON.parse(row.progress) as RunProgress;
  if (row.result) run.result = JSON.parse(row.result) as PerformanceResult;
  return run;
}

export class SqlitePerformanceRunRepository implements PerformanceRunRepository {
  constructor(private readonly connection: SqliteConnection) {}

  listBySession(sessionId: string): PerformanceRunSummary[] {
    // `rowid` breaks ties between runs started in the same millisecond (as executionRunRepository).
    const rows = this.connection.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM performance_runs WHERE session_id = ? ORDER BY started_at DESC, rowid DESC`)
      .all(sessionId) as PerformanceRunRow[];
    return rows.map((row) => toSummary(row));
  }

  private getRow(sessionId: string, runId: string): PerformanceRunRow | undefined {
    return this.connection.db
      .prepare("SELECT * FROM performance_runs WHERE session_id = ? AND id = ?")
      .get(sessionId, runId) as PerformanceRunRow | undefined;
  }

  private require(sessionId: string, runId: string): PerformanceRunRow {
    const row = this.getRow(sessionId, runId);
    if (!row) throw new PerformanceRunNotFoundError(runId);
    return row;
  }

  get(sessionId: string, runId: string): PerformanceRun | undefined {
    const row = this.getRow(sessionId, runId);
    return row ? toRun(row) : undefined;
  }

  getInProgress(sessionId: string): PerformanceRun | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM performance_runs WHERE session_id = ? AND status = 'in-progress'")
      .get(sessionId) as PerformanceRunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  create(sessionId: string, run: PerformanceRun): void {
    this.connection.db
      .prepare(
        `INSERT INTO performance_runs
           (id, session_id, status, cancel_reason, failure_category, cancel_requested, environment_snapshot,
            plan_snapshot, script_sha256, k6_version, planned_duration_ms, started_at, ended_at, progress, result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        sessionId,
        run.status,
        run.cancelReason ?? null,
        run.failure?.category ?? null,
        run.cancelRequested ? 1 : 0,
        JSON.stringify(run.environment),
        JSON.stringify(run.planSnapshot),
        run.scriptSha256,
        run.k6Version,
        run.plannedDurationMs,
        run.startedAt,
        run.endedAt ?? null,
        run.progress ? JSON.stringify(run.progress) : null,
        run.result ? JSON.stringify(run.result) : null,
      );
  }

  checkpoint(sessionId: string, runId: string, update: { progress?: RunProgress; result?: PerformanceResult }): void {
    const row = this.require(sessionId, runId);
    this.connection.db
      .prepare("UPDATE performance_runs SET progress = ?, result = ? WHERE session_id = ? AND id = ?")
      .run(
        update.progress ? JSON.stringify(update.progress) : row.progress,
        update.result ? JSON.stringify(update.result) : row.result,
        sessionId,
        runId,
      );
  }

  settle(
    sessionId: string,
    runId: string,
    settlement: PerformanceRunSettlement,
    endedAt: string,
    result?: PerformanceResult,
  ): PerformanceRun {
    const row = this.require(sessionId, runId);
    this.connection.db
      .prepare(
        `UPDATE performance_runs
         SET status = ?, cancel_reason = ?, failure_category = ?, ended_at = ?, result = ?
         WHERE session_id = ? AND id = ?`,
      )
      .run(
        settlement.status,
        settlement.status === "cancelled" ? settlement.cancelReason : null,
        settlement.status === "failed" ? settlement.failure.category : null,
        endedAt,
        result ? JSON.stringify(result) : row.result,
        sessionId,
        runId,
      );
    return this.get(sessionId, runId)!;
  }

  requestCancel(sessionId: string, runId: string): PerformanceRun {
    this.require(sessionId, runId);
    this.connection.db
      .prepare("UPDATE performance_runs SET cancel_requested = 1 WHERE session_id = ? AND id = ?")
      .run(sessionId, runId);
    return this.get(sessionId, runId)!;
  }

  isCancelRequested(sessionId: string, runId: string): boolean {
    return this.require(sessionId, runId).cancel_requested === 1;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM performance_runs WHERE session_id = ?").run(sessionId);
  }

  /** Called once at startup (FR-032): a run a prior process left in progress is never restarted. */
  markInterruptedRunsCancelled(): number {
    return this.connection.db
      .prepare(
        `UPDATE performance_runs
         SET status = 'cancelled', cancel_reason = 'backend-restart', ended_at = ?
         WHERE status = 'in-progress'`,
      )
      .run(new Date().toISOString()).changes;
  }
}

let singleton: PerformanceRunRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getPerformanceRunRepository(): PerformanceRunRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqlitePerformanceRunRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
