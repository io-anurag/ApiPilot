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

/** True for a known credential-carrying HTTP header name (authorization, cookie, api-key, etc.), case-insensitive. */
export function isSensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

/** True when `value` is a string of the form `Bearer <token>`. */
export function isBearerTokenValue(value: unknown): boolean {
  return typeof value === "string" && BEARER_TOKEN_PATTERN.test(value);
}

/** True when `name` matches a credential-suggestive pattern (password/secret/token/api-key/credential/bearer). */
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

/**
 * The placeholder the input layer writes in place of a credential value it removed from captured
 * traffic (specs/056 research R18): `[redacted:<kind>]`. It is defined here, beside the other
 * credential predicates, because it is a contract between two modules: redaction writes it, and the
 * Postman exporter recognizes it so the value becomes a secret variable reference, whatever the
 * name of the field that carried it (research R24). One definition, so the two cannot drift.
 */
export type RedactionKind = "token" | "apiKey" | "password" | "cookie" | "session";

const REDACTION_PLACEHOLDER_PATTERN = /^\[redacted:(token|apiKey|password|cookie|session)\]$/;

/** The text that replaces a removed credential of `kind`. */
export function formatRedactionPlaceholder(kind: RedactionKind): string {
  return `[redacted:${kind}]`;
}

/** True when `text` contains any redaction placeholder (used to refuse an artifact that would send one). */
export function containsRedactionPlaceholder(text: string): boolean {
  return text.includes("[redacted:");
}

/**
 * Which export variable a redaction placeholder maps to, or undefined when `value` is anything other
 * than exactly a placeholder. `cookie` and `session` credentials are supplied through the `token`
 * variable, as the `Cookie` header already is.
 */
export function redactionPlaceholderKind(value: unknown): CredentialKind | undefined {
  if (typeof value !== "string") return undefined;
  const match = REDACTION_PLACEHOLDER_PATTERN.exec(value);
  if (!match) return undefined;
  const kind = match[1] as RedactionKind;
  return kind === "apiKey" || kind === "password" ? kind : "token";
}