import type { SecurityMutation, SecurityScenarioContent } from "@apipilot/shared-domain";
import { canonicalJson, hash16, hash64 } from "../canonical";

/**
 * Scenario identity (specs/057 contracts/security-scenario-contract.md "Stable identifiers and hashes").
 *
 * - The **id** is derived from what the scenario *is*: the operation, the category and the controlled mutations.
 *   It is stable across specification revisions, so a regenerated scenario for a changed specification is a new
 *   *version* of the same scenario, not a new scenario. It contains no random value, no time and no revision.
 * - The **content hash** covers the *material* fields only. Approval binds to this hash, so an edit to anything
 *   material can never inherit an earlier approval (FR-030), while an edit to a title or a note keeps it.
 * - The **dedupe key** includes the mutations and the expected-behavior kind, unlike the existing test designer's
 *   key, which ignores category and rule and would collapse distinct security probes.
 */

/** The fields whose change makes a scenario a different test, and so needs a new approval. */
export const MATERIAL_FIELDS = [
  "operationKey",
  "categoryId",
  "baseRequest",
  "mutations",
  "expected",
  "conditions",
  "plannedRequestCount",
  "destructive.flag",
  "requiredIdentities",
] as const;

export function scenarioIdOf(parts: {
  operationKey: string;
  categoryId: string;
  mutations: readonly SecurityMutation[];
}): string {
  return `ss-${hash16([parts.operationKey, parts.categoryId, parts.mutations])}`;
}

/** The material fields of a scenario in one structure, the exact input of `contentHashOf`. */
export function materialFieldsOf(content: SecurityScenarioContent): Record<string, unknown> {
  return {
    operationKey: content.operationKey,
    categoryId: content.categoryId,
    baseRequest: content.baseRequest,
    mutations: content.mutations,
    expected: content.expected,
    conditions: content.conditions,
    plannedRequestCount: content.plannedRequestCount,
    destructiveFlag: content.destructive.flag,
    requiredIdentities: content.requiredIdentities,
  };
}

/** SHA-256 (64 hex characters) of the canonical material fields. */
export function contentHashOf(content: SecurityScenarioContent): string {
  return hash64(materialFieldsOf(content));
}

/** True when `after` differs from `before` in any material field. */
export function isMaterialChange(before: SecurityScenarioContent, after: SecurityScenarioContent): boolean {
  return contentHashOf(before) !== contentHashOf(after);
}

/** Two scenarios with the same key are the same test reached by different rules, and are merged (FR-024). */
export function dedupeKeyOf(content: SecurityScenarioContent): string {
  return canonicalJson([content.operationKey, content.categoryId, content.mutations, content.expected.kind, content.conditions]);
}
