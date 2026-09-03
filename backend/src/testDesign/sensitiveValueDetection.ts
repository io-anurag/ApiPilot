/**
 * Shared credential-detection predicates.
 *
 * Review (AP-006) redacts a detected credential for display; export (AP-007) replaces it with
 * a variable reference so the request still runs. The *replacement* differs; the *detection*
 * must not, because two definitions of "this value is a credential" is how a secret slips
 * through one path while the other blocks it (research.md).
 */

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

const API_KEY_HEADER_NAMES = new Set(["x-api-key", "api-key"]);

const SENSITIVE_FIELD_NAME_PATTERN =
  /(password|secret|token|api[-_]?key|credential|bearer)/i;
const BEARER_TOKEN_PATTERN = /^Bearer\s+\S+/i;
const API_KEY_FIELD_PATTERN = /api[-_]?key/i;
const PASSWORD_FIELD_PATTERN = /password/i;

/** The artifact variable a detected credential is expressed through (data-model.md). */
export type CredentialKind = "token" | "apiKey" | "password";

export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

export function isBearerTokenValue(value: unknown): boolean {
  return typeof value === "string" && BEARER_TOKEN_PATTERN.test(value);
}

export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME_PATTERN.test(name);
}

/** Which variable a credential-carrying header maps to, or undefined when it carries none. */
export function credentialKindForHeader(
  name: string,
  value: unknown,
): CredentialKind | undefined {
  if (API_KEY_HEADER_NAMES.has(name.toLowerCase())) return "apiKey";
  if (isSensitiveHeaderName(name) || isBearerTokenValue(value)) return "token";
  return undefined;
}

/** Which variable a credential-carrying body field maps to, or undefined when it carries none. */
export function credentialKindForField(
  name: string,
  value: unknown,
): CredentialKind | undefined {
  if (isSensitiveFieldName(name)) {
    if (API_KEY_FIELD_PATTERN.test(name)) return "apiKey";
    if (PASSWORD_FIELD_PATTERN.test(name)) return "password";
    return "token";
  }
  return isBearerTokenValue(value) ? "token" : undefined;
}