import { Router } from "express";
import { createLogger, type LogFields, type LogLevel } from "../logger";

const logger = createLogger("api.clientLogs");
const frontendLogger = createLogger("frontend-client");

/** Independent, dedicated size limit for this route only (FR-013) — see app.ts for how it's mounted. */
export const CLIENT_LOGS_BODY_LIMIT = "8kb";

export const clientLogsRouter = Router();

const VALID_LEVELS: readonly LogLevel[] = ["info", "warn", "error"];

/**
 * Field names that must never be persisted regardless of value (FR-004/SC-008) — applied here
 * independently of the frontend logger's own identical filter, since this endpoint must not
 * assume every caller is this feature's own frontend logger (research.md Decision 7).
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

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Drops any field that isn't a primitive value or whose name is denylisted (FR-004, FR-007). */
function sanitizeFields(fields: unknown): LogFields {
  const sanitized: Record<string, string | number | boolean> = {};
  if (typeof fields !== "object" || fields === null) return sanitized;
  for (const [name, value] of Object.entries(fields as Record<string, unknown>)) {
    if (isDenylistedFieldName(name)) continue;
    if (!isPrimitive(value)) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

interface ClientLogEntryBody {
  level: unknown;
  component: unknown;
  event: unknown;
  timestamp: unknown;
  fields?: unknown;
}

function validationError(body: ClientLogEntryBody): string | undefined {
  if (typeof body.level !== "string" || !VALID_LEVELS.includes(body.level as LogLevel)) {
    return `"level" must be one of ${VALID_LEVELS.map((level) => `"${level}"`).join(", ")}.`;
  }
  if (typeof body.component !== "string" || body.component.length === 0) {
    return `"component" must be a non-empty string.`;
  }
  if (typeof body.event !== "string" || body.event.length === 0) {
    return `"event" must be a non-empty string.`;
  }
  if (typeof body.timestamp !== "string") {
    return `"timestamp" must be a string.`;
  }
  return undefined;
}

clientLogsRouter
  .route("/client-logs")
  .post((req, res) => {
    const startedAt = Date.now();
    logger.info("request_received", { method: req.method, path: req.path });
    const body = (req.body ?? {}) as ClientLogEntryBody;
    const problem = validationError(body);
    if (problem) {
      logger.error("request_failed", {
        method: req.method,
        path: req.path,
        statusCode: 400,
        errorCategory: "invalid_client_log_entry",
        durationMs: Date.now() - startedAt,
      });
      res.status(400).json({ error: "invalid_client_log_entry", message: problem });
      return;
    }

    const level = body.level as LogLevel;
    const component = body.component as string;
    const event = body.event as string;
    const timestamp = body.timestamp as string;
    const fields = sanitizeFields(body.fields);

    frontendLogger[level](event, { ...fields, frontendComponent: component, clientTimestamp: timestamp });

    res.status(202).end();
    logger.info("request_succeeded", {
      method: req.method,
      path: req.path,
      statusCode: 202,
      durationMs: Date.now() - startedAt,
    });
  })
  .all((_req, res) => {
    res.status(405).json({ error: "method_not_allowed" });
  });
