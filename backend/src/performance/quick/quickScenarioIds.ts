import type { TestScenario } from "@apipilot/shared-domain";
import { canonicalJson, sha256Hex } from "../plan/identifiers";

/**
 * Content-derived scenario ids for the quick performance test (AP-032,
 * specs/032-quick-performance-test research Q4, data-model "Quick scenario identifiers").
 *
 * `buildScenario` gives every scenario a random UUID, and AP-029 chooses among an operation's
 * positive scenarios by the lowest id, so two uploads of the same specification would choose
 * different scenarios and render different scripts (FR-007, SC-004). The quick path therefore
 * re-identifies its generated scenarios as `q<rank>-<hex>`:
 * - `rank` is the generating rule's position in the positive rule order, so the lowest id is the
 *   full happy path whenever it exists;
 * - `hex` is the first 24 hex characters of a SHA-256 over the scenario's operation, rule, request
 *   and assertions, so the id depends on content only.
 *
 * The guided workflow's ids are unchanged: they are persisted in review state and keyed on by
 * later stages.
 */

/** Must match the `rule` each of `POSITIVE_RULES` (testDesign/generateTestModel.ts) records, in the same order. */
const POSITIVE_RULE_NAMES: readonly string[] = ["positive-scenario", "enum-positive-variant", "minimal-positive-scenario"];

export function withQuickScenarioIds(scenarios: readonly TestScenario[]): TestScenario[] {
  const seen = new Set<string>();
  return scenarios.map((scenario) => {
    const rule = scenario.provenance.source === "RULE" ? scenario.provenance.rule : undefined;
    const rank = rule === undefined ? -1 : POSITIVE_RULE_NAMES.indexOf(rule);
    if (rank < 0) throw new Error(`The quick path accepts positive rule-generated scenarios only, not '${rule ?? scenario.provenance.source}'.`);
    const operationKey = `${scenario.operationMethod.toUpperCase()} ${scenario.operationPath}`;
    const hex = sha256Hex(canonicalJson({ operationKey, rule, request: scenario.request, assertions: scenario.assertions })).slice(0, 24);
    const id = `q${String(rank).padStart(2, "0")}-${hex}`;
    if (seen.has(id)) throw new Error(`Two quick scenarios share the id ${id}.`);
    seen.add(id);
    return { ...scenario, id };
  });
}
