import type { GeneratedRequest } from "@apipilot/shared-domain";

const REDACTED = "[redacted]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

const SENSITIVE_FIELD_NAME_PATTERN =
  /(password|secret|token|api[-_]?key|credential|bearer)/i;
const BEARER_TOKEN_PATTERN = /^Bearer\s+\S+/i;

function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

function redactHeaderValue(name: string, value: unknown): unknown {
  if (isSensitiveHeaderName(name)) return REDACTED;
  if (typeof value === "string" && BEARER_TOKEN_PATTERN.test(value)) return REDACTED;
  return value;
}

function redactBodyValue(key: string, value: unknown): unknown {
  if (SENSITIVE_FIELD_NAME_PATTERN.test(key)) return REDACTED;
  if (typeof value === "string" && BEARER_TOKEN_PATTERN.test(value)) return REDACTED;
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
