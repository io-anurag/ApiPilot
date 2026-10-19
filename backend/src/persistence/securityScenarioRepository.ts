import type {
  ApprovalRecord,
  ExecutionStatus,
  ScenarioOrigin,
  SecurityReviewState,
  SecurityScenario,
  SecurityScenarioVersion,
  Severity,
} from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, **owner-scoped** backing for Security Lab scenarios and their immutable versions
 * (specs/057 research R13, FR-051). Retained work: keyed by `ownerId`, never removed by session expiry,
 * removed only by an explicit delete. Scenario ids are derived from content, so they repeat across owners
 * and every key and every query carries the owner. Version rows are insert-only except for the approval
 * and rejection columns, which record decisions about a version without changing what it says (FR-030).
 */

/** The list-friendly columns kept on the scenario row so filtering never has to parse version content. */
export interface ScenarioHead {
  operationKey: string;
  categoryId: string;
  severity: Severity;
  destructive: boolean;
  title: string;
}

export interface StoredScenario extends SecurityScenario, ScenarioHead {
  updatedAt: string;
}

export interface ScenarioQuery {
  assessmentKey?: string;
  /** Matches the title or the operation key, case-insensitively. */
  q?: string;
  operationKey?: string;
  categoryId?: string;
  severity?: Severity;
  reviewState?: SecurityReviewState;
  executionStatus?: ExecutionStatus;
  origin?: ScenarioOrigin;
  destructive?: boolean;
  ids?: string[];
}

export interface Page {
  page: number;
  pageSize: number;
}

export interface AssessmentCount {
  assessmentKey: string;
  assessmentLabel: string;
  scenarios: number;
}

export interface SecurityScenarioRepository {
  insertScenario(scenario: SecurityScenario, head: ScenarioHead, updatedAt: string): void;
  updateHead(
    ownerId: string,
    id: string,
    patch: Partial<ScenarioHead> & {
      currentVersion?: number;
      reviewState?: SecurityReviewState;
      executionStatus?: ExecutionStatus;
      updatedAt: string;
    },
  ): void;
  getScenario(ownerId: string, id: string): StoredScenario | undefined;
  insertVersion(ownerId: string, version: SecurityScenarioVersion): void;
  getVersion(ownerId: string, scenarioId: string, version: number): SecurityScenarioVersion | undefined;
  listVersions(ownerId: string, scenarioId: string): SecurityScenarioVersion[];
  setApproval(ownerId: string, scenarioId: string, version: number, approval: ApprovalRecord | undefined): void;
  setRejection(
    ownerId: string,
    scenarioId: string,
    version: number,
    rejection: { reason: string; at: string } | undefined,
  ): void;
  query(ownerId: string, filter: ScenarioQuery, page?: Page): { items: StoredScenario[]; total: number };
  /** Every matching scenario head, in stable order, up to `cap`. */
  listHeads(ownerId: string, filter: ScenarioQuery, cap?: number): StoredScenario[];
  countByOwner(ownerId: string): number;
  listAssessments(ownerId: string): AssessmentCount[];
  deleteAssessment(ownerId: string, assessmentKey: string): number;
  deleteOwner(ownerId: string): number;
}

interface ScenarioRow {
  owner_id: string;
  id: string;
  assessment_key: string;
  assessment_label: string;
  current_version: number;
  review_state: string;
  execution_status: string;
  origin: string;
  operation_key: string;
  category_id: string;
  severity: string;
  destructive: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  owner_id: string;
  scenario_id: string;
  version: number;
  content_hash: string;
  specification_revision: string;
  security_basis_hash: string;
  content: string;
  author: string;
  edit_note: string | null;
  material_change: number;
  approval: string | null;
  rejection: string | null;
  created_at: string;
}

