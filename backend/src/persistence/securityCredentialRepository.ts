import { randomUUID } from "node:crypto";
import type { CredentialStatus } from "@apipilot/shared-domain";
import { onExpire } from "../session/sessionRegistry";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable, **session-scoped, write-only** store for the credentials a Security Lab identity acts with
 * (specs/057 research R8, FR-048). The existing environment store cannot hold them, because its routes return
 * every value to the browser in plain text. Here a value is encrypted with the credential cipher, removed with
 * the session by the existing `onExpire` listener, and readable by exactly one caller: the sender, through
 * `read`, at send time. Nothing else on this interface returns a value, and no route may expose `read`.
 */

export type CredentialKind = "active" | "expired";

export interface CredentialKey {
  profileId: string;
  identity: string;
  scheme: string;
  kind: CredentialKind;
}

export interface SecurityCredentialRepository {
  /** Stores or replaces a value. An empty string clears it instead. */
  set(sessionId: string, key: CredentialKey, value: string, updatedAt: string): void;
  clear(sessionId: string, key: CredentialKey): boolean;
  isSet(sessionId: string, key: CredentialKey): boolean;
  /** Which credentials are set for a profile. Never a value. */
  listStatus(sessionId: string, profileId: string): Array<Omit<CredentialStatus, "set">>;
  /** The value, for the sender only. Never call this from a route, a log line or a response builder. */
  read(sessionId: string, key: CredentialKey): string | undefined;
  /** Every active or expired value of a profile, for the sender to resolve a run's identities in one pass. */
  readAllForRun(sessionId: string, profileId: string): Array<CredentialKey & { value: string }>;
  deleteByProfile(sessionId: string, profileId: string): void;
  /** Removes an identity's credentials when the identity is removed from its profile. */
  deleteByIdentity(sessionId: string, profileId: string, identity: string): void;
  deleteBySession(sessionId: string): void;
}

interface CredentialRow {
  profile_id: string;
  identity: string;
  scheme: string;
  kind: string;
  value_encrypted: Buffer;
  value_iv: Buffer;
}

export class SqliteSecurityCredentialRepository implements SecurityCredentialRepository {
  constructor(private readonly connection: SqliteConnection) {}

  set(sessionId: string, key: CredentialKey, value: string, updatedAt: string): void {
    if (value === "") {
      this.clear(sessionId, key);
      return;
    }
    const { ciphertext, iv } = this.connection.cipher.encrypt(value);
    this.connection.db
      .prepare(
        `INSERT INTO security_credentials (id, session_id, profile_id, identity, scheme, kind, value_encrypted, value_iv, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, profile_id, identity, scheme, kind) DO UPDATE SET
           value_encrypted = excluded.value_encrypted, value_iv = excluded.value_iv, updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), sessionId, key.profileId, key.identity, key.scheme, key.kind, ciphertext, iv, updatedAt);
  }

  clear(sessionId: string, key: CredentialKey): boolean {
    return (
      this.connection.db
        .prepare("DELETE FROM security_credentials WHERE session_id = ? AND profile_id = ? AND identity = ? AND scheme = ? AND kind = ?")
        .run(sessionId, key.profileId, key.identity, key.scheme, key.kind).changes > 0
    );
  }

  isSet(sessionId: string, key: CredentialKey): boolean {
    return (
      this.connection.db
        .prepare(
          "SELECT 1 AS present FROM security_credentials WHERE session_id = ? AND profile_id = ? AND identity = ? AND scheme = ? AND kind = ?",
        )
        .get(sessionId, key.profileId, key.identity, key.scheme, key.kind) !== undefined
    );
  }

  listStatus(sessionId: string, profileId: string): Array<Omit<CredentialStatus, "set">> {
    const rows = this.connection.db
      .prepare("SELECT identity, scheme, kind FROM security_credentials WHERE session_id = ? AND profile_id = ? ORDER BY identity, scheme, kind")
      .all(sessionId, profileId) as Array<{ identity: string; scheme: string; kind: string }>;
    return rows.map((row) => ({ identity: row.identity, scheme: row.scheme, kind: row.kind as CredentialKind }));
  }

  read(sessionId: string, key: CredentialKey): string | undefined {
    const row = this.connection.db
      .prepare(
        `SELECT profile_id, identity, scheme, kind, value_encrypted, value_iv FROM security_credentials
         WHERE session_id = ? AND profile_id = ? AND identity = ? AND scheme = ? AND kind = ?`,
      )
      .get(sessionId, key.profileId, key.identity, key.scheme, key.kind) as CredentialRow | undefined;
    return row ? this.connection.cipher.decrypt(row.value_encrypted, row.value_iv) : undefined;
  }

  readAllForRun(sessionId: string, profileId: string): Array<CredentialKey & { value: string }> {
    const rows = this.connection.db
      .prepare(
        `SELECT profile_id, identity, scheme, kind, value_encrypted, value_iv FROM security_credentials
         WHERE session_id = ? AND profile_id = ? ORDER BY identity, scheme, kind`,
      )
      .all(sessionId, profileId) as CredentialRow[];
    return rows.map((row) => ({
      profileId: row.profile_id,
      identity: row.identity,
      scheme: row.scheme,
      kind: row.kind as CredentialKind,
      value: this.connection.cipher.decrypt(row.value_encrypted, row.value_iv),
    }));
  }

  deleteByProfile(sessionId: string, profileId: string): void {
    this.connection.db.prepare("DELETE FROM security_credentials WHERE session_id = ? AND profile_id = ?").run(sessionId, profileId);
  }

  deleteByIdentity(sessionId: string, profileId: string, identity: string): void {
    this.connection.db
      .prepare("DELETE FROM security_credentials WHERE session_id = ? AND profile_id = ? AND identity = ?")
      .run(sessionId, profileId, identity);
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM security_credentials WHERE session_id = ?").run(sessionId);
  }
}

let singleton: SecurityCredentialRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

/** Process-wide (or per-test) instance, rebuilt whenever the shared connection changes. */
export function getSecurityCredentialRepository(): SecurityCredentialRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteSecurityCredentialRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}

// Session data goes with the session (FR-051), like profiles and evidence.
onExpire((sessionId) => {
  getSecurityCredentialRepository().deleteBySession(sessionId);
});
