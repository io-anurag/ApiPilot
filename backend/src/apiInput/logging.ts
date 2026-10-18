import type { InputFormat } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * The only way the input layer logs (constitution XX, specs/056 R26). The field type has no free-text
 * member: formats and categories are short identifiers, everything else is a number. A string that is
 * not a short identifier is replaced, so a URL, header, body, credential or file-name fragment can
 * never reach a log line through this helper.
 */

const logger = createLogger("apiInput");

export type InputLogEvent = "input_detected" | "input_rejected" | "har_analyzed" | "definition_validated";

export interface InputLogFields {
  format?: InputFormat | "unknown";
  durationMs?: number;
  total?: number;
  imported?: number;
  excluded?: number;
  malformed?: number;
  operations?: number;
  /** A short error class name or code, never a message. */
  errorCategory?: string;
  /** The name of the limit that applied. */
  limit?: string;
  problemCount?: number;
}

const SHORT_IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

function sanitize(fields: InputLogFields): Record<string, string | number> {
  const safe: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "number") {
      safe[key] = Number.isFinite(value) ? value : -1;
    } else {
      safe[key] = SHORT_IDENTIFIER.test(value) ? value : "invalid";
    }
  }
  return safe;
}

export function logInputEvent(event: InputLogEvent, fields: InputLogFields = {}): void {
  const safe = sanitize(fields);
  if (event === "input_rejected") logger.error(event, safe);
  else logger.info(event, safe);
}
