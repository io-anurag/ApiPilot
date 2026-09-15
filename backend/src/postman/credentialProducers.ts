import type { ApiOperation, CredentialProducerCandidate } from "@apipilot/shared-domain";
import type { SchemeVariablePlanEntry } from "./authMapping";

/**
 * Producer discovery for distinct security scheme credentials
 * (specs/021-multi-credential-token-provisioning FR-006).
 *
 * Identification only: this module never wires a candidate's response value into the variable
 * it names — that is a later extension to automatic chaining (FR-009), for which this module's
 * output is the target contract.
 */

/**
 * For every scheme in `plan` — the primary (first-declared-per-type) scheme included, per
 * specs/023-auto-auth-credential-chaining Clarifications 2026-09-15 (Q1/Q3), which extends this
 * discovery to the primary scheme using the identical eligibility rule, with no relaxed or
 * name-convention-based fallback — finds the sole unauthenticated operation in `operations` whose
 * path or `operationId` contains that scheme's `stem` (case-insensitive substring). Zero or
 * multiple matches for a scheme yields no candidate for it — the caller reports an
 * `unresolved-credential-producer` limitation for that scheme instead of guessing.
 */
export function findCredentialProducers(
  operations: ApiOperation[],
  plan: Map<string, SchemeVariablePlanEntry>,
): CredentialProducerCandidate[] {
  const unauthenticated = operations.filter((operation) => operation.security.length === 0);
  const candidates: CredentialProducerCandidate[] = [];

  for (const [schemeKey, entry] of plan) {
    // A `basic` scheme has no single producible credential — a login response does not "issue"
    // a username, and inventing a producer relationship for one half of a username/password pair
    // would fabricate a relationship the specification gives no evidence for (constitution I,
    // XIV). Only bearer/apiKey schemes have one obtainable credential value.
    if (entry.type === "basic") continue;

    const stem = entry.stem.toLowerCase();
    const matches = unauthenticated.filter(
      (operation) =>
        operation.path.toLowerCase().includes(stem) ||
        (operation.operationId?.toLowerCase().includes(stem) ?? false),
    );
    if (matches.length !== 1) continue;

    candidates.push({
      schemeKey,
      variableName: entry.type === "bearer" ? entry.variableNames.token : entry.variableNames.apiKey,
      producerOperationPath: matches[0].path,
      producerOperationMethod: matches[0].method,
    });
  }

  return candidates;
}
