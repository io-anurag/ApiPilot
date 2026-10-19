import type { InjectionProbeId } from "@apipilot/shared-domain";

/**
 * The fixed, benign injection probe set (specs/057 research R6, FR-027). A scenario names a probe by id; the
 * string it stands for lives only here, so scenario content can never choose what is sent. Every probe is
 * harmless text: it can provoke an error message that reveals internals, and cannot change data or run code.
 */
export const INJECTION_PROBES: Readonly<Record<InjectionProbeId, string>> = Object.freeze({
  "sql-quote": "'",
  "sql-comment": "x'--",
  "xss-angle": "<sl-probe>",
  "path-traversal-dots": "../",
  "template-braces": "{{7*7}}",
  "null-byte": "%00",
});

/** What replaces a credential position that holds a placeholder: a stand-in that is plainly not a secret. */
export const INVALID_CREDENTIAL_VALUE = "sl-invalid-credential";

/** A value that breaks the scheme's expected form, for `auth.malformed`. Valid header characters only. */
export const MALFORMED_CREDENTIAL_VALUE = "%%malformed%%";

/** What `body.add-property` sends for each value kind. Fixed, non-secret. */
export const PROPERTY_VALUES = Object.freeze({
  string: "sl-probe",
  number: 1,
  boolean: true,
  "protected-example": "sl-protected-example",
} as const);
