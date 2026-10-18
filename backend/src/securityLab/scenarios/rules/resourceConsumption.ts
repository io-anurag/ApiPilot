import { operationKeyOf } from "../../analysis/effectiveSecurity";
import { ABSOLUTE_MAX_REPEAT, REPEAT_MARGIN_RATIO, REPEAT_MIN_COUNT } from "../../config";
import { ROLE_ANY, RATE_LIMIT_THRESHOLD_PARAMETER, identityPrerequisite, thresholdPrerequisite } from "../prerequisites";
import { productRuleStatement } from "../productRules";
import { suggestedSeverityFor } from "../suggestedSeverity";
import {
  NO_OUTPUT,
  documentedCodes,
  makeContent,
  primaryScheme,
  requirementOf,
  type GenerationContext,
  type RuleOutput,
  type ScenarioRule,
} from "./support";

/** Safe methods only: repeating a write would repeat a state change, so V1 does not generate it. */
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** The threshold the profile states for this operation (or for every operation), as a positive integer. */
function configuredThreshold(context: GenerationContext, operationKey: string): number | undefined {
  const entry = context.profile?.testData.find(
    (candidate) => candidate.parameter === RATE_LIMIT_THRESHOLD_PARAMETER && (candidate.operationKey === undefined || candidate.operationKey === operationKey),
  );
  const value = entry ? Number(entry.value) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Resource consumption and rate limiting: a bounded number of repeated requests against a threshold (specs/057
 * FR-026). The scenario exists only where the specification documents a 429 response for a safe operation. The count
 * is the threshold you configure plus a stated margin, capped by the repeat ceiling, and **never unbounded**. If the
 * ceiling is below the threshold the scenario says so and can only show that a limit engages, not where. Without a
 * configured threshold the scenario is incomplete (a prerequisite) and not executable.
 */
export const resourceConsumptionRule: ScenarioRule = {
  id: "resource-consumption",
  categoryId: "resource-consumption",
  run(context, operation): RuleOutput {
    if (!SAFE_METHODS.has(operation.method.toUpperCase())) return NO_OUTPUT;
    const documented = documentedCodes(operation, [429]);
    if (documented.length === 0) return NO_OUTPUT;

    const key = operationKeyOf(operation);
    const ceiling = Math.min(context.limits.ceilings.maxRepeat, ABSOLUTE_MAX_REPEAT);
    const threshold = configuredThreshold(context, key);
    const wanted = threshold === undefined ? REPEAT_MIN_COUNT : Math.ceil(threshold * (1 + REPEAT_MARGIN_RATIO)) + 1;
    const count = Math.max(2, Math.min(wanted, ceiling));

    const limitations: string[] = [];
    if (threshold === undefined) {
      limitations.push(`No threshold is configured, so the repetition count (${count}) is only a minimum. Configure "${RATE_LIMIT_THRESHOLD_PARAMETER}" in the profile and regenerate so the count reflects the real limit.`);
    } else if (wanted > ceiling) {
      limitations.push(`The configured threshold (${threshold}) plus the margin needs ${wanted} requests, above the repeat ceiling (${ceiling}). The scenario sends ${count}, so it can show that a limit engages but not where.`);
    }

    const { requiresCredentials, schemes } = requirementOf(context, operation);
    const scheme = requiresCredentials ? primaryScheme(context, schemes) : undefined;

    return {
      contents: [
        makeContent({
          context,
          operation,
          categoryId: "resource-consumption",
          ruleId: "resource-consumption.repeat",
          title: `${key} repeated ${count} times`,
          objective: "Check that repeated requests engage the rate limit the specification describes.",
          rationale: `The specification documents a 429 response for this operation, which means the service limits request rates. Sending ${count} requests in a row shows whether the limit engages.`,
          impact: "Without a working limit, one client could exhaust the service or run up its costs.",
          mutations: [{ kind: "request.repeat", count }],
          expected: {
            kind: "limited",
            statement: `${productRuleStatement("SL-LIMIT-ENGAGED")} The specification documents 429 for this operation.`,
            basis: "documented",
            documentedStatusCodes: documented,
            citation: `/operations/${key}/responses`,
          },
          conditions: [{ kind: "repeat.limit-engaged", withinRequests: count }],
          severity: suggestedSeverityFor("resource-consumption", "request.repeat", false),
          plannedRequestCount: count,
          prerequisites: [thresholdPrerequisite(key), ...(scheme ? [identityPrerequisite(ROLE_ANY, scheme)] : [])],
          requiredIdentities: scheme ? [{ role: ROLE_ANY, label: "An identity allowed to call the operation" }] : [],
          limitations,
          manualInputs: [`The number of requests the service allows per window, as test data named "${RATE_LIMIT_THRESHOLD_PARAMETER}".`],
          specElementPointer: `/operations/${key}/responses`,
        }),
      ],
      notes: [],
    };
  },
};
