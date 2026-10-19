import type { SecurityScenarioContent } from "@apipilot/shared-domain";

/**
 * Remediation guidance for a finding (specs/057 contracts/evaluation-and-findings-rules.md "Finding content", FR-055).
 * It is **static text**, one entry per category and mutation, versioned with the code and written by people: no model
 * produces it, so a finding's advice is the same on every run and can be reviewed like any other documentation.
 * Where no entry names the exact mutation, the category's general entry applies. An id is stored with a finding so
 * the text can be traced to the version that gave it.
 */

export const REMEDIATION_TEXT_VERSION = 1;

export interface Remediation {
  readonly id: string;
  readonly text: string;
}

const GENERIC: Readonly<Record<string, string>> = {
  authentication: "Require a valid credential on every operation that handles non-public data, and verify it on the server for each request. Reject a missing, invalid, malformed or expired credential with 401 and a WWW-Authenticate header, without revealing which part was wrong.",
  authorization: "Check on the server, for every request, that the caller's role or scope permits the operation. Deny by default, and never rely on the client hiding an action. Return 403 for an authenticated caller who lacks permission.",
  "broken-object-level-authorization": "Authorize access to each object, not just to the endpoint: before reading, changing or deleting a resource, check that the authenticated identity owns it or has been granted access. Do not trust an identifier supplied by the client, and prefer unguessable identifiers as defence in depth.",
  "object-property-authorization": "Accept only the properties a caller is allowed to set. Use an explicit allow-list for each request body, ignore or reject properties the specification marks read-only, and never bind client input directly to an internal model.",
  "input-validation": "Validate every input on the server against the declared schema (type, format, range, length, enumeration and required fields) before using it, and reject what does not conform with a clear 4xx response. Use parameterized queries and encode output, so a bad value cannot reach an interpreter.",
  "resource-consumption": "Enforce rate limits and quotas on the server for each client and operation, answer excess requests with 429 and a Retry-After header, and bound request size, pagination and concurrency, so one caller cannot exhaust the service.",
  "sensitive-data-exposure": "Return only the fields a caller needs. Remove credentials, tokens, internal identifiers and other protected fields from responses, or mask them, and review response schemas for properties that should never leave the service.",
  "security-misconfiguration": "Harden the service configuration: send the documented security headers, restrict HTTP methods to those the API defines, and return generic error responses with no stack traces, file paths, framework versions or query text.",
  "sensitive-business-flows": "Add controls to flows that can be abused at scale, such as limits per account, step-up verification, and monitoring for unusual use, and enforce the flow's rules on the server rather than in the client.",
};

const BY_MUTATION: Readonly<Record<string, string>> = {
  "authentication:auth.omit": "The operation accepted a request with no credential. Enforce authentication before any processing, and make sure the check cannot be skipped by a route, a method or a header. If the operation is meant to be public, say so in the specification with an explicit empty security requirement.",
  "authentication:auth.invalid-token": "The operation accepted a credential that is not valid. Verify the credential's signature, issuer, audience and expiry (or look it up) on every request, and reject anything that fails with 401.",
  "authentication:auth.malformed": "The operation accepted a malformed credential. Parse and validate the Authorization header or key strictly, and answer 401 for a value that does not follow the scheme, rather than treating it as absent or ignoring it.",
  "authentication:auth.expired": "The operation accepted an expired credential. Check the expiry time on the server for every request, allow only a small, documented clock skew, and require re-authentication once it has passed.",
  "authorization:identity.swap": "A caller without the required role or scope was allowed to use the operation. Enforce the documented role or scope check in the service for every request, and deny by default when the caller's permissions are unknown.",
  "broken-object-level-authorization:path-id.substitute": "One identity could reach a resource that another identity owns. Check ownership or an explicit grant for the object named in the request before returning or changing it, and answer 403 or 404 for a caller who has neither.",
  "object-property-authorization:body.add-property": "A property the specification marks read-only was accepted or echoed. Ignore or reject properties that clients may not set, using an explicit allow-list of writable fields, and verify that the stored value did not change.",
  "input-validation:field.violate-constraint": "A value that breaks a declared constraint was accepted. Validate the request against the schema on the server before processing, and answer 400 or 422 with a message that names the field and the rule it broke.",
  "input-validation:input.injection-probe": "A benign probe value produced an error that reveals internals. Use parameterized queries and safe templates, validate and encode the input, and return a generic error without database text, stack traces or paths.",
  "resource-consumption:request.repeat": "No rate limit engaged during repeated requests. Add a per-client limit to the operation as the specification describes, answer excess requests with 429 and a Retry-After header, and verify that the limit applies across all of the service's instances.",
  "security-misconfiguration:method.probe": "An HTTP method the specification does not document was accepted. Restrict each path to its documented methods, answer 405 with an Allow header for the rest, and disable TRACE.",
};

/** The remediation for a scenario: the entry for its category and first mutation, else the category's general one. */
export function remediationFor(content: SecurityScenarioContent): Remediation {
  for (const mutation of content.mutations) {
    const key = `${content.categoryId}:${mutation.kind}`;
    if (key in BY_MUTATION) return { id: `rem.${REMEDIATION_TEXT_VERSION}.${key}`, text: BY_MUTATION[key] };
  }
  const general = GENERIC[content.categoryId] ?? "Review the operation against the behavior the specification documents, and correct the difference the evidence shows.";
  return { id: `rem.${REMEDIATION_TEXT_VERSION}.${content.categoryId}`, text: general };
}
