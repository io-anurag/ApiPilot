/**
 * Structured, non-sensitive frontend logging (constitution XX — Observability Without Sensitive
 * Logging, extended to the browser). Every call emits one structured object to the browser
 * console; callers pass only identifiers, categories, and similar primitive context — never
 * secrets, full specifications, or AI prompts/responses (FR-004).
 */

export type LogLevel = "info" | "warn" | "error";

/** The primitive value shapes a sanitized log field may hold (FR-003). */
export type PrimitiveFieldValue = string | number | boolean;

/** Allowed log field values: only primitives ever reach a log entry (FR-003). */
export interface LogFields {
  readonly [key: string]: PrimitiveFieldValue | undefined;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface CreateLoggerOptions {
  /** Overridable clock so tests can assert an exact timestamp (FR-011). Defaults to `Date`. */
  now?: () => Date;
}

/**
 * Field names that must never appear in a log entry regardless of their value's type or content
 * (FR-004/SC-008) — a caller passing a variable literally named after a credential (e.g. `{
 * token }`) is the concrete, mechanically-detectable risk this closes. Matched case-insensitively
 * as a substring, so `Authorization`, `userPassword`, and `apiKeyValue` are all caught.
 */
const DENYLISTED_FIELD_NAME_TERMS = [
  "token",
  "apikey",
  "api_key",
  "password",
  "secret",
  "authorization",
  "credential",
  "cookie",
];

function isDenylistedFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return DENYLISTED_FIELD_NAME_TERMS.some((term) => lower.includes(term));
}

function isPrimitive(value: unknown): value is PrimitiveFieldValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Drops any field that isn't a primitive value or whose name is denylisted (FR-003, FR-004). */
function sanitizeFields(fields: LogFields | undefined): Record<string, PrimitiveFieldValue> {
  const sanitized: Record<string, PrimitiveFieldValue> = {};
  if (!fields) return sanitized;
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (isDenylistedFieldName(name)) continue;
    if (!isPrimitive(value)) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

const CLIENT_LOGS_ENDPOINT = "/api/client-logs";

/**
 * Forwards one `warn`/`error` entry to the backend, best-effort (FR-005, FR-008, FR-012). Never
 * awaited by the caller and never throws back to it: a network error, a non-2xx response, or
 * `fetch` being unavailable all degrade to a single local console notice, not a retry and not an
 * exception.
 */
function forward(entry: {
  level: LogLevel;
  component: string;
  event: string;
  timestamp: string;
  fields: Record<string, PrimitiveFieldValue>;
}): void {
  try {
    fetch(CLIENT_LOGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    })
      .then((response) => {
        if (!response.ok) {
          // eslint-disable-next-line no-console
          console.warn("[logger] backend rejected forwarded log entry", response.status);
        }
      })
      .catch(() => {
        // eslint-disable-next-line no-console
        console.warn("[logger] failed to forward log entry to backend");
      });
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[logger] failed to forward log entry to backend");
  }
}

/**
 * Creates a logger tagged with a fixed `component` name. Each call emits one structured object
 * (not a free-form string, FR-002) to the console method matching its level; `warn`/`error` calls
 * are additionally forwarded to the backend, best-effort (FR-005).
 */
export function createLogger(component: string, options: CreateLoggerOptions = {}): Logger {
  const now = options.now ?? (() => new Date());

  function emit(level: LogLevel, event: string, fields?: LogFields): void {
    const timestamp = now().toISOString();
    const sanitized = sanitizeFields(fields);
    const consoleEntry = { timestamp, level, component, event, ...sanitized };
    /* eslint-disable no-console */
    if (level === "error") console.error(consoleEntry);
    else if (level === "warn") console.warn(consoleEntry);
    else console.log(consoleEntry);
    /* eslint-enable no-console */

    if (level === "warn" || level === "error") {
      forward({ level, component, event, timestamp, fields: sanitized });
    }
  }

  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
