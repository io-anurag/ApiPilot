/**
 * Structured, non-sensitive logging (constitution XX — Observability Without Sensitive
 * Logging). Every log line is one JSON object on stdout/stderr; callers pass only
 * identifiers, durations, stage names, and result/error categories — never spec content,
 * request/response bodies, AI prompts/responses, or credentials. This generalizes the
 * convention `ai/localProvider.ts` originally used only for AI events so every backend
 * module can log consistently through one chokepoint.
 */

export type LogLevel = "info" | "warn" | "error";

/**
 * Allowed log field values: request ID, operation ID, processing stage, duration, model
 * identifier, error category, validation result, and similar non-sensitive identifiers —
 * never raw YAML/JSON payloads, prompts, responses, or credentials (constitution XX).
 */
export interface LogFields {
  readonly [key: string]: string | number | boolean | undefined;
}

function emit(level: LogLevel, component: string, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component,
    event,
    ...fields,
  });
  /* eslint-disable no-console */
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  /* eslint-enable no-console */
}

/** One component-scoped logger, returned by `createLogger`. */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Creates a logger tagged with a fixed `component` name (e.g. a module or route path). */
export function createLogger(component: string): Logger {
  return {
    info: (event, fields = {}) => emit("info", component, event, fields),
    warn: (event, fields = {}) => emit("warn", component, event, fields),
    error: (event, fields = {}) => emit("error", component, event, fields),
  };
}
