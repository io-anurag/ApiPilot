import type {
  CleanupResult,
  PlannedItem,
  ProfileSummary,
  RunConfirmation,
  RunLimits,
  ScenarioOutcomeKind,
  ScenarioResult,
  SecurityRun,
  SecurityRunStatus,
} from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, **owner-scoped** backing for Security Lab runs, their per-scenario results and the owner's
 * settings (specs/057 research R13, FR-051). Retained work: it survives session expiry and restart and is
 * removed only by an explicit delete. A run row also carries the starting `session_id`, but only so the
 * execution slot can find a run in progress for the calling session; it never decides who may read it.
 *
 * Nothing here holds a credential, a profile, a test data value or an evidence body. A result keeps a
 * bounded deterministic summary of what was observed, never an excerpt of the response.
 */

export interface RunPatch {
  status?: SecurityRunStatus;
  cancelRequested?: boolean;
  cancelReason?: "user-requested" | "backend-restart";
  completedAt?: string;
  budget?: { planned: number; used: number };
  summary?: Record<ScenarioOutcomeKind, number>;
  cleanup?: CleanupResult[];
}

export interface SecurityRunRepository {
  createRun(run: SecurityRun): void;
  getRun(ownerId: string, id: string): SecurityRun | undefined;
  /** Newest first. */
  listRuns(ownerId: string, assessmentKey?: string): SecurityRun[];
  countRuns(ownerId: string): number;
  updateRun(ownerId: string, id: string, patch: RunPatch): void;
  /** The run the calling session started that is still in progress, for the one-execution-at-a-time slot. */
  getInProgress(sessionId: string): SecurityRun | undefined;
  /** Settles every run left in progress, whoever owns it, after a backend restart. Returns how many. */
  markInterruptedRunsCancelled(completedAt: string): number;
  appendResult(ownerId: string, result: ScenarioResult): void;
  getResult(ownerId: string, id: string): ScenarioResult | undefined;
  listResults(ownerId: string, runId: string): ScenarioResult[];
  /** Oldest first, across runs. */
  listResultsForScenario(ownerId: string, scenarioId: string, version?: number): ScenarioResult[];
  getSensitiveFields(ownerId: string): string[];
  setSensitiveFields(ownerId: string, names: string[], updatedAt: string): void;
  deleteAssessment(ownerId: string, assessmentKey: string): { runs: number };
  deleteOwner(ownerId: string): { runs: number };
}

interface RunRow {
  id: string;
  owner_id: string;
  session_id: string;
  assessment_key: string;
  status: string;
  cancel_requested: number;
  cancel_reason: string | null;
  profile_summary: string;
  plan: string;
  plan_digest: string;
  limits: string;
  budget: string;
  confirmation: string;
  summary: string;
  cleanup: string;
  started_at: string;
  completed_at: string | null;
}

interface ResultRow {
  id: string;
  owner_id: string;
  run_id: string;
  scenario_id: string;
  version: number;
  outcome: string;
  reason: string;
  condition_results: string;
  observed: string;
  evidence_count: number;
  started_at: string;
  duration_ms: number;
}

function toRun(row: RunRow): SecurityRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    status: row.status as SecurityRunStatus,
    cancelRequested: row.cancel_requested === 1,
    ...(row.cancel_reason !== null ? { cancelReason: row.cancel_reason as "user-requested" | "backend-restart" } : {}),
    startedAt: row.started_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    profileSummary: JSON.parse(row.profile_summary) as ProfileSummary,
    plan: JSON.parse(row.plan) as PlannedItem[],
    planDigest: row.plan_digest,
    limits: JSON.parse(row.limits) as RunLimits,
    budget: JSON.parse(row.budget) as { planned: number; used: number },
    confirmation: JSON.parse(row.confirmation) as RunConfirmation,
    summary: JSON.parse(row.summary) as Record<ScenarioOutcomeKind, number>,
    cleanup: JSON.parse(row.cleanup) as CleanupResult[],
    assessmentKey: row.assessment_key,
  };
}

function toResult(row: ResultRow): ScenarioResult {
  return {
    id: row.id,
    runId: row.run_id,
    scenarioId: row.scenario_id,
    version: row.version,
    outcome: row.outcome as ScenarioOutcomeKind,
    reason: row.reason,
    conditionResults: JSON.parse(row.condition_results) as ScenarioResult["conditionResults"],
    observed: JSON.parse(row.observed) as ScenarioResult["observed"],
    evidenceCount: row.evidence_count,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
  };
}

export class SqliteSecurityRunRepository implements SecurityRunRepository {
  constructor(private readonly connection: SqliteConnection) {}

