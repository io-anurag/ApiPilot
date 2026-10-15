import type { DebugRequest, DebugResponse, MaskedText } from "./chainDebugRun";

/**
 * AP-053 Debug run for Run k6 Script (specs/053-user-script-debug-run data model). One transient run of a
 * confirmed, user-supplied script with one virtual user and one iteration, shown to the engineer in the UI
 * only (constitution v3.1.0, XVII, Debug run of a supplied script). Nothing here is ever stored or logged,
 * and every piece of text a request or response carried reaches these types only as `MaskedText`, so a
 * value mapped from the environment cannot be in a result. The request and response shapes are the
 * request-chain Debug run's (`chainDebugRun.ts`).
 */

/** The most requests a Debug run keeps; past it k6 is cancelled and the outcome is `cut-off`. */
export const USER_SCRIPT_DEBUG_MAX_EXCHANGES = 200;
/** The longest a Debug run may take, in milliseconds. */
export const USER_SCRIPT_DEBUG_TIME_LIMIT_MS = 60_000;

/** One request the script sent and the response it got, from k6's HTTP debug records. */
export interface UserScriptDebugExchange {
  /** 1-based, in the order k6 logged the requests. */
  index: number;
  /** The request's `name` tag, when the script set one; masked like any other text. */
  name: MaskedText | null;
  /** `url` holds the host and request target: k6 does not log the scheme. */
  request: DebugRequest;
  /** `null` when no response arrived. A redirect is a separate exchange, so `redirects` is always empty. */
  response: DebugResponse | null;
}

/** `no-requests`: the iteration ended without sending an HTTP request. */
export type UserScriptDebugOutcome = "completed" | "failed" | "no-requests" | "cut-off" | "cancelled";

export type UserScriptDebugCutOffReason = "exchange-limit" | "time-limit";

export interface UserScriptDebugResult {
  debugRunId: string;
  scriptId: string;
  scriptName: string;
  scriptSha256: string;
  environment: { id: string; name: string; tier: string; baseUrl: string };
  startedAt: string;
  durationMs: number;
  outcome: UserScriptDebugOutcome;
  /** Set when `outcome` is `cut-off`. */
  cutOffReason?: UserScriptDebugCutOffReason;
  k6ExitCode: number | null;
  /** k6's own error text (at most 2,000 characters), for a `failed` outcome only. */
  k6Message?: string;
  exchanges: UserScriptDebugExchange[];
  /** Plain statements about the run, for example that the load profile did not apply. */
  notes: string[];
}
