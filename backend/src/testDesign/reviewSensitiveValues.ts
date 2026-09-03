import type { GeneratedRequest } from "@apipilot/shared-domain";
import {
  isBearerTokenValue,
  isSensitiveFieldName,
  isSensitiveHeaderName,
} from "./sensitiveValueDetection";

const REDACTED = "[redacted]";

function redactHeaderValue(name: string, value: unknown): unknown {
  if (isSensitiveHeaderName(name)) return REDACTED;
  if (isBearerTokenValue(value)) return REDACTED;
  return value;
}

function redactBodyValue(key: string, value: unknown): unknown {
  if (isSensitiveFieldName(key)) return REDACTED;
  if (isBearerTokenValue(value)) return REDACTED;
  return redactUnknown(value);
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactBodyValue(key, nested),
      ]),
    );
  }
  return value;
}

/**
 * Redacts credential-like headers, bearer tokens, and sensitive request-body fields while
 * preserving the rest of the test intent, for display and diagnostic boundaries (FR-018).
 * Detection is shared with the export substituter (`sensitiveValueDetection.ts`); only the
 * replacement differs.
 */
export function redactSensitiveRequestValues(
  request: GeneratedRequest,
): GeneratedRequest {
  return {
    pathParameters: request.pathParameters,
    queryParameters: request.queryParameters,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        redactHeaderValue(name, value),
      ]),
    ),
    body: request.body === undefined ? undefined : redactUnknown(request.body),
  };
}