  createRun(run: SecurityRun): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_runs
           (id, owner_id, session_id, assessment_key, status, cancel_requested, cancel_reason, profile_summary, plan,
            plan_digest, limits, budget, confirmation, summary, cleanup, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.ownerId,
        run.sessionId,
        run.assessmentKey,
        run.status,
        run.cancelRequested ? 1 : 0,
        run.cancelReason ?? null,
        JSON.stringify(run.profileSummary),
        JSON.stringify(run.plan),
        run.planDigest,
        JSON.stringify(run.limits),
        JSON.stringify(run.budget),
        JSON.stringify(run.confirmation),
        JSON.stringify(run.summary),
        JSON.stringify(run.cleanup),
        run.startedAt,
        run.completedAt ?? null,
      );
  }

  getRun(ownerId: string, id: string): SecurityRun | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM security_runs WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(ownerId: string, assessmentKey?: string): SecurityRun[] {
    const rows = (
      assessmentKey === undefined
        ? this.connection.db
            .prepare("SELECT * FROM security_runs WHERE owner_id = ? ORDER BY started_at DESC, id DESC")
            .all(ownerId)
        : this.connection.db
            .prepare("SELECT * FROM security_runs WHERE owner_id = ? AND assessment_key = ? ORDER BY started_at DESC, id DESC")
            .all(ownerId, assessmentKey)
    ) as RunRow[];
    return rows.map(toRun);
  }

  countRuns(ownerId: string): number {
    return (
      this.connection.db.prepare("SELECT COUNT(*) AS n FROM security_runs WHERE owner_id = ?").get(ownerId) as { n: number }
    ).n;
  }

  updateRun(ownerId: string, id: string, patch: RunPatch): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.status !== undefined) assign("status", patch.status);
    if (patch.cancelRequested !== undefined) assign("cancel_requested", patch.cancelRequested ? 1 : 0);
    if (patch.cancelReason !== undefined) assign("cancel_reason", patch.cancelReason);
    if (patch.completedAt !== undefined) assign("completed_at", patch.completedAt);
    if (patch.budget !== undefined) assign("budget", JSON.stringify(patch.budget));
    if (patch.summary !== undefined) assign("summary", JSON.stringify(patch.summary));
    if (patch.cleanup !== undefined) assign("cleanup", JSON.stringify(patch.cleanup));
    if (sets.length === 0) return;
    this.connection.db
      .prepare(`UPDATE security_runs SET ${sets.join(", ")} WHERE owner_id = ? AND id = ?`)
      .run(...params, ownerId, id);
  }

  getInProgress(sessionId: string): SecurityRun | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM security_runs WHERE session_id = ? AND status = 'in-progress' ORDER BY started_at DESC LIMIT 1")
      .get(sessionId) as RunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  markInterruptedRunsCancelled(completedAt: string): number {
    return this.connection.db
      .prepare(
        `UPDATE security_runs SET status = 'cancelled', cancel_reason = 'backend-restart', completed_at = ?
         WHERE status = 'in-progress'`,
      )
      .run(completedAt).changes;
  }

  appendResult(ownerId: string, result: ScenarioResult): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_run_results
           (id, owner_id, run_id, scenario_id, version, outcome, reason, condition_results, observed, evidence_count,
            started_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.id,
        ownerId,
        result.runId,
        result.scenarioId,
        result.version,
        result.outcome,
        result.reason,
        JSON.stringify(result.conditionResults),
        JSON.stringify(result.observed),
        result.evidenceCount,
        result.startedAt,
        result.durationMs,
      );
  }

  getResult(ownerId: string, id: string): ScenarioResult | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM security_run_results WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as ResultRow | undefined;
    return row ? toResult(row) : undefined;
  }

  listResults(ownerId: string, runId: string): ScenarioResult[] {
    const rows = this.connection.db
      .prepare("SELECT * FROM security_run_results WHERE owner_id = ? AND run_id = ? ORDER BY started_at ASC, id ASC")
      .all(ownerId, runId) as ResultRow[];
    return rows.map(toResult);
  }

  listResultsForScenario(ownerId: string, scenarioId: string, version?: number): ScenarioResult[] {
    const rows = (
      version === undefined
        ? this.connection.db
            .prepare("SELECT * FROM security_run_results WHERE owner_id = ? AND scenario_id = ? ORDER BY started_at ASC, id ASC")
            .all(ownerId, scenarioId)
        : this.connection.db
            .prepare(
              `SELECT * FROM security_run_results WHERE owner_id = ? AND scenario_id = ? AND version = ?
               ORDER BY started_at ASC, id ASC`,
            )
            .all(ownerId, scenarioId, version)
    ) as ResultRow[];
    return rows.map(toResult);
  }

  getSensitiveFields(ownerId: string): string[] {
    const row = this.connection.db
      .prepare("SELECT sensitive_fields FROM security_settings WHERE owner_id = ?")
      .get(ownerId) as { sensitive_fields: string } | undefined;
    return row ? (JSON.parse(row.sensitive_fields) as string[]) : [];
  }

  setSensitiveFields(ownerId: string, names: string[], updatedAt: string): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_settings (owner_id, sensitive_fields, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET sensitive_fields = excluded.sensitive_fields, updated_at = excluded.updated_at`,
      )
      .run(ownerId, JSON.stringify(names), updatedAt);
  }

  deleteAssessment(ownerId: string, assessmentKey: string): { runs: number } {
    const remove = this.connection.db.transaction(() => {
      this.connection.db
        .prepare(
          `DELETE FROM security_run_results WHERE owner_id = ? AND run_id IN
             (SELECT id FROM security_runs WHERE owner_id = ? AND assessment_key = ?)`,
        )
        .run(ownerId, ownerId, assessmentKey);
      const runs = this.connection.db
        .prepare("DELETE FROM security_runs WHERE owner_id = ? AND assessment_key = ?")
        .run(ownerId, assessmentKey).changes;
      return { runs };
    });
    return remove();
  }

  deleteOwner(ownerId: string): { runs: number } {
    const remove = this.connection.db.transaction(() => {
      this.connection.db.prepare("DELETE FROM security_run_results WHERE owner_id = ?").run(ownerId);
      const runs = this.connection.db.prepare("DELETE FROM security_runs WHERE owner_id = ?").run(ownerId).changes;
      this.connection.db.prepare("DELETE FROM security_settings WHERE owner_id = ?").run(ownerId);
      return { runs };
    });
    return remove();
  }
}

let singleton: SecurityRunRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test) instance, rebuilt whenever the shared connection changes. */
export function getSecurityRunRepository(): SecurityRunRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityRunRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
