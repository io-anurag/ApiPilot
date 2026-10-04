import { onExpire } from "../../../session/sessionRegistry";

/**
 * The reveal store of the Debug run (specs/039-chain-debug-run research R5, data-model "Reveal
 * store"). It holds, in memory only, the real value behind each *revealable* masked value of the
 * latest Debug run of a plan, so one value can be revealed on request without any value having been
 * sent to the browser. Secret environment values and secret data set values are never put here
 * (FR-015b). Nothing is written to disk or logged; a value leaves only through `reveal`.
 *
 * Held per session and plan: a new Debug run of the plan replaces the old one's values. They expire
 * after `HOLD_MS`, are dropped when the engineer closes the view (`discard`), and when the session
 * is evicted.
 */

export const HOLD_MS = 30 * 60 * 1000;

interface Held {
  debugRunId: string;
  expiresAtMs: number;
  values: Map<string, string>;
}

export class HeldValues {
  private readonly held = new Map<string, Held>();

  constructor(private readonly nowMs: () => number = Date.now) {}

  private static key(sessionId: string, planId: string): string {
    return `${sessionId}:${planId}`;
  }

  /** Keeps `values` for this Debug run, replacing whatever the plan's previous Debug run held. */
  hold(sessionId: string, planId: string, debugRunId: string, values: Map<string, string>): void {
    this.sweep();
    if (values.size === 0) {
      this.held.delete(HeldValues.key(sessionId, planId));
      return;
    }
    this.held.set(HeldValues.key(sessionId, planId), { debugRunId, expiresAtMs: this.nowMs() + HOLD_MS, values: new Map(values) });
  }

  /** The value, or `null` when it is unknown, expired, discarded or replaced; the caller cannot tell which. */
  reveal(sessionId: string, planId: string, debugRunId: string, valueId: string): string | null {
    this.sweep();
    const entry = this.held.get(HeldValues.key(sessionId, planId));
    if (!entry || entry.debugRunId !== debugRunId) return null;
    return entry.values.get(valueId) ?? null;
  }

  /** Drops the values of this Debug run, if they are still the plan's latest. */
  discard(sessionId: string, planId: string, debugRunId: string): void {
    const key = HeldValues.key(sessionId, planId);
    if (this.held.get(key)?.debugRunId === debugRunId) this.held.delete(key);
  }

  clearSession(sessionId: string): void {
    for (const key of [...this.held.keys()]) if (key.startsWith(`${sessionId}:`)) this.held.delete(key);
  }

  private sweep(): void {
    const now = this.nowMs();
    for (const [key, entry] of this.held) if (entry.expiresAtMs <= now) this.held.delete(key);
  }
}

let shared: HeldValues | null = null;

export function getHeldValues(): HeldValues {
  if (shared === null) {
    shared = new HeldValues();
    onExpire((sessionId) => shared?.clearSession(sessionId));
  }
  return shared;
}

/** Tests only: a fresh store, so one test's held values never reach another. */
export function resetHeldValuesForTests(): void {
  shared = null;
}
