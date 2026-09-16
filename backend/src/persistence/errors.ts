/**
 * The local storage file exists but could not be opened/read (corrupted, wrong permissions,
 * or not a SQLite file at all) — surfaced once at process start (specs/025-local-persistence-
 * layer FR-007). The system never deletes, renames, or silently recreates a file it cannot
 * read; the operator must resolve it and restart (constitution XIX, Fail Safely).
 */
export class PersistenceInitializationError extends Error {
  constructor(dbPath: string, cause: unknown) {
    super(
      `Could not open the local database at '${dbPath}'. It may be corrupted or unreadable. ` +
        `Move or delete it (a new one will be created automatically) and restart, or restore ` +
        `it from a backup. Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "PersistenceInitializationError";
  }
}
