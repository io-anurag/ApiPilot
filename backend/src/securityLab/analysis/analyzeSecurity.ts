import type { ApiModel, ObservationClass, SecurityAnalysis, SecurityObservation } from "@apipilot/shared-domain";
import { specificationRevision } from "../../apiCoverage/specRevision";
import { hash16 } from "../canonical";
import { resolveEffectiveSecurity } from "./effectiveSecurity";
import { authSchemesRule } from "./rules/authSchemes";
import { effectiveSecurityRule } from "./rules/effectiveSecurityRules";
import { errorResponsesRule } from "./rules/errorResponses";
import { inventoryRule } from "./rules/inventory";
import { observedModelLimitsRule } from "./rules/observedModelLimits";
import { readOnlyInRequestRule } from "./rules/readOnlyInRequest";
import { sensitiveOperationRule } from "./rules/sensitiveOperation";
import { sensitivePropertyRule } from "./rules/sensitiveProperty";
import { ssrfCandidatesRule } from "./rules/ssrfCandidates";
import { buildContext, type ObservationRule } from "./rules/types";
import { configuredSet } from "./sensitivity";

/**
 * The deterministic security analysis (specs/057 FR-005 to FR-011): a pure function of the normalized model and
 * the user's configured sensitive field names. It uses no AI, no clock and no I/O, so identical input gives
 * identical observations in identical order. It reports what the specification says and does not say; it never
 * claims a runtime vulnerability.
 */

export const OBSERVATION_RULES: readonly ObservationRule[] = Object.freeze([
  authSchemesRule,
  effectiveSecurityRule,
  sensitiveOperationRule,
  sensitivePropertyRule,
  readOnlyInRequestRule,
  errorResponsesRule,
  inventoryRule,
  ssrfCandidatesRule,
  observedModelLimitsRule,
]);

export interface AnalyzeOptions {
  /** Sensitive field names the user configured. Recorded as user-provided, never as specification fact. */
  configuredSensitiveFields?: readonly string[];
}

/** Locale-independent ordering by code unit, so output never depends on the machine. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function emptyCounts(): Record<ObservationClass, number> {
  return { informational: 0, "potential-risk": 0, "requires-context": 0, "not-measurable": 0 };
}

export function analyzeSecurity(apiModel: ApiModel, options: AnalyzeOptions = {}): SecurityAnalysis {
  const effective = resolveEffectiveSecurity(apiModel).sort((a, b) => compare(a.operationKey, b.operationKey));
  const context = buildContext(apiModel, effective, configuredSet(options.configuredSensitiveFields ?? []));

  const drafts = OBSERVATION_RULES.flatMap((rule) => rule.run(context));
  const used = new Set<string>();
  const observations: SecurityObservation[] = drafts.map((draft) => {
    const base = `so-${hash16([draft.ruleId, draft.operationKey ?? "", draft.elementPointer])}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);
    return { id, ...draft };
  });
  observations.sort(
    (a, b) =>
      compare(a.operationKey ?? "", b.operationKey ?? "") ||
      compare(a.ruleId, b.ruleId) ||
      compare(a.elementPointer, b.elementPointer) ||
      compare(a.id, b.id),
  );

  const counts = emptyCounts();
  for (const observation of observations) counts[observation.classification] += 1;

  const unmeasurable: string[] = [];
  const operations = apiModel.operations;
  if (Object.keys(apiModel.securitySchemes).length === 0 && operations.every((operation) => operation.security.length === 0)) {
    unmeasurable.push("authentication scheme declarations");
  }
  if (operations.length > 0 && operations.every((operation) => operation.securitySource === undefined)) {
    unmeasurable.push("effective security requirements (not recorded in the input)");
  }

  return {
    specificationRevision: specificationRevision(apiModel),
    effective,
    observations,
    counts,
    unmeasurable,
  };
}
