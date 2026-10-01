import type { K6ExitMeaning } from "@apipilot/shared-domain";

/**
 * What k6's exit code means for a user script's run (specs/034-run-user-k6-script research R13),
 * from k6's own `errext/exitcodes` (checked 2026-10-01). Pure.
 */
const MEANINGS: ReadonlyMap<number, K6ExitMeaning> = new Map([
  [0, "completed"],
  [99, "script-thresholds-crossed"],
  [104, "invalid-config"],
  [107, "script-exception"],
  [108, "aborted-by-script"],
  [110, "marked-failed-by-script"],
]);

/** Exit codes after which the run still completed and its measurements stand. */
const COMPLETED_CODES: ReadonlySet<number> = new Set([0, 99, 108, 110]);
/** Exit codes that mean k6 could not run the script; its message is kept (FR-029). */
const FAILED_CODES: ReadonlySet<number> = new Set([104, 107]);

export function exitMeaningOf(code: number | null): K6ExitMeaning | null {
  if (code === null) return null;
  return MEANINGS.get(code) ?? "other";
}

/** The run's status once k6 exited on its own (a cancellation is decided by the caller). */
export function settledStatusOf(code: number | null, measuredRequests: number): "completed" | "failed" {
  if (code !== null && COMPLETED_CODES.has(code)) return "completed";
  if (code !== null && FAILED_CODES.has(code)) return "failed";
  return measuredRequests > 0 ? "completed" : "failed";
}
