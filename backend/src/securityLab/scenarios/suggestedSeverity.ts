import type { GeneratableCategoryId, SecurityMutationKind, Severity } from "@apipilot/shared-domain";

/**
 * Suggested severity by category and mutation (specs/057 FR-056, contracts/evaluation-and-findings-rules.md
 * "Severity"). A fixed, documented table: it is a suggestion about the *impact if the expectation is violated*,
 * never evidence, and the engine never raises it from a response. A state-changing operation raises it one step
 * where the table says so, because accepting a forbidden write is worse than accepting a forbidden read.
 */

interface Entry {
  readonly read: Severity;
  readonly write: Severity;
}

const TABLE: Readonly<Record<string, Entry>> = {
  "authentication:auth.omit": { read: "high", write: "critical" },
  "authentication:auth.invalid-token": { read: "high", write: "critical" },
  "authentication:auth.malformed": { read: "medium", write: "high" },
  "authentication:auth.expired": { read: "medium", write: "high" },
  "authorization:identity.swap": { read: "high", write: "critical" },
  "broken-object-level-authorization:path-id.substitute": { read: "high", write: "critical" },
  "object-property-authorization:body.add-property": { read: "high", write: "high" },
  "input-validation:field.violate-constraint": { read: "low", write: "medium" },
  "input-validation:input.injection-probe": { read: "medium", write: "high" },
  "resource-consumption:request.repeat": { read: "medium", write: "medium" },
  "sensitive-data-exposure:none": { read: "high", write: "high" },
  "security-misconfiguration:method.probe": { read: "low", write: "low" },
  "security-misconfiguration:field.violate-constraint": { read: "medium", write: "medium" },
};

const FALLBACK: Severity = "medium";

/** `mutation` is the scenario's decisive mutation kind, or `none` for a baseline request. */
export function suggestedSeverityFor(
  categoryId: GeneratableCategoryId,
  mutation: SecurityMutationKind | "none",
  stateChanging: boolean,
): Severity {
  const entry = TABLE[`${categoryId}:${mutation}`];
  if (!entry) return FALLBACK;
  return stateChanging ? entry.write : entry.read;
}
