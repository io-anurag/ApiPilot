import type { Environment } from "@apipilot/shared-domain";
import { DuplicateEnvironmentNameError, EnvironmentNotFoundError } from "../execution/errors";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for `environmentStore.ts` (specs/025-local-persistence-layer contracts/
 * persistence-repositories.md). Session-scoped: every method is keyed by `sessionId`, mirroring
 * the in-memory `Map<sessionId, Environment[]>` this replaces (research.md D4). Credential-
 * carrying `variableValues` is encrypted at rest (research.md D7) entirely inside this module —
 * callers only ever see the plain `Environment` shape.
 */
export interface EnvironmentInput {
  name: string;
  tier: Environment["tier"];
  baseUrl: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
}

export interface EnvironmentRepository {
  list(sessionId: string): Environment[];
  get(sessionId: string, environmentId: string): Environment | undefined;
  create(sessionId: string, id: string, input: EnvironmentInput): Environment;
  update(sessionId: string, environmentId: string, input: EnvironmentInput): Environment;
  deleteBySession(sessionId: string): void;
}

interface EnvironmentRow {
  id: string;
  session_id: string;
  name: string;
  tier: string;
  base_url: string;
  variable_values_encrypted: Buffer;
  variable_values_iv: Buffer;
  request_delay_ms: number;
}

export class SqliteEnvironmentRepository implements EnvironmentRepository {
  constructor(private readonly connection: SqliteConnection) {}

  private toEnvironment(row: EnvironmentRow): Environment {
    const json = this.connection.cipher.decrypt(row.variable_values_encrypted, row.variable_values_iv);
    return {
      id: row.id,
      name: row.name,
      tier: row.tier as Environment["tier"],
      baseUrl: row.base_url,
      variableValues: JSON.parse(json) as Record<string, string>,
      requestDelayMs: row.request_delay_ms,
    };
  }

  list(sessionId: string): Environment[] {
    const rows = this.connection.db
      .prepare("SELECT * FROM environments WHERE session_id = ?")
      .all(sessionId) as EnvironmentRow[];
    return rows.map((row) => this.toEnvironment(row));
  }

  get(sessionId: string, environmentId: string): Environment | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM environments WHERE session_id = ? AND id = ?")
      .get(sessionId, environmentId) as EnvironmentRow | undefined;
    return row ? this.toEnvironment(row) : undefined;
  }

  private assertNameAvailable(sessionId: string, name: string, excludeId?: string): void {
    const existing = this.connection.db
      .prepare("SELECT id FROM environments WHERE session_id = ? AND name = ?")
      .get(sessionId, name) as { id: string } | undefined;
    if (existing && existing.id !== excludeId) {
      throw new DuplicateEnvironmentNameError(name);
    }
  }

  create(sessionId: string, id: string, input: EnvironmentInput): Environment {
    this.assertNameAvailable(sessionId, input.name);
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(input.variableValues));
    this.connection.db
      .prepare(
        `INSERT INTO environments
           (id, session_id, name, tier, base_url, variable_values_encrypted, variable_values_iv, request_delay_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, input.name, input.tier, input.baseUrl, ciphertext, iv, input.requestDelayMs);
    return { id, name: input.name, tier: input.tier, baseUrl: input.baseUrl, variableValues: input.variableValues, requestDelayMs: input.requestDelayMs };
  }

  update(sessionId: string, environmentId: string, input: EnvironmentInput): Environment {
    if (!this.get(sessionId, environmentId)) throw new EnvironmentNotFoundError(environmentId);
    this.assertNameAvailable(sessionId, input.name, environmentId);
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(input.variableValues));
    this.connection.db
      .prepare(
        `UPDATE environments
         SET name = ?, tier = ?, base_url = ?, variable_values_encrypted = ?, variable_values_iv = ?, request_delay_ms = ?
         WHERE session_id = ? AND id = ?`,
      )
      .run(input.name, input.tier, input.baseUrl, ciphertext, iv, input.requestDelayMs, sessionId, environmentId);
    return {
      id: environmentId,
      name: input.name,
      tier: input.tier,
      baseUrl: input.baseUrl,
      variableValues: input.variableValues,
      requestDelayMs: input.requestDelayMs,
    };
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM environments WHERE session_id = ?").run(sessionId);
  }
}

let singleton: EnvironmentRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/**
 * Process-wide (or per-test, via `tests/setup/testDb.ts` swapping the shared connection)
 * repository instance, rebuilt automatically whenever the underlying connection changes.
 */
export function getEnvironmentRepository(): EnvironmentRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteEnvironmentRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
