import type { FindingFilterQuery, ScenarioFilterQuery } from "../../services/securityLabClient";
import type { SecurityArea } from "../../navigation/routes";

/**
 * A request to open a Security Lab list already filtered (specs/057 FR-060, SC-012): the Overview opens the scenarios or
 * the findings behind a count, and a finding opens its scenario. The page holds the intent while the area it names is
 * shown and drops it when another area is chosen, so a later visit by the tabs always starts unfiltered.
 */
export type SecurityLabIntent =
  | { readonly kind: "scenarios"; readonly filters: ScenarioFilterQuery; readonly selectScenarioId?: string }
  | { readonly kind: "findings"; readonly filters: FindingFilterQuery };

/** The area that shows the list an intent names. Findings live in the Execution and Findings area. */
export const areaForIntent = (intent: SecurityLabIntent): SecurityArea => (intent.kind === "scenarios" ? "scenarios" : "execution");
