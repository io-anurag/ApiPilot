import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the current request's session id through the async call chain without threading a
 * parameter through every `workflowStore.ts` function and every stage module that calls them
 * (research.md D1, specs/017-session-workflow-isolation). Populated once per request by
 * `sessionMiddleware.ts`.
 */
interface SessionContextStore {
  readonly sessionId: string;
}

const storage = new AsyncLocalStorage<SessionContextStore>();

/** Runs `fn` with `sessionId` available to `getSessionId()` for the duration of the call. */
export function runWithSession<T>(sessionId: string, fn: () => T): T {
  return storage.run({ sessionId }, fn);
}

/**
 * Returns the current request's session id. Throws outside of a `runWithSession` context (e.g.
 * a call made outside any HTTP request) rather than silently falling back to shared state,
 * since that would reintroduce the cross-session data leakage this feature exists to prevent.
 */
export function getSessionId(): string {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "getSessionId() called outside of a request session context — sessionMiddleware must run first.",
    );
  }
  return store.sessionId;
}

/**
 * Test-only: establishes a session context for the calling test without an HTTP request, for
 * unit tests that call `workflowStore.ts` (or a stage module) directly. Uses
 * `AsyncLocalStorage.enterWith` rather than `runWithSession`'s callback form so a single call in
 * a test's `beforeEach` covers that whole test body, exactly mirroring what a real request's
 * `sessionMiddleware` pass provides.
 */
export function enterTestSession(sessionId: string): void {
  storage.enterWith({ sessionId });
}