function toStored(row: ScenarioRow): StoredScenario {
  return {
    id: row.id,
    ownerId: row.owner_id,
    assessmentKey: row.assessment_key,
    assessmentLabel: row.assessment_label,
    currentVersion: row.current_version,
    reviewState: row.review_state as SecurityReviewState,
    executionStatus: row.execution_status as ExecutionStatus,
    origin: row.origin as ScenarioOrigin,
    createdAt: row.created_at,
    operationKey: row.operation_key,
    categoryId: row.category_id,
    severity: row.severity as Severity,
    destructive: row.destructive === 1,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function toVersion(row: VersionRow): SecurityScenarioVersion {
  return {
    scenarioId: row.scenario_id,
    version: row.version,
    contentHash: row.content_hash,
    specificationRevision: row.specification_revision,
    securityBasisHash: row.security_basis_hash,
    content: JSON.parse(row.content) as SecurityScenarioVersion["content"],
    author: row.author as SecurityScenarioVersion["author"],
    createdAt: row.created_at,
    ...(row.edit_note !== null ? { editNote: row.edit_note } : {}),
    materialChange: row.material_change === 1,
    ...(row.approval !== null ? { approval: JSON.parse(row.approval) as ApprovalRecord } : {}),
    ...(row.rejection !== null ? { rejection: JSON.parse(row.rejection) as { reason: string; at: string } } : {}),
  };
}

/** Escapes `%`, `_` and the escape character so a search term is matched literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function where(ownerId: string, filter: ScenarioQuery): { sql: string; params: unknown[] } {
  const clauses = ["owner_id = ?"];
  const params: unknown[] = [ownerId];
  if (filter.assessmentKey !== undefined) {
    clauses.push("assessment_key = ?");
    params.push(filter.assessmentKey);
  }
  if (filter.q !== undefined && filter.q.trim() !== "") {
    clauses.push("(title LIKE ? ESCAPE '\\' OR operation_key LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')");
    const pattern = likePattern(filter.q.trim());
    params.push(pattern, pattern, pattern);
  }
  if (filter.operationKey !== undefined) {
    clauses.push("operation_key = ?");
    params.push(filter.operationKey);
  }
  if (filter.categoryId !== undefined) {
    clauses.push("category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.severity !== undefined) {
    clauses.push("severity = ?");
    params.push(filter.severity);
  }
  if (filter.reviewState !== undefined) {
    clauses.push("review_state = ?");
    params.push(filter.reviewState);
  }
  if (filter.executionStatus !== undefined) {
    clauses.push("execution_status = ?");
    params.push(filter.executionStatus);
  }
  if (filter.origin !== undefined) {
    clauses.push("origin = ?");
    params.push(filter.origin);
  }
  if (filter.destructive !== undefined) {
    clauses.push("destructive = ?");
    params.push(filter.destructive ? 1 : 0);
  }
  if (filter.ids !== undefined) {
    if (filter.ids.length === 0) {
      clauses.push("1 = 0");
    } else {
      clauses.push(`id IN (${filter.ids.map(() => "?").join(", ")})`);
      params.push(...filter.ids);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

/** Deterministic order: operation, category, then id. */
const ORDER = "ORDER BY operation_key ASC, category_id ASC, id ASC";

export class SqliteSecurityScenarioRepository implements SecurityScenarioRepository {
  constructor(private readonly connection: SqliteConnection) {}

  insertScenario(scenario: SecurityScenario, head: ScenarioHead, updatedAt: string): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_scenarios
           (owner_id, id, assessment_key, assessment_label, current_version, review_state, execution_status, origin,
            operation_key, category_id, severity, destructive, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        scenario.ownerId,
        scenario.id,
        scenario.assessmentKey,
        scenario.assessmentLabel,
        scenario.currentVersion,
        scenario.reviewState,
        scenario.executionStatus,
        scenario.origin,
        head.operationKey,
        head.categoryId,
        head.severity,
        head.destructive ? 1 : 0,
        head.title,
        scenario.createdAt,
        updatedAt,
      );
  }

  updateHead(
    ownerId: string,
    id: string,
    patch: Partial<ScenarioHead> & {
      currentVersion?: number;
      reviewState?: SecurityReviewState;
      executionStatus?: ExecutionStatus;
      updatedAt: string;
    },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.currentVersion !== undefined) assign("current_version", patch.currentVersion);
    if (patch.reviewState !== undefined) assign("review_state", patch.reviewState);
    if (patch.executionStatus !== undefined) assign("execution_status", patch.executionStatus);
    if (patch.operationKey !== undefined) assign("operation_key", patch.operationKey);
    if (patch.categoryId !== undefined) assign("category_id", patch.categoryId);
    if (patch.severity !== undefined) assign("severity", patch.severity);
    if (patch.destructive !== undefined) assign("destructive", patch.destructive ? 1 : 0);
    if (patch.title !== undefined) assign("title", patch.title);
    assign("updated_at", patch.updatedAt);
    this.connection.db
      .prepare(`UPDATE security_scenarios SET ${sets.join(", ")} WHERE owner_id = ? AND id = ?`)
      .run(...params, ownerId, id);
  }

  getScenario(ownerId: string, id: string): StoredScenario | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM security_scenarios WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as ScenarioRow | undefined;
    return row ? toStored(row) : undefined;
  }

  insertVersion(ownerId: string, version: SecurityScenarioVersion): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_scenario_versions
           (owner_id, scenario_id, version, content_hash, specification_revision, security_basis_hash, content,
            author, edit_note, material_change, approval, rejection, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        version.scenarioId,
        version.version,
        version.contentHash,
        version.specificationRevision,
        version.securityBasisHash,
        JSON.stringify(version.content),
        version.author,
        version.editNote ?? null,
        version.materialChange ? 1 : 0,
        version.approval ? JSON.stringify(version.approval) : null,
        version.rejection ? JSON.stringify(version.rejection) : null,
        version.createdAt,
      );
  }

  getVersion(ownerId: string, scenarioId: string, version: number): SecurityScenarioVersion | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM security_scenario_versions WHERE owner_id = ? AND scenario_id = ? AND version = ?")
      .get(ownerId, scenarioId, version) as VersionRow | undefined;
    return row ? toVersion(row) : undefined;
  }

  listVersions(ownerId: string, scenarioId: string): SecurityScenarioVersion[] {
    const rows = this.connection.db
      .prepare("SELECT * FROM security_scenario_versions WHERE owner_id = ? AND scenario_id = ? ORDER BY version ASC")
      .all(ownerId, scenarioId) as VersionRow[];
    return rows.map(toVersion);
  }

  setApproval(ownerId: string, scenarioId: string, version: number, approval: ApprovalRecord | undefined): void {
    this.connection.db
      .prepare("UPDATE security_scenario_versions SET approval = ? WHERE owner_id = ? AND scenario_id = ? AND version = ?")
      .run(approval ? JSON.stringify(approval) : null, ownerId, scenarioId, version);
  }

  setRejection(
    ownerId: string,
    scenarioId: string,
    version: number,
    rejection: { reason: string; at: string } | undefined,
  ): void {
    this.connection.db
      .prepare("UPDATE security_scenario_versions SET rejection = ? WHERE owner_id = ? AND scenario_id = ? AND version = ?")
      .run(rejection ? JSON.stringify(rejection) : null, ownerId, scenarioId, version);
  }

  query(ownerId: string, filter: ScenarioQuery, page?: Page): { items: StoredScenario[]; total: number } {
    const { sql, params } = where(ownerId, filter);
    const total = (
      this.connection.db.prepare(`SELECT COUNT(*) AS n FROM security_scenarios WHERE ${sql}`).get(...params) as { n: number }
    ).n;
    const paging = page ? " LIMIT ? OFFSET ?" : "";
    const pagingParams = page ? [page.pageSize, Math.max(0, (page.page - 1) * page.pageSize)] : [];
    const rows = this.connection.db
      .prepare(`SELECT * FROM security_scenarios WHERE ${sql} ${ORDER}${paging}`)
      .all(...params, ...pagingParams) as ScenarioRow[];
    return { items: rows.map(toStored), total };
  }

  listHeads(ownerId: string, filter: ScenarioQuery, cap?: number): StoredScenario[] {
    const { sql, params } = where(ownerId, filter);
    const limit = cap !== undefined ? " LIMIT ?" : "";
    const rows = this.connection.db
      .prepare(`SELECT * FROM security_scenarios WHERE ${sql} ${ORDER}${limit}`)
      .all(...params, ...(cap !== undefined ? [cap] : [])) as ScenarioRow[];
    return rows.map(toStored);
  }

  countByOwner(ownerId: string): number {
    return (
      this.connection.db.prepare("SELECT COUNT(*) AS n FROM security_scenarios WHERE owner_id = ?").get(ownerId) as {
        n: number;
      }
    ).n;
  }

  listAssessments(ownerId: string): AssessmentCount[] {
    const rows = this.connection.db
      .prepare(
        `SELECT assessment_key, assessment_label, COUNT(*) AS n FROM security_scenarios
         WHERE owner_id = ? GROUP BY assessment_key, assessment_label ORDER BY assessment_label ASC, assessment_key ASC`,
      )
      .all(ownerId) as Array<{ assessment_key: string; assessment_label: string; n: number }>;
    return rows.map((row) => ({ assessmentKey: row.assessment_key, assessmentLabel: row.assessment_label, scenarios: row.n }));
  }

  deleteAssessment(ownerId: string, assessmentKey: string): number {
    const remove = this.connection.db.transaction(() => {
      this.connection.db
        .prepare(
          `DELETE FROM security_scenario_versions WHERE owner_id = ? AND scenario_id IN
             (SELECT id FROM security_scenarios WHERE owner_id = ? AND assessment_key = ?)`,
        )
        .run(ownerId, ownerId, assessmentKey);
      return this.connection.db
        .prepare("DELETE FROM security_scenarios WHERE owner_id = ? AND assessment_key = ?")
        .run(ownerId, assessmentKey).changes;
    });
    return remove();
  }

  deleteOwner(ownerId: string): number {
    const remove = this.connection.db.transaction(() => {
      this.connection.db.prepare("DELETE FROM security_scenario_versions WHERE owner_id = ?").run(ownerId);
      return this.connection.db.prepare("DELETE FROM security_scenarios WHERE owner_id = ?").run(ownerId).changes;
    });
    return remove();
  }
}

let singleton: SecurityScenarioRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test, via `tests/setup/testDb.ts`) instance, rebuilt whenever the shared connection changes. */
export function getSecurityScenarioRepository(): SecurityScenarioRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityScenarioRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
