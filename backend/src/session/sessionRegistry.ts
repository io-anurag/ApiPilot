/**
 * Lightweight per-session bookkeeping (specs/017-session-workflow-isolation): tracks whether a
 * session id is live, has never been seen, or was idle-evicted, without owning the (much
 * larger) workflow payload itself — that stays in `workflowStore.ts`. A periodic sweep tombstones
 * (never deletes) an entry idle for over `IDLE_TIMEOUT_MS`, and notifies registered listeners so
 * `workflowStore.ts` can discard the corresponding session's actual workflow state, bounding
 * memory growth from abandoned sessions (FR-007, SC-003) without this module needing to import
 * `workflowStore.ts` back (research.md D3, D4).
 */

interface SessionEntry {
  lastActivityAt: number;
  expired: boolean;
}

export type SessionStatus = "live" | "absent" | "expired";

/** 60 minutes (FR-007) — a business-tunable default, not a hard architectural constraint. */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
/** How often the sweep checks for idle sessions — a fraction of IDLE_TIMEOUT_MS is sufficient. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, SessionEntry>();
const expiryListeners: Array<(sessionId: string) => void> = [];

/** Records activity for `sessionId`, creating a fresh live entry if none exists yet. Does not clear an existing tombstone — only `markActive` does that (called when a new workflow actually starts). */
export function touch(sessionId: string): void {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return;
  }
  sessions.set(sessionId, { lastActivityAt: Date.now(), expired: false });
}

/** Explicitly clears a tombstone (or creates a fresh live entry) — called when a session starts a new workflow, per the lifecycle in data-model.md. */
export function markActive(sessionId: string): void {
  sessions.set(sessionId, { lastActivityAt: Date.now(), expired: false });
}

/** Whether `sessionId` is a live session, was never seen, or is an idle-evicted tombstone. */
export function getStatus(sessionId: string): SessionStatus {
  const entry = sessions.get(sessionId);
  if (!entry) return "absent";
  return entry.expired ? "expired" : "live";
}

/** Registers a callback invoked (synchronously) with a session id the moment it is idle-evicted, so other modules (`workflowStore.ts`) can discard their own per-session state without this module depending on them. */
export function onExpire(listener: (sessionId: string) => void): void {
  expiryListeners.push(listener);
}

function sweep(): void {
  const now = Date.now();
  for (const [sessionId, entry] of sessions) {
    if (!entry.expired && now - entry.lastActivityAt > IDLE_TIMEOUT_MS) {
      entry.expired = true;
      for (const listener of expiryListeners) listener(sessionId);
    }
  }
}

// The real periodic sweep only runs outside tests (mirrors logger.ts's NODE_ENV === "test"
// convention) — automated tests use forceExpireForTest below instead of waiting on a live
// timer, and a background interval would otherwise leave an open handle in the test process.
if (process.env.NODE_ENV !== "test") {
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();
}

/** Test-only hook: immediately tombstones `sessionId` and notifies listeners, without waiting on IDLE_TIMEOUT_MS or the real sweep interval (mirrors `workflowStore.ts`'s `resetStore()` test-only-hook convention). */
export function forceExpireForTest(sessionId: string): void {
  const entry = sessions.get(sessionId) ?? { lastActivityAt: Date.now(), expired: false };
  entry.expired = true;
  sessions.set(sessionId, entry);
  for (const listener of expiryListeners) listener(sessionId);
}

/** Test-only hook: runs one sweep pass immediately, for unit tests that fake the clock forward. */
export function sweepForTest(): void {
  sweep();
}

/** Test-only hook to clear all registry state between test runs (mirrors `resetStore()`). */
export function resetRegistryForTest(): void {
  sessions.clear();
}
