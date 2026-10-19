import type { SecurityProfile } from "@apipilot/shared-domain";
import { onExpire } from "../session/sessionRegistry";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, **session-scoped** backing for Security Lab profiles (specs/057 research R8 and R13, FR-051).
 * Session data: it is removed with the session by the existing `onExpire` listener, as environments are.
 * A profile holds no secret value: an identity names environment variables, and the values stay in the
 * environment's encrypted store. The document is stored as JSON because it holds no credential.
 */
export interface SecurityProfileRepository {
  list(sessionId: string): SecurityProfile[];
  get(sessionId: string, id: string): SecurityProfile | undefined;
  findByName(sessionId: string, name: string): SecurityProfile | undefined;
  create(sessionId: string, profile: SecurityProfile): void;
  update(sessionId: string, profile: SecurityProfile): void;
  delete(sessionId: string, id: string): boolean;
  deleteBySession(sessionId: string): void;
}

interface ProfileRow {
  document: string;
}

export class SqliteSecurityProfileRepository implements SecurityProfileRepository {
  constructor(private readonly connection: SqliteConnection) {}

  list(sessionId: string): SecurityProfile[] {
    const rows = this.connection.db
      .prepare("SELECT document FROM security_profiles WHERE session_id = ? ORDER BY name ASC, id ASC")
      .all(sessionId) as ProfileRow[];
    return rows.map((row) => JSON.parse(row.document) as SecurityProfile);
  }

  get(sessionId: string, id: string): SecurityProfile | undefined {
    const row = this.connection.db
      .prepare("SELECT document FROM security_profiles WHERE session_id = ? AND id = ?")
      .get(sessionId, id) as ProfileRow | undefined;
    return row ? (JSON.parse(row.document) as SecurityProfile) : undefined;
  }

  findByName(sessionId: string, name: string): SecurityProfile | undefined {
    const row = this.connection.db
      .prepare("SELECT document FROM security_profiles WHERE session_id = ? AND name = ?")
      .get(sessionId, name) as ProfileRow | undefined;
    return row ? (JSON.parse(row.document) as SecurityProfile) : undefined;
  }

  create(sessionId: string, profile: SecurityProfile): void {
    this.connection.db
      .prepare(
        `INSERT INTO security_profiles (id, session_id, name, environment_id, document, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(profile.id, sessionId, profile.name, profile.environmentId, JSON.stringify(profile), profile.createdAt, profile.updatedAt);
  }

  update(sessionId: string, profile: SecurityProfile): void {
    this.connection.db
      .prepare(
        `UPDATE security_profiles SET name = ?, environment_id = ?, document = ?, updated_at = ?
         WHERE session_id = ? AND id = ?`,
      )
      .run(profile.name, profile.environmentId, JSON.stringify(profile), profile.updatedAt, sessionId, profile.id);
  }

  delete(sessionId: string, id: string): boolean {
    return this.connection.db.prepare("DELETE FROM security_profiles WHERE session_id = ? AND id = ?").run(sessionId, id).changes > 0;
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM security_profiles WHERE session_id = ?").run(sessionId);
  }
}

let singleton: SecurityProfileRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test) instance, rebuilt whenever the shared connection changes. */
export function getSecurityProfileRepository(): SecurityProfileRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityProfileRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}

// Session data goes with the session (FR-051), exactly as environments do.
onExpire((sessionId) => {
  getSecurityProfileRepository().deleteBySession(sessionId);
});
