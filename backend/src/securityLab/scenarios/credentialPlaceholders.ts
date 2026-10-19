import { classifyValue } from "../../apiInput/redaction";
import { formatRedactionPlaceholder, isSensitiveFieldName } from "../../testDesign/sensitiveValueDetection";

/**
 * Credential-shaped content in a scenario (specs/057 FR-048, FR-051, contracts/security-scenario-contract.md
 * "Safety"). Retained scenario rows survive the session, so they must never become a second secret store. A
 * generated base request therefore holds a **placeholder** wherever the specification names a credential field,
 * and the validator rejects a real-looking credential. At send time the request builder puts a fixed, non-secret
 * dummy where a placeholder stands, so the request still has a value of the right type.
 */

/** The placeholder the exporter and the request builder both recognise. */
export const CREDENTIAL_PLACEHOLDER = formatRedactionPlaceholder("password");

/** What the request builder sends where a placeholder stands: not a secret, and obviously a stand-in. */
export const PLACEHOLDER_DUMMY_VALUE = "sl-placeholder-value";

const PLACEHOLDER_PATTERN = /^\[redacted:[a-z]+\]$/;

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

/** A field name that carries a credential, by the product's one shared definition. */
export function isCredentialFieldName(name: string): boolean {
  return isSensitiveFieldName(name);
}

/** A string that is a credential by its shape alone: a JWT, a bearer or basic header value, a cloud access key. */
export function isCredentialValue(value: string): boolean {
  return classifyValue(value) !== undefined;
}
