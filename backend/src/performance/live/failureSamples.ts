import type { FailureResponse, MaskedText, RecentFailure } from "@apipilot/shared-domain";
import { LIVE_FAILURE_BODY_LIMIT, LIVE_RECENT_FAILURE_LIMIT } from "@apipilot/shared-domain";
import { Masker, type SecretValue } from "../chain/debug/masker";

/**
 * Failed-request samples for the live view (AP-049). The generated script writes one console line per
 * sampled failure (at most one a second per virtual user, body cut to `LIVE_FAILURE_BODY_LIMIT`
 * characters). k6 forwards console lines on stderr, which the backend reads in memory and never
 * writes to disk or to a log. Each line is masked here, kept in a small newest-first ring, and shown
 * only by the live dashboard: no report, stored result or log ever holds it.
 */

export const FAILURE_MARKER = "APIPILOT_FAILURE ";
const MASK_TEXT = "[masked]";

export interface FailureSample {
  step: string;
  journey: string;
  /** 0 when no response was received. */
  status: number;
  contentType: string | null;
  /** The body's length in characters before it was cut. */
  size: number;
  body: string;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Reads one k6 stderr line (JSON log format); null when it is not a failure sample. */
export function parseFailureLine(line: string): FailureSample | null {
  if (!line.includes(FAILURE_MARKER)) return null;
  let outer: unknown;
  try {
    outer = JSON.parse(line);
  } catch {
    return null;
  }
  const message = textOf((outer as { msg?: unknown } | null)?.msg);
  if (message === null || !message.startsWith(FAILURE_MARKER)) return null;
  let sample: Record<string, unknown>;
  try {
    sample = JSON.parse(message.slice(FAILURE_MARKER.length)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const step = textOf(sample.step);
  const journey = textOf(sample.journey);
  const body = textOf(sample.body);
  if (step === null || journey === null || body === null || typeof sample.status !== "number" || typeof sample.size !== "number") return null;
  return {
    step,
    journey,
    status: sample.status,
    contentType: textOf(sample.type),
    size: sample.size,
    body: body.slice(0, LIVE_FAILURE_BODY_LIMIT),
  };
}

/** Masked pieces back to text: a masked value becomes `[masked]`, with no way to reveal it. */
function plainText(segments: MaskedText): string {
  return segments.map((segment) => (segment.kind === "text" ? segment.text : MASK_TEXT)).join("");
}

export interface FailureResponseSettings {
  /** Secret environment values to mask wherever they appear in a response. */
  secrets: readonly SecretValue[];
  /** True when the plan uses secret data set columns: no response text is kept. */
  withhold: boolean;
}

export interface FailureResponseBuilder {
  responseOf(sample: FailureSample): FailureResponse;
}

export function createFailureResponseBuilder(settings: FailureResponseSettings): FailureResponseBuilder {
  const masker = new Masker(settings.secrets);
  return {
    responseOf(sample) {
      if (sample.status === 0) return { kind: "none-received" };
      if (settings.withhold) return { kind: "withheld", reason: "secret-data-columns" };
      if (sample.size === 0) return { kind: "empty", contentType: sample.contentType };
      const masked = masker.maskBody(new TextEncoder().encode(sample.body), sample.contentType, false);
      if (masked.kind === "none") return { kind: "empty", contentType: sample.contentType };
      if (masked.kind === "binary") return { kind: "text", contentType: sample.contentType, text: `Binary content, ${masked.sizeBytes} bytes.`, truncated: false };
      return { kind: "text", contentType: sample.contentType, text: plainText(masked.text), truncated: sample.size > sample.body.length };
    },
  };
}

export interface FailureRing {
  push(entry: RecentFailure): void;
  /** Newest first. */
  list(): RecentFailure[];
}

export function createFailureRing(capacity: number = LIVE_RECENT_FAILURE_LIMIT): FailureRing {
  const entries: RecentFailure[] = [];
  return {
    push(entry) {
      entries.unshift(entry);
      if (entries.length > capacity) entries.length = capacity;
    },
    list: () => entries.map((entry) => ({ ...entry })),
  };
}
