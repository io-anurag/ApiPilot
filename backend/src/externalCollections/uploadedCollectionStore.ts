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

/** Creates a new `UploadedCollectionSet` for the calling session (FR-001). Throws `DuplicateNameError` if `name` is taken. */
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
