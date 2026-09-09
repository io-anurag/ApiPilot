/**
 * Structured, non-sensitive logging (constitution XX — Observability Without Sensitive
 * Logging). Every log line is one JSON object on stdout/stderr; callers pass only
 * identifiers, durations, stage names, and result/error categories — never spec content,
 * request/response bodies, AI prompts/responses, or credentials. This generalizes the
 * convention `ai/localProvider.ts` originally used only for AI events so every backend
 * module can log consistently through one chokepoint.
 *
 * Outside tests, every line is also appended to `logs/backend.log` (relative to cwd) so
 * failures survive after the console scrolls away. The file is truncated once per process,
 * on first use, so each server run starts from a clean log.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warn" | "error";

/**
 * Allowed log field values: request ID, operation ID, processing stage, duration, model
 * identifier, error category, validation result, and similar non-sensitive identifiers —
 * never raw YAML/JSON payloads, prompts, responses, or credentials (constitution XX).
 */
export interface LogFields {
  readonly [key: string]: string | number | boolean | undefined;
}

const LOG_FILE_PATH = path.resolve(process.cwd(), "logs", "backend.log");
// Vitest sets NODE_ENV=test; skip the file sink there so test runs don't leave log files behind.
let fileLoggingEnabled = process.env.NODE_ENV !== "test";
let logFileReady = false;

/** Creates (and truncates) `logs/backend.log` on first use so each process run starts clean. */
function ensureLogFile(): void {
  if (logFileReady) return;
  logFileReady = true;
  try {
    mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });
    writeFileSync(LOG_FILE_PATH, "");
  } catch {
    // Best-effort: if the log directory can't be created/truncated, fall back to console-only.
    fileLoggingEnabled = false;
  }
}

function emit(
  level: LogLevel,
  component: string,
  event: string,
  fields: LogFields,
): void {
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

  if (fileLoggingEnabled) {
    ensureLogFile();
    if (fileLoggingEnabled) {
      try {
        appendFileSync(LOG_FILE_PATH, line + "\n");
      } catch {
        fileLoggingEnabled = false;
      }
    }
  }
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
