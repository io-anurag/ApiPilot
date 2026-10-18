import type {
  ApiModel,
  GeneratableCategoryId,
  SecurityProfile,
  SecurityScenarioContent,
} from "@apipilot/shared-domain";
import { GENERATABLE_CATEGORY_IDS } from "@apipilot/shared-domain";
import { operationKeyOf, resolveEffectiveSecurity } from "../analysis/effectiveSecurity";
import { configuredSet } from "../analysis/sensitivity";
import type { SecurityLabLimits } from "../config";
import { applyCaps, type CapOmission } from "./caps";
import { dedupeKeyOf, scenarioIdOf } from "./scenarioIdentity";
import { authenticationRule } from "./rules/authentication";
import { authorizationRule } from "./rules/authorization";
import { bolaRule } from "./rules/bola";
import { inputValidationRule } from "./rules/inputValidation";
import { misconfigurationRule } from "./rules/misconfiguration";
import { objectPropertyRule } from "./rules/objectProperty";
import { resourceConsumptionRule } from "./rules/resourceConsumption";
import { sensitiveDataExposureRule } from "./rules/sensitiveDataExposure";
import type { GenerationContext, GenerationNote, ScenarioRule } from "./rules/support";
import { validateScenario, type ScenarioViolation } from "./validateScenario";

/**
 * Deterministic security scenario generation (specs/057 FR-017 to FR-027): a pure function of the normalized model,
 * the optional profile, the scope and the limits. It uses no AI, no clock and no randomness, so identical input gives
 * identical scenarios with identical ids in identical order. Every scenario is validated before it is returned; one
 * that fails is reported in `rejected` and never offered as usable.
 */

export const SCENARIO_RULES: readonly ScenarioRule[] = Object.freeze([
  authenticationRule,
  authorizationRule,
  bolaRule,
  objectPropertyRule,
  inputValidationRule,
  resourceConsumptionRule,
  sensitiveDataExposureRule,
  misconfigurationRule,
]);

export interface GenerateInput {
  readonly apiModel: ApiModel;
  /** Operation keys to generate for, or `all`. */
  readonly scope: ReadonlySet<string> | "all";
  readonly limits: SecurityLabLimits;
  readonly profile?: SecurityProfile;
  readonly categories?: readonly GeneratableCategoryId[];
  readonly configuredSensitiveFields?: readonly string[];
}

export interface GeneratedScenario {
  readonly id: string;
  readonly content: SecurityScenarioContent;
}

export interface GenerationResult {
  readonly scenarios: GeneratedScenario[];
  readonly omittedByCap: CapOmission[];
  readonly notes: GenerationNote[];
  readonly rejected: Array<{ operationKey: string; categoryId: string; violations: ScenarioViolation[] }>;
}

/** Locale-independent ordering by code unit, so output never depends on the machine. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function generateSecurityScenarios(input: GenerateInput): GenerationResult {
  const { apiModel, limits } = input;
  const wanted = new Set<GeneratableCategoryId>(input.categories ?? GENERATABLE_CATEGORY_IDS);
  const context: GenerationContext = {
    apiModel,
    effective: new Map(resolveEffectiveSecurity(apiModel).map((entry) => [entry.operationKey, entry])),
    profile: input.profile,
    limits,
    configuredSensitive: configuredSet(input.configuredSensitiveFields ?? []),
  };

  const notes: GenerationNote[] = [];
  const rejected: GenerationResult["rejected"] = [];
  const candidates: GeneratedScenario[] = [];

  const operations = [...apiModel.operations]
    .filter((operation) => input.scope === "all" || input.scope.has(operationKeyOf(operation)))
    .sort((a, b) => compare(operationKeyOf(a), operationKeyOf(b)));

  for (const operation of operations) {
    for (const rule of SCENARIO_RULES) {
      if (!wanted.has(rule.categoryId)) continue;
      const output = rule.run(context, operation);
      notes.push(...output.notes);
      for (const content of output.contents) {
        const validation = validateScenario(content, { apiModel, maxRepeat: limits.ceilings.maxRepeat });
        if (!validation.ok) {
          rejected.push({ operationKey: content.operationKey, categoryId: content.categoryId, violations: validation.violations });
          continue;
        }
        candidates.push({ id: scenarioIdOf({ operationKey: content.operationKey, categoryId: content.categoryId, mutations: content.mutations }), content });
      }
    }
  }

  if (wanted.has("input-validation") && !input.profile?.permittedCategories.includes("input-validation")) {
    notes.push({
      categoryId: "input-validation",
      reason: "Injection probes are generated only when a selected profile permits input validation.",
    });
  }
  if (wanted.has("sensitive-business-flows")) {
    notes.push({
      categoryId: "sensitive-business-flows",
      reason: "Sensitive business flows need a user-defined policy, bounded actions and test data, which V1 cannot take. No executable scenario is generated.",
    });
  }

  // Merge equivalent scenarios: the first stays, and the rules that also produced it are kept in its provenance.
  const merged = new Map<string, GeneratedScenario>();
  for (const candidate of candidates) {
    const key = dedupeKeyOf(candidate.content);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
    } else {
      const rule = candidate.content.provenance.ruleId;
      const also = new Set(existing.content.provenance.duplicateOfRules ?? []);
      if (rule && rule !== existing.content.provenance.ruleId) also.add(rule);
      if (also.size > 0) {
        merged.set(key, {
          id: existing.id,
          content: { ...existing.content, provenance: { ...existing.content.provenance, duplicateOfRules: [...also].sort() } },
        });
      }
    }
  }

  const { kept, omissions } = applyCaps([...merged.values()]);
  const scenarios = kept.sort(
    (a, b) => compare(a.content.operationKey, b.content.operationKey) || compare(a.content.categoryId, b.content.categoryId) || compare(a.id, b.id),
  );
  return { scenarios, omittedByCap: omissions, notes, rejected };
}
