import type { ChainPlan, ChainPlanSummary, SeedSource } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-037 request-chain plans (specs/037-request-chain-performance research R2).
 * Session-scoped: every method takes the session id explicitly. The plan document holds no secret
 * value (FR-027), but its steps are the engineer's own content, so it is encrypted with the
 * connection's credential cipher, as AP-034 does for user scripts. Only the name, counts, seed source
 * kind, revision, fingerprint and times are plain. Data set metadata lives in
 * `chain_plan_data_sets` and is never stored in the document.
 */
export type ChainPlanSaveResult = { ok: true } | { ok: false; current: ChainPlan | undefined };

export interface ChainPlanRepository {
  /** Newest `updated_at` first, ties broken by id. */
  list(sessionId: string): ChainPlanSummary[];
  count(sessionId: string): number;
  /** The document as stored, with `dataSets` empty; the store adds them. */
  get(sessionId: string, planId: string): ChainPlan | undefined;
  create(sessionId: string, plan: ChainPlan): void;
  /** Writes only when the stored revision is `expectedRevision`; never overwrites a newer save. */
  save(sessionId: string, plan: ChainPlan, expectedRevision: number): ChainPlanSaveResult;
  /** Removes the plan and its data sets. Runs are kept. */
  delete(sessionId: string, planId: string): void;
  deleteBySession(sessionId: string): void;
}

interface ChainPlanRow {
  id: string;
  name: string;
  revision: number;
  fingerprint: string;
  chain_count: number;
  step_count: number;
  seed_source: string | null;
  document_encrypted: Buffer;
  document_iv: Buffer;
  created_at: string;
  updated_at: string;
  data_set_count?: number;
}

function seedSourceOf(value: string | null): SeedSource["kind"] | null {
  return value === "specification" || value === "workflow" || value === "collection" ? value : null;
}

function stepCount(plan: ChainPlan): number {
  return plan.chains.reduce((total, chain) => total + chain.steps.length, 0);
}

export class SqliteChainPlanRepository implements ChainPlanRepository {
  constructor(private readonly connection: SqliteConnection) {}

  list(sessionId: string): ChainPlanSummary[] {
    const rows = this.connection.db
      .prepare(
        `SELECT p.id, p.name, p.chain_count, p.step_count, p.seed_source, p.updated_at,
                (SELECT COUNT(*) FROM chain_plan_data_sets d WHERE d.session_id = p.session_id AND d.plan_id = p.id) AS data_set_count
         FROM chain_plans p WHERE p.session_id = ? ORDER BY p.updated_at DESC, p.id ASC`,
      )
      .all(sessionId) as ChainPlanRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      chainCount: row.chain_count,
      stepCount: row.step_count,
      dataSetCount: row.data_set_count ?? 0,
      seedSource: seedSourceOf(row.seed_source),
      updatedAt: row.updated_at,
    }));
  }

  count(sessionId: string): number {
    return (this.connection.db.prepare("SELECT COUNT(*) AS n FROM chain_plans WHERE session_id = ?").get(sessionId) as { n: number }).n;
  }

  get(sessionId: string, planId: string): ChainPlan | undefined {
    const row = this.connection.db.prepare("SELECT * FROM chain_plans WHERE session_id = ? AND id = ?").get(sessionId, planId) as ChainPlanRow | undefined;
    if (!row) return undefined;
    const document = JSON.parse(this.connection.cipher.decrypt(row.document_encrypted, row.document_iv)) as ChainPlan;
    return { ...document, dataSets: [] };
  }

  create(sessionId: string, plan: ChainPlan): void {
    const { ciphertext, iv } = this.encrypt(plan);
    this.connection.db
      .prepare(
        `INSERT INTO chain_plans
           (id, session_id, name, revision, fingerprint, chain_count, step_count, seed_source, document_encrypted, document_iv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(plan.id, sessionId, plan.name, plan.revision, plan.fingerprint, plan.chains.length, stepCount(plan), plan.seedingReport?.source.kind ?? null, ciphertext, iv, plan.createdAt, plan.updatedAt);
  }

  save(sessionId: string, plan: ChainPlan, expectedRevision: number): ChainPlanSaveResult {
    const { ciphertext, iv } = this.encrypt(plan);
    const changes = this.connection.db
      .prepare(
        `UPDATE chain_plans
         SET name = ?, revision = ?, fingerprint = ?, chain_count = ?, step_count = ?, seed_source = ?, document_encrypted = ?, document_iv = ?, updated_at = ?
         WHERE session_id = ? AND id = ? AND revision = ?`,
      )
      .run(plan.name, plan.revision, plan.fingerprint, plan.chains.length, stepCount(plan), plan.seedingReport?.source.kind ?? null, ciphertext, iv, plan.updatedAt, sessionId, plan.id, expectedRevision).changes;
    return changes === 1 ? { ok: true } : { ok: false, current: this.get(sessionId, plan.id) };
  }

  delete(sessionId: string, planId: string): void {
    const db = this.connection.db;
    db.transaction(() => {
      db.prepare("DELETE FROM chain_plan_data_sets WHERE session_id = ? AND plan_id = ?").run(sessionId, planId);
      db.prepare("DELETE FROM chain_plans WHERE session_id = ? AND id = ?").run(sessionId, planId);
    })();
  }

  deleteBySession(sessionId: string): void {
    const db = this.connection.db;
    db.transaction(() => {
      db.prepare("DELETE FROM chain_plan_data_sets WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM chain_plans WHERE session_id = ?").run(sessionId);
    })();
  }

  private encrypt(plan: ChainPlan): { ciphertext: Buffer; iv: Buffer } {
    return this.connection.cipher.encrypt(JSON.stringify({ ...plan, dataSets: [] }));
  }
}

let singleton: ChainPlanRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getChainPlanRepository(): ChainPlanRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteChainPlanRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
