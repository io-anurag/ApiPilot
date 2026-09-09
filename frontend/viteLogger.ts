/**
 * Mirrors backend/src/logger.ts's file sink for the frontend's Node-side tooling: Vite has no
 * long-running server process of its own to instrument, so this wraps Vite's CLI logger and
 * also appends every dev-server/build message to `logs/frontend.log` (relative to cwd),
 * truncated on each `vite`/`vite build` invocation so failures survive after the console
 * scrolls away without letting old runs pile up.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLogger, type Logger, type LogLevel } from "vite";

const LOG_FILE_PATH = path.resolve(process.cwd(), "logs", "frontend.log");
// Skip the file sink under Vitest (which also loads this config) so test runs don't leave log files behind.
let fileLoggingEnabled = !process.env.VITEST;

function ensureLogFile(): void {
  try {
    mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });
    writeFileSync(LOG_FILE_PATH, "");
  } catch {
    // Best-effort: if the log directory can't be created/truncated, fall back to console-only.
    fileLoggingEnabled = false;
  }
}

function append(level: "info" | "warn" | "error", msg: string): void {
  if (!fileLoggingEnabled) return;
  try {
    // eslint-disable-next-line no-control-regex -- strips Vite's ANSI color codes for a plain-text log file.
    const plainMsg = msg.replace(/\x1b\[[0-9;]*m/g, "");
    appendFileSync(LOG_FILE_PATH, `${new Date().toISOString()} [${level}] ${plainMsg}\n`);
  } catch {
    fileLoggingEnabled = false;
  }
}

/** Vite `customLogger`: behaves exactly like Vite's default logger, plus the file sink above. */
export function createFileLogger(logLevel: LogLevel = "info"): Logger {
  if (fileLoggingEnabled) ensureLogFile();
  const base = createLogger(logLevel);

  return {
    ...base,
    info(msg, options) {
      append("info", msg);
      base.info(msg, options);
    },
    warn(msg, options) {
      append("warn", msg);
      base.warn(msg, options);
    },
    warnOnce(msg, options) {
      append("warn", msg);
      base.warnOnce(msg, options);
    },
    error(msg, options) {
      append("error", msg);
      base.error(msg, options);
    },
  };
}
