import type { ScriptConfirmation, UserScriptLoad, UserScriptThreshold, UserScriptValueSource } from "@apipilot/shared-domain";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for AP-034 user scripts (specs/034-run-user-k6-script research R7, R8). Every
 * method takes the session id explicitly. The script's bytes and the hosts stated at confirmation
 * are encrypted with the connection's credential cipher, the same protection as environment
 * values (FR-002). The bytes are stored as base64 inside the ciphertext, so they round-trip
 * exactly, byte order marks and line endings included (FR-010).
 */

/** Settings as stored: names and sources only, never a value (FR-025). */
export interface StoredUserScriptSettings {
  mapping: { name: string; source: UserScriptValueSource }[];
  removedNames: string[];
  load: UserScriptLoad;
  thresholds: UserScriptThreshold[];
}

export interface StoredUserScriptMeta {
  id: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  /** As stored; it confirms the script only while `sha256` matches (research R8). */
  confirmedSha256: string | null;
  settings: StoredUserScriptSettings;
  createdAt: string;
  updatedAt: string;
}

export interface StoredUserScript extends StoredUserScriptMeta {
  content: Buffer;
  confirmation: ScriptConfirmation | null;
}

export interface NewUserScript {
  id: string;
  name: string;
  content: Buffer;
  sha256: string;
  settings: StoredUserScriptSettings;
  at: string;
}

export interface UserScriptRepository {
  /** Newest `updated_at` first, ties broken by id. */
  listBySession(sessionId: string): StoredUserScriptMeta[];
  get(sessionId: string, scriptId: string): StoredUserScript | undefined;
  create(sessionId: string, script: NewUserScript): void;
  /** A new version: the confirmation is cleared in the same statement (FR-016). */
  replaceContent(sessionId: string, scriptId: string, content: Buffer, sha256: string, settings: StoredUserScriptSettings, at: string): void;
  /** Keeps the confirmation (FR-016: a rename does not change the bytes). */
  rename(sessionId: string, scriptId: string, name: string, at: string): void;
  /** Writes only when `sha256` is the stored one; returns whether it did (research R8). */
  confirm(sessionId: string, scriptId: string, sha256: string, hostsStated: string[], at: string): boolean;
  saveSettings(sessionId: string, scriptId: string, settings: StoredUserScriptSettings): void;
  delete(sessionId: string, scriptId: string): void;
  deleteBySession(sessionId: string): void;
  hasAny(sessionId: string): boolean;
}

interface UserScriptRow {
  id: string;
  session_id: string;
  name: string;
  content_encrypted: Buffer;
  content_iv: Buffer;
  size_bytes: number;
  sha256: string;
  confirmed_sha256: string | null;
  confirmed_at: string | null;
  confirmed_hosts_encrypted: Buffer | null;
  confirmed_hosts_iv: Buffer | null;
  settings: string;
  created_at: string;
  updated_at: string;
}

const META_COLUMNS = "id, session_id, name, size_bytes, sha256, confirmed_sha256, settings, created_at, updated_at";

function toMeta(row: Pick<UserScriptRow, "id" | "name" | "size_bytes" | "sha256" | "confirmed_sha256" | "settings" | "created_at" | "updated_at">): StoredUserScriptMeta {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    confirmedSha256: row.confirmed_sha256,
    settings: JSON.parse(row.settings) as StoredUserScriptSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteUserScriptRepository implements UserScriptRepository {
  constructor(private readonly connection: SqliteConnection) {}

  listBySession(sessionId: string): StoredUserScriptMeta[] {
    const rows = this.connection.db
      .prepare(`SELECT ${META_COLUMNS} FROM user_scripts WHERE session_id = ? ORDER BY updated_at DESC, id ASC`)
      .all(sessionId) as UserScriptRow[];
    return rows.map(toMeta);
  }

  get(sessionId: string, scriptId: string): StoredUserScript | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM user_scripts WHERE session_id = ? AND id = ?")
      .get(sessionId, scriptId) as UserScriptRow | undefined;
    if (!row) return undefined;
    const content = Buffer.from(this.connection.cipher.decrypt(row.content_encrypted, row.content_iv), "base64");
    let confirmation: ScriptConfirmation | null = null;
    if (row.confirmed_sha256 && row.confirmed_at && row.confirmed_hosts_encrypted && row.confirmed_hosts_iv) {
      const hostsStated = JSON.parse(this.connection.cipher.decrypt(row.confirmed_hosts_encrypted, row.confirmed_hosts_iv)) as string[];
      confirmation = { sha256: row.confirmed_sha256, confirmedAt: row.confirmed_at, hostsStated };
    }
    return { ...toMeta(row), content, confirmation };
  }

  create(sessionId: string, script: NewUserScript): void {
    const { ciphertext, iv } = this.connection.cipher.encrypt(script.content.toString("base64"));
    this.connection.db
      .prepare(
        `INSERT INTO user_scripts
           (id, session_id, name, content_encrypted, content_iv, size_bytes, sha256, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(script.id, sessionId, script.name, ciphertext, iv, script.content.length, script.sha256, JSON.stringify(script.settings), script.at, script.at);
  }

  replaceContent(sessionId: string, scriptId: string, content: Buffer, sha256: string, settings: StoredUserScriptSettings, at: string): void {
    const { ciphertext, iv } = this.connection.cipher.encrypt(content.toString("base64"));
    this.connection.db
      .prepare(
        `UPDATE user_scripts
         SET content_encrypted = ?, content_iv = ?, size_bytes = ?, sha256 = ?, settings = ?, updated_at = ?,
             confirmed_sha256 = NULL, confirmed_at = NULL, confirmed_hosts_encrypted = NULL, confirmed_hosts_iv = NULL
         WHERE session_id = ? AND id = ?`,
      )
      .run(ciphertext, iv, content.length, sha256, JSON.stringify(settings), at, sessionId, scriptId);
  }

  rename(sessionId: string, scriptId: string, name: string, at: string): void {
    this.connection.db.prepare("UPDATE user_scripts SET name = ?, updated_at = ? WHERE session_id = ? AND id = ?").run(name, at, sessionId, scriptId);
  }

  confirm(sessionId: string, scriptId: string, sha256: string, hostsStated: string[], at: string): boolean {
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(hostsStated));
    return (
      this.connection.db
        .prepare(
          `UPDATE user_scripts
           SET confirmed_sha256 = ?, confirmed_at = ?, confirmed_hosts_encrypted = ?, confirmed_hosts_iv = ?
           WHERE session_id = ? AND id = ? AND sha256 = ?`,
        )
        .run(sha256, at, ciphertext, iv, sessionId, scriptId, sha256).changes === 1
    );
  }

  saveSettings(sessionId: string, scriptId: string, settings: StoredUserScriptSettings): void {
    this.connection.db.prepare("UPDATE user_scripts SET settings = ? WHERE session_id = ? AND id = ?").run(JSON.stringify(settings), sessionId, scriptId);
  }

  delete(sessionId: string, scriptId: string): void {
    this.connection.db.prepare("DELETE FROM user_scripts WHERE session_id = ? AND id = ?").run(sessionId, scriptId);
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM user_scripts WHERE session_id = ?").run(sessionId);
  }

  hasAny(sessionId: string): boolean {
    return this.connection.db.prepare("SELECT 1 FROM user_scripts WHERE session_id = ? LIMIT 1").get(sessionId) !== undefined;
  }
}

let singleton: UserScriptRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getUserScriptRepository(): UserScriptRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteUserScriptRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
