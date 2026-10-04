/**
 * AP-039 Chain Debug Run (specs/039-chain-debug-run data-model.md). One transient execution of a
 * request-chain plan, shown to the engineer in the UI only. Nothing here is ever stored or logged
 * (FR-009, FR-012), and every piece of text a request or response carried reaches these types only
 * as `MaskedText`, so a secret the engineer supplied cannot be in a result (FR-014, FR-015b).
 */

/** A piece of text, or a masked value that stands in for something sensitive. */
export type TextSegment = { kind: "text"; text: string } | { kind: "masked"; valueId: string; revealable: boolean; label: string };

/** Text whose sensitive parts are replaced by segments; the text itself is never reformatted. */
export type MaskedText = readonly TextSegment[];

export interface DebugHeader {
  name: string;
  value: MaskedText;
}

export type DebugBody =
  | { kind: "none" }
  | { kind: "text"; contentType: string | null; text: MaskedText; sizeBytes: number; truncated: boolean }
  | { kind: "binary"; contentType: string | null; sizeBytes: number };

export interface DebugRequest {
  method: string;
  url: MaskedText;
  headers: DebugHeader[];
  body: DebugBody;
}

export interface DebugResponse {
  status: number;
  statusText: string;
  headers: DebugHeader[];
  body: DebugBody;
  /** The URLs followed before the final response, in order. */
  redirects: MaskedText[];
  /** The host a redirect pointed to that is not an allowed host; it was not followed (FR-019). */
  redirectBlockedTo?: string;
}

/** `unsupported-request`: a body on a GET or HEAD request, which a Debug run cannot send. */
export type DebugNoResponseReason = "refused" | "timeout" | "dns" | "aborted" | "unsupported-request" | "error";

export type DebugExtractorFailure =
  | { code: "not-extracted-status" }
  | { code: "body-not-json"; contentType: string | null }
  | { code: "path-not-found"; path: string }
  | { code: "value-not-scalar"; found: "object" | "array" | "null" | "empty-text" }
  | { code: "header-missing"; header: string };

export type DebugExtractorSource = { kind: "body"; path: string } | { kind: "header"; name: string };

export interface DebugExtractorOutcome {
  extractorId: string;
  name: string;
  source: DebugExtractorSource;
  outcome: { kind: "extracted"; value: MaskedText } | { kind: "failed"; reason: DebugExtractorFailure };
}

export interface DebugCheckOutcome {
  checkId: string;
  kind: "field-exists" | "field-equals" | "body-contains" | "time-at-most";
  passed: boolean;
  /** What was compared, in words. Names a path or searched text from the plan, never a body value. */
  detail: string;
}

export interface DebugStatusOutcome {
  expected: string[];
  received: number | null;
  ok: boolean;
}

export type DebugStopReason = "extractor-failed" | "unexpected-status" | "setup-failed";

export type DebugSkipCause =
  | { kind: "stopped-by"; stepId: string; stepName: string; reason: DebugStopReason }
  | { kind: "missing-value"; names: string[] }
  | { kind: "missing-extracted"; names: string[] }
  | { kind: "host-not-allowed"; host: string }
  | { kind: "not-reached"; reason: "run-cancelled" | "run-time-cap" };

export interface DebugSentStep {
  status: "sent";
  stepId: string;
  stepName: string;
  request: DebugRequest;
  /** `null` when no response arrived; see `noResponseReason`. */
  response: DebugResponse | null;
  noResponseReason?: DebugNoResponseReason;
  durationMs: number;
  statusOutcome: DebugStatusOutcome;
  extractors: DebugExtractorOutcome[];
  checks: DebugCheckOutcome[];
}

export interface DebugNotSentStep {
  status: "not-sent";
  stepId: string;
  stepName: string;
  cause: DebugSkipCause;
}

export type DebugStepOutcome = DebugSentStep | DebugNotSentStep;

export interface DebugChainOutcome {
  chainId: string;
  chainName: string;
  steps: DebugStepOutcome[];
  stoppedAt?: { stepId: string; cause: DebugStopReason };
}

export type DebugRunOutcome = "completed" | "stopped-early" | "setup-failed" | "cut-off" | "cancelled";

export interface DebugRunResult {
  debugRunId: string;
  planId: string;
  environment: { id: string; name: string; tier: string; baseUrl: string };
  startedAt: string;
  durationMs: number;
  outcome: DebugRunOutcome;
  setup: DebugStepOutcome[];
  chains: DebugChainOutcome[];
  /** The first row of each data set is used; this says so. */
  dataRows: { dataSetName: string; rowNumber: number }[];
  /** Plain statements about the run, for example that think time was not waited out. */
  notes: string[];
}

/** `GET .../values/:valueId`: one revealed value. */
export interface DebugRevealedValue {
  value: string;
}

/** The text of a masked text with each masked segment replaced by `placeholder`. */
export function maskedTextToString(text: MaskedText, placeholder = "••••••"): string {
  return text.map((segment) => (segment.kind === "text" ? segment.text : placeholder)).join("");
}
