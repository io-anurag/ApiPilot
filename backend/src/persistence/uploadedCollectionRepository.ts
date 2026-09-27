import type { UploadedCollectionSet } from "@apipilot/shared-domain";
import { DuplicateNameError, UploadedCollectionNotFoundError } from "../externalCollections/errors";
import { toStoredVariableValues } from "../externalCollections/variableValueText";
import { getSharedConnection, type SqliteConnection } from "./connection";

/**
 * Durable backing for `uploadedCollectionStore.ts`, mirroring `environmentRepository.ts` exactly
 * (research.md D5): session-scoped, `variableValues` encrypted at rest via the shared
 * `CredentialCipher` (FR-009), `collection` stored as plaintext (research.md D4 — a Postman
 * collection references credentials via `{{variables}}`, not by embedding them).
 */
export interface UploadedCollectionInput {
  name: string;
  tier: UploadedCollectionSet["tier"];
  collection: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
}

export interface UploadedCollectionRepository {
  list(sessionId: string): UploadedCollectionSet[];
  get(sessionId: string, id: string): UploadedCollectionSet | undefined;
  create(sessionId: string, id: string, createdAt: string, input: UploadedCollectionInput): UploadedCollectionSet;
  markConfirmed(sessionId: string, id: string, confirmedAt: string): void;
  /** AP-028 (research.md D7): replaces `variableValues` wholesale, mirroring `EnvironmentRepository.update`. */
  updateVariableValues(sessionId: string, id: string, variableValues: Record<string, string>): UploadedCollectionSet;
  /** AP-028 (research.md D4, D7): replaces the stored `collection` JSON wholesale (field/structural edits). */
  updateCollectionBody(sessionId: string, id: string, collection: string): UploadedCollectionSet;
  remove(sessionId: string, id: string): void;
  deleteBySession(sessionId: string): void;
}

interface UploadedCollectionRow {
  id: string;
  session_id: string;
  name: string;
  tier: string;
  collection: string;
  variable_values_encrypted: Buffer;
  variable_values_iv: Buffer;
  request_delay_ms: number;
  confirmed_at: string | null;
  created_at: string;
}

export class SqliteUploadedCollectionRepository implements UploadedCollectionRepository {
  constructor(private readonly connection: SqliteConnection) {}

  private toUploadedCollectionSet(row: UploadedCollectionRow): UploadedCollectionSet {
    const json = this.connection.cipher.decrypt(row.variable_values_encrypted, row.variable_values_iv);
    return {
      id: row.id,
      name: row.name,
      tier: row.tier as UploadedCollectionSet["tier"],
      collection: row.collection,
      // Values saved before run-captured values were stored as text can be numbers or objects.
      variableValues: toStoredVariableValues(JSON.parse(json) as Record<string, unknown>),
      requestDelayMs: row.request_delay_ms,
      confirmedAt: row.confirmed_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  list(sessionId: string): UploadedCollectionSet[] {
    const rows = this.connection.db
      .prepare("SELECT * FROM uploaded_collections WHERE session_id = ? ORDER BY created_at DESC")
      .all(sessionId) as UploadedCollectionRow[];
    return rows.map((row) => this.toUploadedCollectionSet(row));
  }

  get(sessionId: string, id: string): UploadedCollectionSet | undefined {
    const row = this.connection.db
      .prepare("SELECT * FROM uploaded_collections WHERE session_id = ? AND id = ?")
      .get(sessionId, id) as UploadedCollectionRow | undefined;
    return row ? this.toUploadedCollectionSet(row) : undefined;
  }

  private assertNameAvailable(sessionId: string, name: string): void {
    const existing = this.connection.db
      .prepare("SELECT id FROM uploaded_collections WHERE session_id = ? AND name = ?")
      .get(sessionId, name) as { id: string } | undefined;
    if (existing) {
      throw new DuplicateNameError(name);
    }
  }

  create(
    sessionId: string,
    id: string,
    createdAt: string,
    input: UploadedCollectionInput,
  ): UploadedCollectionSet {
    this.assertNameAvailable(sessionId, input.name);
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(input.variableValues));
    this.connection.db
      .prepare(
        `INSERT INTO uploaded_collections
           (id, session_id, name, tier, collection, variable_values_encrypted, variable_values_iv, request_delay_ms, confirmed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(id, sessionId, input.name, input.tier, input.collection, ciphertext, iv, input.requestDelayMs, createdAt);
    return {
      id,
      name: input.name,
      tier: input.tier,
      collection: input.collection,
      variableValues: input.variableValues,
      requestDelayMs: input.requestDelayMs,
      createdAt,
    };
  }

  markConfirmed(sessionId: string, id: string, confirmedAt: string): void {
    const result = this.connection.db
      .prepare("UPDATE uploaded_collections SET confirmed_at = ? WHERE session_id = ? AND id = ?")
      .run(confirmedAt, sessionId, id);
    if (result.changes === 0) {
      throw new UploadedCollectionNotFoundError(id);
    }
  }

  updateVariableValues(sessionId: string, id: string, variableValues: Record<string, string>): UploadedCollectionSet {
    const existing = this.get(sessionId, id);
    if (!existing) throw new UploadedCollectionNotFoundError(id);
    const { ciphertext, iv } = this.connection.cipher.encrypt(JSON.stringify(variableValues));
    this.connection.db
      .prepare(
        "UPDATE uploaded_collections SET variable_values_encrypted = ?, variable_values_iv = ? WHERE session_id = ? AND id = ?",
      )
      .run(ciphertext, iv, sessionId, id);
    return { ...existing, variableValues };
  }

  updateCollectionBody(sessionId: string, id: string, collection: string): UploadedCollectionSet {
    const existing = this.get(sessionId, id);
    if (!existing) throw new UploadedCollectionNotFoundError(id);
    this.connection.db
      .prepare("UPDATE uploaded_collections SET collection = ? WHERE session_id = ? AND id = ?")
      .run(collection, sessionId, id);
    return { ...existing, collection };
  }

  remove(sessionId: string, id: string): void {
    const result = this.connection.db
      .prepare("DELETE FROM uploaded_collections WHERE session_id = ? AND id = ?")
      .run(sessionId, id);
    if (result.changes === 0) {
      throw new UploadedCollectionNotFoundError(id);
    }
  }

  deleteBySession(sessionId: string): void {
    this.connection.db.prepare("DELETE FROM uploaded_collections WHERE session_id = ?").run(sessionId);
  }
}

let singleton: UploadedCollectionRepository | undefined;
let singletonConnection: SqliteConnection | undefined;

export function getUploadedCollectionRepository(): UploadedCollectionRepository {
  const connection = getSharedConnection();
  if (singleton === undefined || singletonConnection !== connection) {
    singleton = new SqliteUploadedCollectionRepository(connection);
    singletonConnection = connection;
  }
  return singleton;
}
