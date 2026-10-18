import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the current request's retained-work owner id (specs/057 research R22), the way
 * `session/sessionContext.ts` carries the session id. Populated once per Security Lab request by
 * `ownerMiddleware.ts`. The owner id outlives the idle-limited session: it keys retained work
 * (scenarios, runs, results, findings), while the session id keys session data (profiles, evidence).
 */
interface OwnerContextStore {
  readonly ownerId: string;
}

const storage = new AsyncLocalStorage<OwnerContextStore>();

export function runWithOwner<T>(ownerId: string, fn: () => T): T {
  return storage.run({ ownerId }, fn);
}

/** Throws outside a Security Lab request, rather than falling back to shared state that would leak across browsers. */
export function getOwnerId(): string {
  const store = storage.getStore();
  if (!store) {
    throw new Error("getOwnerId() called outside of a Security Lab request - ownerMiddleware must run first.");
  }
  return store.ownerId;
}

/** Test-only: establishes an owner context for the calling test without an HTTP request. */
export function enterTestOwner(ownerId: string): void {
  storage.enterWith({ ownerId });
}
