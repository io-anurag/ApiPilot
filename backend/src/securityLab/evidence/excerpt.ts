import { REDACTED, redactHeaders, scanOutput } from "../../failureAnalysis/redaction";

/**
 * Which response headers Security Lab keeps, and how a bounded value is made (specs/057 research R14, data-model
 * section 6). The set is fixed: the headers the product's checks and findings actually discuss. Anything else a
 * server sends, a `Set-Cookie` above all, is never stored, so an unexpected secret in a header cannot be retained.
 */
export const SELECTED_RESPONSE_HEADERS: readonly string[] = [
  "content-type",
  "www-authenticate",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "content-security-policy",
  "cache-control",
  "server",
  "access-control-allow-origin",
  "allow",
];

const MAX_HEADER_VALUE = 300;

/** The kept response headers with sensitive values redacted and every known credential masked, each value bounded. */
export function selectResponseHeaders(headers: Readonly<Record<string, string>>, secrets: readonly string[]): Record<string, string> {
  const kept = SELECTED_RESPONSE_HEADERS.filter((name) => name in headers).map((name) => ({ key: name, value: headers[name] }));
  const redacted = redactHeaders(kept).value;
  return Object.fromEntries(
    redacted.map(({ key, value }) => {
      const masked = value === REDACTED ? value : scanOutput(value, secrets);
      return [key, masked.length > MAX_HEADER_VALUE ? `${masked.slice(0, MAX_HEADER_VALUE)}…` : masked];
    }),
  );
}
