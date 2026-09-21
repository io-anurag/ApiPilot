import { randomUUID } from "node:crypto";
import type { UploadedCollectionSet } from "@apipilot/shared-domain";
import { getSessionId } from "../session/sessionContext";
import { onExpire } from "../session/sessionRegistry";
import {
  getUploadedCollectionRepository,
  type UploadedCollectionInput,
} from "../persistence/uploadedCollectionRepository";
import { UploadedCollectionNotFoundError } from "./errors";

/**
 * Session-scoped `UploadedCollectionSet` CRUD, mirroring `execution/environmentStore.ts`
 * (research.md D5). Durably backed by SQLite, removed when the owning session is idle-evicted,
 * exactly like `Environment`.
 */

onExpire((sessionId) => {
  getUploadedCollectionRepository().deleteBySession(sessionId);
});

export type { UploadedCollectionInput };

export function listUploadedCollections(): UploadedCollectionSet[] {
  return getUploadedCollectionRepository().list(getSessionId());
}

export function getUploadedCollection(id: string): UploadedCollectionSet {
  const uploadedCollection = getUploadedCollectionRepository().get(getSessionId(), id);
  if (!uploadedCollection) throw new UploadedCollectionNotFoundError(id);
  return uploadedCollection;
}

/**
 * Creates a new `UploadedCollectionSet` for the calling session (FR-001). Throws
 * `DuplicateNameError` if `name` is taken.
 *
 * `input.collection` is trusted as-is (already validated and id-backfilled by the caller, AP-028
 * research.md D2/D9 — see `api/externalCollections.ts`'s upload route) — this store layer does
 * not itself parse or validate the collection body, matching its existing "trust the input"
 * contract for every other field.
 */
export function createUploadedCollection(input: UploadedCollectionInput): UploadedCollectionSet {
  return getUploadedCollectionRepository().create(getSessionId(), randomUUID(), new Date().toISOString(), input);
}

/** Removes an uploaded collection (FR-017). Past runs against it keep their own snapshot, unaffected. */
export function removeUploadedCollection(id: string): void {
  getUploadedCollectionRepository().remove(getSessionId(), id);
}

/** Records that the FR-007 "unverified content" confirmation has been accepted for this artifact. */
export function markUploadedCollectionConfirmed(id: string): void {
  getUploadedCollectionRepository().markConfirmed(getSessionId(), id, new Date().toISOString());
}

/** AP-028 (research.md D7): replaces a collection's variable values wholesale (FR-004, FR-009, FR-018). */
export function updateUploadedCollectionVariables(id: string, variableValues: Record<string, string>): UploadedCollectionSet {
  return getUploadedCollectionRepository().updateVariableValues(getSessionId(), id, variableValues);
}

/** AP-028 (research.md D4, D7): replaces a collection's stored JSON wholesale (field/structural edits). */
export function updateUploadedCollectionBody(id: string, collection: string): UploadedCollectionSet {
  return getUploadedCollectionRepository().updateCollectionBody(getSessionId(), id, collection);
}
