import type { FindingStatus, SecurityFinding, Severity } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";
import type { Page } from "./securityScenarioRepository";

/**
 * Durable, **owner-scoped** backing for Security Lab findings (specs/057 research R13 and R24, FR-051).
 * One finding per scenario version, enforced by a unique index on `(owner_id, scenario_id, scenario_version)`:
 * a repeat failure extends the existing finding with an occurrence instead of adding a row. Findings are
 * retained work and survive session expiry; the redacted evidence behind each occurrence is session data and
 * lives elsewhere. The full document is stored as JSON with the filterable columns repeated beside it.
 */

export interface FindingQuery {
  assessmentKey?: string;
  severity?: Severity;
  status?: FindingStatus;
  categoryId?: string;
  operationKey?: string;
  scenarioId?: string;
  unreviewed?: boolean;
}

export interface SecurityFindingRepository {
  /** Inserts the finding, or replaces the stored document and columns when it already exists. */
  save(finding: SecurityFinding): void;
  get(ownerId: string, id: string): SecurityFinding | undefined;
  findByVersion(ownerId: string, scenarioId: string, scenarioVersion: number): SecurityFinding | undefined;
  /** Most recently failed first, then by id. */
  query(ownerId: string, filter: FindingQuery, page?: Page): { items: SecurityFinding[]; total: number };
  listAll(ownerId: string, filter?: FindingQuery): SecurityFinding[];
  countByOwner(ownerId: string): number;
  deleteAssessment(ownerId: string, assessmentKey: string): number;
  deleteOwner(ownerId: string): number;
  /** Per assessment finding counts for retained-data summaries. */
  countsByAssessment(ownerId: string): Array<{ assessmentKey: string; findings: number }>;
}

interface FindingRow {
  document: string;
}

function where(ownerId: string, filter: FindingQuery): { sql: string; params: unknown[] } {
  const clauses = ["owner_id = ?"];
  const params: unknown[] = [ownerId];
  const add = (clause: string, value: unknown): void => {
    clauses.push(clause);
    params.push(value);
  };
  if (filter.assessmentKey !== undefined) add("assessment_key = ?", filter.assessmentKey);
  if (filter.severity !== undefined) add("severity = ?", filter.severity);
  if (filter.status !== undefined) add("status = ?", filter.status);
  if (filter.categoryId !== undefined) add("category_id = ?", filter.categoryId);
  if (filter.operationKey !== undefined) add("operation_key = ?", filter.operationKey);
  if (filter.scenarioId !== undefined) add("scenario_id = ?", filter.scenarioId);
  if (filter.unreviewed !== undefined) add("unreviewed_occurrence = ?", filter.unreviewed ? 1 : 0);
  return { sql: clauses.join(" AND "), params };
}

const ORDER = "ORDER BY latest_failed_at DESC, id ASC";

export class SqliteSecurityFindingRepository implements SecurityFindingRepository {
  constructor(private readonly connection: SqliteConnection) {}

  save(finding: SecurityFinding): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_findings
           (owner_id, id, assessment_key, scenario_id, scenario_version, operation_key, category_id, severity, status,
            unreviewed_occurrence, occurrence_count, first_failed_at, latest_failed_at, document)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, id) DO UPDATE SET
           severity = excluded.severity,
           status = excluded.status,
           unreviewed_occurrence = excluded.unreviewed_occurrence,
           occurrence_count = excluded.occurrence_count,
           latest_failed_at = excluded.latest_failed_at,
           document = excluded.document`,
      )
      .run(
        finding.ownerId,
        finding.id,
        finding.assessmentKey,
        finding.scenarioId,
        finding.scenarioVersion,
        finding.operationKey,
        finding.categoryId,
        finding.severity.current,
        finding.status,
        finding.unreviewedOccurrence ? 1 : 0,
        finding.occurrenceCount,
        finding.firstFailedAt,
        finding.latestFailedAt,
        JSON.stringify(finding),
      );
  }

  get(ownerId: string, id: string): SecurityFinding | undefined {
    const row = this.connection.db
      .prepare("SELECT document FROM security_findings WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as FindingRow | undefined;
    return row ? (JSON.parse(row.document) as SecurityFinding) : undefined;
  }

  findByVersion(ownerId: string, scenarioId: string, scenarioVersion: number): SecurityFinding | undefined {
    const row = this.connection.db
      .prepare("SELECT document FROM security_findings WHERE owner_id = ? AND scenario_id = ? AND scenario_version = ?")
      .get(ownerId, scenarioId, scenarioVersion) as FindingRow | undefined;
    return row ? (JSON.parse(row.document) as SecurityFinding) : undefined;
  }

  query(ownerId: string, filter: FindingQuery, page?: Page): { items: SecurityFinding[]; total: number } {
    const { sql, params } = where(ownerId, filter);
    const total = (
      this.connection.db.prepare(`SELECT COUNT(*) AS n FROM security_findings WHERE ${sql}`).get(...params) as { n: number }
    ).n;
    const paging = page ? " LIMIT ? OFFSET ?" : "";
    const pagingParams = page ? [page.pageSize, Math.max(0, (page.page - 1) * page.pageSize)] : [];
    const rows = this.connection.db
      .prepare(`SELECT document FROM security_findings WHERE ${sql} ${ORDER}${paging}`)
      .all(...params, ...pagingParams) as FindingRow[];
    return { items: rows.map((row) => JSON.parse(row.document) as SecurityFinding), total };
  }

  listAll(ownerId: string, filter: FindingQuery = {}): SecurityFinding[] {
    return this.query(ownerId, filter).items;
  }

  countByOwner(ownerId: string): number {
    return (
      this.connection.db.prepare("SELECT COUNT(*) AS n FROM security_findings WHERE owner_id = ?").get(ownerId) as {
        n: number;
      }
    ).n;
  }

  deleteAssessment(ownerId: string, assessmentKey: string): number {
    return this.connection.db
      .prepare("DELETE FROM security_findings WHERE owner_id = ? AND assessment_key = ?")
      .run(ownerId, assessmentKey).changes;
  }

  deleteOwner(ownerId: string): number {
    return this.connection.db.prepare("DELETE FROM security_findings WHERE owner_id = ?").run(ownerId).changes;
  }

  countsByAssessment(ownerId: string): Array<{ assessmentKey: string; findings: number }> {
    const rows = this.connection.db
      .prepare("SELECT assessment_key, COUNT(*) AS n FROM security_findings WHERE owner_id = ? GROUP BY assessment_key")
      .all(ownerId) as Array<{ assessment_key: string; n: number }>;
    return rows.map((row) => ({ assessmentKey: row.assessment_key, findings: row.n }));
  }
}

let singleton: SecurityFindingRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test) instance, rebuilt whenever the shared connection changes. */
export function getSecurityFindingRepository(): SecurityFindingRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityFindingRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
